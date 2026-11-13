import { invoke } from "@tauri-apps/api/core";
import type { LcdSyncPayload } from "./types";

/** Tauriデスクトップ環境で動作しているかどうかの判定フラグ */
export const IS_TAURI = "__TAURI_INTERNALS__" in window;

/** ブラウザ間・PassengerApp連携用のBroadcastChannel名（将来拡張用） */
export const LCD_BROADCAST_CHANNEL_NAME = "machirun_lcd_sync";

/** ブラウザ間同期用のBroadcastChannelインスタンス */
export const lcdChannel = new BroadcastChannel(LCD_BROADCAST_CHANNEL_NAME);

/**
 * Rust側ローカルHTTPサーバー（OBSブラウザソース配信用）との同期を担うサービスクラス
 */
export class LcdSyncService {
  /**
   * 音声バイナリ一式をRust側のキャッシュへ登録する
   * @param audioBlobs ファイル名からOpusバイナリへのマップ
   */
  static async registerAudioBlobs(
    audioBlobs: Record<string, Uint8Array>,
  ): Promise<void> {
    if (!IS_TAURI) return;

    const blobs: Record<string, number[]> = {};
    for (const [name, bytes] of Object.entries(audioBlobs)) {
      blobs[name] = Array.from(bytes);
    }

    try {
      await invoke("register_audio_blobs", { blobs });
    } catch (err) {
      console.error("Failed to register audio blobs:", err);
    }
  }

  /**
   * 現在のプリセット構造とLCD表示状態をRust側のローカルHTTPサーバーへ同期する
   * @param payload 同期するLCD状態ペイロード
   */
  static async syncState(payload: LcdSyncPayload): Promise<void> {
    if (!IS_TAURI) return;

    const plainImageBlobs: Record<string, number[]> = {};
    for (const [name, bytes] of Object.entries(payload.imageBlobs)) {
      plainImageBlobs[name] = Array.from(bytes);
    }

    try {
      await invoke("sync_lcd_to_rust", {
        state: {
          preset: payload.preset
            ? JSON.parse(JSON.stringify(payload.preset))
            : null,
          group_no: String(payload.groupNo),
          slide_idx: Number(payload.slideIdx),
          layer_indices: JSON.parse(JSON.stringify(payload.layerIndices)),
          image_blobs: plainImageBlobs,
          playing_audio_file: payload.playingAudioFile ?? "",
          audio_nonce: payload.audioNonce ?? 0,
        },
      });
    } catch (err) {
      console.error("Failed to sync LCD state:", err);
    }
  }
}