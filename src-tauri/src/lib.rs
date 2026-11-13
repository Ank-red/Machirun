use device_query::{DeviceQuery, DeviceState, Keycode};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Response, Server};

/// OBSブラウザソースへ配信するクライアントHTMLテンプレート
const OBS_LCD_HTML: &str = r#"<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Machirun OBS LCD</title>
  <style>
    body, html {
      align-items: center;
      background: #000;
      display: flex;
      height: 100vh;
      justify-content: center;
      margin: 0;
      overflow: hidden;
      padding: 0;
      width: 100vw;
    }
    #lcd-stage {
      background: #000;
      height: 56.25vw;
      max-height: 100vh;
      max-width: 177.78vh;
      overflow: hidden;
      position: relative;
      width: 100vw;
    }
    .lcd-layer {
      height: 100%;
      left: 0;
      object-fit: contain;
      pointer-events: none;
      position: absolute;
      top: 0;
      width: 100%;
    }
  </style>
</head>
<body>
  <div id="lcd-stage"></div>
  <audio id="obs-audio" style="display:none;"></audio>

  <script>
    const objectUrlCache = {};
    let lastAudioNonce = 0;

    async function updateLcd() {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) return;
        const data = await res.json();

        const stage = document.getElementById('lcd-stage');
        const preset = data.preset;

        if (!preset || !preset.lcdGroups) {
          stage.innerHTML = '';
          return;
        }

        const groupNo = data.group_no || "1";
        const slideIdx = data.slide_idx || 0;
        const layerIndices = data.layer_indices || {};
        const imageBlobs = data.image_blobs || {};
        const playingFile = data.playing_audio_file;
        const nonce = data.audio_nonce || 0;

        for (const [filename, byteArr] of Object.entries(imageBlobs)) {
          if (!objectUrlCache[filename]) {
            const blob = new Blob([new Uint8Array(byteArr)], { type: 'image/avif' });
            objectUrlCache[filename] = URL.createObjectURL(blob);
          }
        }

        if (playingFile && nonce !== lastAudioNonce) {
          lastAudioNonce = nonce;
          const audioElement = document.getElementById('obs-audio');
          audioElement.src = `/audio/${encodeURIComponent(playingFile)}?t=${nonce}`;
          audioElement.play().catch(e => console.error("Audio playback failed:", e));
        }

        const group = preset.lcdGroups[groupNo];
        if (!group || !group.slides || !group.slides[slideIdx]) {
          stage.innerHTML = '';
          return;
        }
        const slide = group.slides[slideIdx];
        let html = '';

        if (slide.baseImageId && preset.images?.[slide.baseImageId]) {
          const imgAsset = preset.images[slide.baseImageId];
          const url = objectUrlCache[imgAsset.fileName];
          if (url) html += `<img src="${url}" class="lcd-layer" />`;
        }

        if (slide.visibleLayers && preset.layerSlots) {
          for (const slotKey of slide.visibleLayers) {
            const slot = preset.layerSlots[slotKey];
            if (!slot?.items) continue;

            const overrideIdx = slide.layerOverrides?.[slotKey];
            const activeIdx = overrideIdx !== undefined ? overrideIdx : layerIndices[slotKey];
            if (activeIdx === null || activeIdx === undefined || activeIdx === "+1") continue;

            const hashId = slot.items[String(activeIdx)];
            if (hashId && preset.images?.[hashId]) {
              const layerAsset = preset.images[hashId];
              const url = objectUrlCache[layerAsset.fileName];
              if (url) html += `<img src="${url}" class="lcd-layer" />`;
            }
          }
        }

        stage.innerHTML = html;
      } catch (e) {
        console.error("LCD Sync Error:", e);
      }
    }

    setInterval(updateLcd, 100);
    updateLcd();
  </script>
</body>
</html>"#;

/// ローカルHTTPサーバーで保持・配信するLCDおよび音声の同期状態
#[derive(Clone, Serialize, Deserialize, Default)]
struct LcdServerState {
    preset: Option<serde_json::Value>,
    group_no: String,
    slide_idx: usize,
    layer_indices: HashMap<String, serde_json::Value>,
    image_blobs: HashMap<String, Vec<u8>>,
    playing_audio_file: String,
    audio_nonce: u64,
}

