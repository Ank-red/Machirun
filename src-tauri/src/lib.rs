use device_query::{DeviceQuery, DeviceState, Keycode};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // グローバルショートカットプラグインを有効化
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
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
