import { invoke } from "@tauri-apps/api/core";
import type { RoutePreset } from "./preset";

// --- Constants & Types ---
const isTauri = "__TAURI_INTERNALS__" in window;
const CHANNEL_NAME = "machirun_lcd_sync";

// --- Channel Instance ---
export const lcdChannel = new BroadcastChannel(CHANNEL_NAME);

// --- Functions ---

/**
 * 音声バイナリ一式をRust側へ登録する（プリセット読込・切替・音声追加時に呼ぶ）
 */
export async function registerAudioBlobsToRust(
  audioBlobs: Record<string, Uint8Array>,
): Promise<void> {
  if (!isTauri) return;
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
 * @param preset 現在のプリセットデータ
 * @param groupNo 表示中のLCDグループ番号
 * @param slideIdx 表示中のスライドインデックス
 * @param layerIndices 現在の各レイヤー番号マップ
 * @param imageBlobs 画像ファイル名からバイナリへのマップ
 */
export async function syncLcdStateToRust(params: {
  preset: RoutePreset | null;
  groupNo: string;
  slideIdx: number;
  layerIndices: Record<string, number | "+1" | null>;
  imageBlobs: Record<string, Uint8Array>;
  playingAudioFile?: string;
  audioNonce?: number;
}): Promise<void> {
  if (!isTauri) return;
  const plainImageBlobs: Record<string, number[]> = {};
  for (const [name, bytes] of Object.entries(params.imageBlobs)) {
    plainImageBlobs[name] = Array.from(bytes);
  }

  try {
    await invoke("sync_lcd_to_rust", {
      state: {
        preset: params.preset ? JSON.parse(JSON.stringify(params.preset)) : null,
        group_no: String(params.groupNo),
        slide_idx: Number(params.slideIdx),
        layer_indices: JSON.parse(JSON.stringify(params.layerIndices)),
        image_blobs: plainImageBlobs,
        playing_audio_file: params.playingAudioFile ?? "",
        audio_nonce: params.audioNonce ?? 0,
      },
    });
  } catch (err) {
    console.error("Failed to sync LCD state:", err);
  }
}

// /**
//  * 画像バイナリ一式を受信側（PassengerApp）へ送信する
//  * @param imageBlobs ファイル名からAVIFバイナリへのマップ
//  */
// export function broadcastLcdAssets(
//   imageBlobs: Record<string, Uint8Array>,
// ): void {
//   const plainBlobs: Record<string, Uint8Array> = {};
//   for (const [fileName, bytes] of Object.entries(imageBlobs)) {
//     plainBlobs[fileName] = new Uint8Array(bytes);
//   }
//   const msg: LcdSyncMessage = {
//     type: "sync-assets",
//     imageBlobs: plainBlobs,
//   };
//   lcdChannel.postMessage(msg);
// }

// /**
//  * 受信側（PassengerApp）の起動時に最新状態の再送を要求する
//  */
// export function requestLcdSync(): void {
//   const msg: LcdSyncMessage = { type: "request-sync" };
//   lcdChannel.postMessage(msg);
// }