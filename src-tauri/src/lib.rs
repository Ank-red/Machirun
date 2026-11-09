use device_query::{DeviceQuery, DeviceState, Keycode};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tiny_http::{Header, Response, Server};

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
    static ref LCD_STATE: Arc<Mutex<LcdServerState>> =
        Arc::new(Mutex::new(LcdServerState::default()));
    static ref AUDIO_BLOBS_CACHE: Arc<Mutex<HashMap<String, Vec<u8>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

// 1. 状態・画像・音声トリガーを同期する超軽量コマンド（頻繁に呼ばれる）
#[tauri::command]
fn sync_lcd_to_rust(state: LcdServerState) {
    if let Ok(mut locked) = LCD_STATE.lock() {
        *locked = state;
    }
}

// 2. 音声バイナリ一式を初期登録するコマンド（mchrn読み込み時に1回だけ呼ぶ）
#[tauri::command]
fn register_audio_blobs(blobs: HashMap<String, Vec<u8>>) {
    if let Ok(mut locked) = AUDIO_BLOBS_CACHE.lock() {
        *locked = blobs;
    }
}

#[tauri::command]
fn save_mchrn_file(default_name: String, data: Vec<u8>) -> Result<String, String> {
    let file = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("Machirun Preset", &["mchrn"])
        .save_file();

    if let Some(path) = file {
        match fs::write(&path, data) {
            Ok(_) => Ok(path.to_string_lossy().to_string()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        Err("Cancelled".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    thread::spawn(|| {
        println!("[LCD Server] Attempting to bind to 127.0.0.1:14280...");
        let server = match Server::http("127.0.0.1:14280") {
            Ok(s) => {
                println!("[LCD Server] Successfully bound to 127.0.0.1:14280!");
                s
            }
            Err(e) => {
                eprintln!("[LCD Server] BIND ERROR: {}", e);
                return;
            }
        };

        for request in server.incoming_requests() {
            let url = request.url().to_string();
            println!("[LCD Server] Request received: {}", url);

            if url.starts_with("/api/state") {
                let locked = LCD_STATE.lock().unwrap();
                let json = match serde_json::to_string(&*locked) {
                    Ok(j) => j,
                    Err(e) => {
                        eprintln!("[LCD Server] JSON serialize error: {}", e);
                        "{}".to_string()
                    }
                };
                let response = Response::from_string(json)
                    .with_header(
                        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                    )
                    .with_header(
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    );
                let _ = request.respond(response);
            } else if url.starts_with("/image/") {
                let filename = url.strip_prefix("/image/").unwrap_or("");
                let locked = LCD_STATE.lock().unwrap();
                if let Some(bytes) = locked.image_blobs.get(filename) {
                    let response = Response::from_data(bytes.clone())
                        .with_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"image/avif"[..]).unwrap(),
                        )
                        .with_header(
                            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                                .unwrap(),
                        );
                    let _ = request.respond(response);
                } else {
                    let response = Response::empty(404);
                    let _ = request.respond(response);
                }
            } else if url.starts_with("/audio/") {
                let filename = url.strip_prefix("/audio/").unwrap_or("");
                let locked = AUDIO_BLOBS_CACHE.lock().unwrap();
                if let Some(bytes) = locked.get(filename) {
                    let response = Response::from_data(bytes.clone())
                        .with_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"audio/ogg"[..]).unwrap(),
                        )
                        .with_header(
                            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                                .unwrap(),
                        );
                    let _ = request.respond(response);
                } else {
                    let response = Response::empty(404);
                    let _ = request.respond(response);
                }
            } else {
                // OBSブラウザソース用のLCD描画HTMLクライアント
                let html = r#"<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Machirun OBS LCD</title>
  <style>
    body, html {
      margin: 0; padding: 0; width: 100vw; height: 100vh;
      background: #000; overflow: hidden; display: flex;
      align-items: center; justify-content: center;
    }
    #lcd-stage {
      position: relative; width: 100vw; height: 56.25vw;
      max-height: 100vh; max-width: 177.78vh;
      background: #000; overflow: hidden;
    }
    .lcd-layer {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      object-fit: contain; pointer-events: none;
    }
    .waiting {
      color: #fff; font-family: sans-serif; text-align: center;
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; opacity: 0.7;
    }
  </style>
</head>
<body>
  <div id="lcd-stage">
    <div class="waiting">
      <h3>Machirun OBS LCD 待機中...</h3>
      <p>車載器からの接続を待っています</p>
    </div>
  </div>
  <audio id="obs-audio" style="display:none;"></audio>

  <script>
    let objectUrlCache = {};
    let audioUrlCache = {};
    let lastAudioNonce = 0;

    async function updateLcd() {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) return;
        const data = await res.json();
        
        const preset = data.preset;
        const groupNo = data.group_no || "1";
        const slideIdx = data.slide_idx || 0;
        const layerIndices = data.layer_indices || {};
        const imageBlobs = data.image_blobs || {};
        const audioBlobs = data.audio_blobs || {};
        const playingFile = data.playing_audio_file;
        const nonce = data.audio_nonce || 0;

        if (!preset || !preset.lcdGroups) return;

        // 画像キャッシュ
        for (const [filename, byteArr] of Object.entries(imageBlobs)) {
          if (!objectUrlCache[filename]) {
            const u8 = new Uint8Array(byteArr);
            const blob = new Blob([u8], { type: 'image/avif' });
            objectUrlCache[filename] = URL.createObjectURL(blob);
          }
        }
        // 音声キャッシュ
        for (const [filename, byteArr] of Object.entries(audioBlobs)) {
          if (!audioUrlCache[filename]) {
            audioUrlCache[filename] = URL.createObjectURL(new Blob([new Uint8Array(byteArr)], { type: 'audio/ogg' }));
          }
        }

        // 音声の自動再生トリガー検知
        if (playingFile && nonce !== lastAudioNonce) {
          lastAudioNonce = nonce;
          const audioUrl = audioUrlCache[playingFile] || `/audio/${encodeURIComponent(playingFile)}`;
          const audioElement = document.getElementById('obs-audio');
          audioElement.src = audioUrl;
          audioElement.play().catch(e => console.error("Audio playback blocked/failed:", e));
        }

        const group = preset.lcdGroups[groupNo];
        if (!group || !group.slides || !group.slides[slideIdx]) return;
        const slide = group.slides[slideIdx];

        const stage = document.getElementById('lcd-stage');
        let html = '';

        if (slide.baseImageId && preset.images && preset.images[slide.baseImageId]) {
          const imgAsset = preset.images[slide.baseImageId];
          const url = objectUrlCache[imgAsset.fileName];
          if (url) {
            html += `<img src="${url}" class="lcd-layer" />`;
          }
        }

        if (slide.visibleLayers && preset.layerSlots) {
          for (const slotKey of slide.visibleLayers) {
            const slot = preset.layerSlots[slotKey];
            if (!slot || !slot.items) continue;

            const overrideIdx = slide.layerOverrides ? slide.layerOverrides[slotKey] : undefined;
            const activeIdx = overrideIdx !== undefined ? overrideIdx : layerIndices[slotKey];

            if (activeIdx === null || activeIdx === undefined || activeIdx === "+1") continue;

            const hashId = slot.items[String(activeIdx)];
            if (hashId && preset.images && preset.images[hashId]) {
              const layerAsset = preset.images[hashId];
              const url = objectUrlCache[layerAsset.fileName];
              if (url) {
                html += `<img src="${url}" class="lcd-layer" />`;
              }
            }
          }
        }

        if (html === '') {
          html = '<div class="waiting"><h3>LCDスライド未設定</h3></div>';
        }
        if (!preset || !preset.lcdGroups) {
          html = '<div class="waiting" style="background:#000;"></div>';
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
                let response = Response::from_string(html).with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                        .unwrap(),
                );
                let _ = request.respond(response);
            }
        }
    });

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 他のアプリへキーをそのまま通す「パススルー監視」スレッド
            let app_handle = app.handle().clone();
            thread::spawn(move || {
                let device_state = DeviceState::new();
                let mut prev_right = false;
                let mut prev_left = false;

                loop {
                    let keys = device_state.get_keys();
                    let right = keys.contains(&Keycode::Right);
                    let left = keys.contains(&Keycode::Left);

                    // 押された瞬間（立ち上がり）だけイベントを発火
                    if right && !prev_right {
                        let _ = app_handle.emit("global-key", "ArrowRight");
                    }
                    if left && !prev_left {
                        let _ = app_handle.emit("global-key", "ArrowLeft");
                    }

                    prev_right = right;
                    prev_left = left;
                    thread::sleep(Duration::from_millis(20)); // CPU負荷ほぼゼロ
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            sync_lcd_to_rust,
            save_mchrn_file,
            register_audio_blobs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