lazy_static! {
    /// フロントエンドから同期された最新のLCD表示状態
    static ref LCD_STATE: Arc<Mutex<LcdServerState>> =
        Arc::new(Mutex::new(LcdServerState::default()));
    /// フロントエンドから登録された音声バイナリのキャッシュ
    static ref AUDIO_BLOBS_CACHE: Arc<Mutex<HashMap<String, Vec<u8>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// フロントエンドのLCD状態をRust側のメモリへ同期するTauriコマンド
#[tauri::command]
fn sync_lcd_to_rust(state: LcdServerState) {
    if let Ok(mut locked) = LCD_STATE.lock() {
        *locked = state;
    }
}

/// 音声バイナリ一式をRust側のメモリキャッシュへ登録するTauriコマンド
#[tauri::command]
fn register_audio_blobs(blobs: HashMap<String, Vec<u8>>) {
    if let Ok(mut locked) = AUDIO_BLOBS_CACHE.lock() {
        *locked = blobs;
    }
}

/// ネイティブのファイル保存ダイアログを開き、`.mchrn` バイナリを書き出すTauriコマンド
#[tauri::command]
fn save_mchrn_file(default_name: String, data: Vec<u8>) -> Result<String, String> {
    let file = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("Machirun Preset", &["mchrn"])
        .save_file();

    match file {
        Some(path) => fs::write(&path, data)
            .map(|_| path.to_string_lossy().to_string())
            .map_err(|e| e.to_string()),
        None => Err("Cancelled".to_string()),
    }
}

/// CORSヘッダーとContent-Typeを付与したHTTPレスポンスを生成する
fn build_response(data: Vec<u8>, content_type: &[u8]) -> Response<Cursor<Vec<u8>>> {
    Response::from_data(data)
        .with_header(Header::from_bytes(&b"Content-Type"[..], content_type).unwrap())
        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
}

/// OBSブラウザソース向けのローカルHTTPサーバー (`127.0.0.1:14280`) を別スレッドで起動する
fn spawn_lcd_http_server() {
    thread::spawn(|| {
        let server = match Server::http("127.0.0.1:14280") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[LCD Server] Bind error: {}", e);
                return;
            }
        };

        for request in server.incoming_requests() {
            let url = request.url().to_string();
            let clean_path = url.split('?').next().unwrap_or("");

            if clean_path == "/api/state" {
                let locked = LCD_STATE.lock().unwrap();
                let json = serde_json::to_vec(&*locked).unwrap_or_else(|_| b"{}".to_vec());
                let _ = request.respond(build_response(json, b"application/json"));
            } else if let Some(filename) = clean_path.strip_prefix("/image/") {
                let locked = LCD_STATE.lock().unwrap();
                if let Some(bytes) = locked.image_blobs.get(filename) {
                    let _ = request.respond(build_response(bytes.clone(), b"image/avif"));
                } else {
                    let _ = request.respond(Response::empty(404));
                }
            } else if let Some(filename) = clean_path.strip_prefix("/audio/") {
                let locked = AUDIO_BLOBS_CACHE.lock().unwrap();
                if let Some(bytes) = locked.get(filename) {
                    let _ = request.respond(build_response(bytes.clone(), b"audio/ogg"));
                } else {
                    let _ = request.respond(Response::empty(404));
                }
            } else {
                let _ = request.respond(build_response(
                    OBS_LCD_HTML.as_bytes().to_vec(),
                    b"text/html; charset=utf-8",
                ));
            }
        }
    });
}

/// 左右矢印キーのグローバル入力を監視し、フロントエンドへイベントを発火するスレッドを起動する
fn spawn_global_key_listener(app_handle: AppHandle) {
    thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut prev_right = false;
        let mut prev_left = false;

        loop {
            let keys = device_state.get_keys();
            let right = keys.contains(&Keycode::Right);
            let left = keys.contains(&Keycode::Left);

            if right && !prev_right {
                let _ = app_handle.emit("global-key", "ArrowRight");
            }
            if left && !prev_left {
                let _ = app_handle.emit("global-key", "ArrowLeft");
            }

            prev_right = right;
            prev_left = left;
            thread::sleep(Duration::from_millis(20));
        }
    });
}

/// Tauriアプリケーションを初期化して実行するエントリーポイント
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    spawn_lcd_http_server();

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            spawn_global_key_listener(app.handle().clone());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            sync_lcd_to_rust,
            register_audio_blobs,
            save_mchrn_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
