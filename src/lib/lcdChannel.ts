// --- Imports ---
import { invoke } from "@tauri-apps/api/core";
import type { RoutePreset } from "./preset";

// --- Constants & Types ---
const CHANNEL_NAME = "machirun_lcd_sync";

/** LCD画面へ送信するメッセージの型定義 */
export type LcdSyncMessage =
  | {
    type: "sync-state";
    preset: RoutePreset;
    groupNo: string;
    slideIdx: number;
    layerIndices: Record<string, number | "+1" | null>;
  }
  | {
    type: "sync-assets";
    imageBlobs: Record<string, Uint8Array>;
  }
  | {
    type: "request-sync";
  };

// --- Channel Instance ---
export const lcdChannel = new BroadcastChannel(CHANNEL_NAME);

// --- Functions ---

/**
 * 音声バイナリをRust側へ初期登録する（mchrn読込時に1回だけ呼ぶ）
 */
export async function registerAudioBlobsToRust(audioBlobs: Record<string, Uint8Array>): Promise<void> {
  const plainBlobs: Record<string, number[]> = {};
  for (const [name, bytes] of Object.entries(audioBlobs)) {
    plainBlobs[name] = Array.from(bytes);
  }
  try {
    await invoke("register_audio_blobs", { blobs: plainBlobs });
  } catch (e) { }
}

/**
 * 現在のプリセット構造とLCD表示状態をRust側のローカルHTTPサーバーへ同期する
 * @param preset 現在のプリセットデータ
 * @param groupNo 表示中のLCDグループ番号
 * @param slideIdx 表示中のスライドインデックス
 * @param layerIndices 現在の各レイヤー番号マップ
 * @param imageBlobs 画像ファイル名からバイナリへのマップ
 */
export async function broadcastLcdState(
  preset: RoutePreset,
  groupNo: string,
  slideIdx: number,
  layerIndices: Record<string, number | "+1" | null>,
  imageBlobs: Record<string, Uint8Array>,
  playingAudioFile: string = "",
  audioNonce: number = 0,
): Promise<void> {
  const plainImageBlobs: Record<string, number[]> = {};
  for (const [name, bytes] of Object.entries(imageBlobs)) {
    plainImageBlobs[name] = Array.from(bytes);
  }

  try {
    await invoke("sync_lcd_to_rust", {
      state: {
        preset: JSON.parse(JSON.stringify(preset)),
        group_no: String(groupNo),
        slide_idx: Number(slideIdx),
        layer_indices: JSON.parse(JSON.stringify(layerIndices)),
        image_blobs: plainImageBlobs,
        playing_audio_file: playingAudioFile,
        audio_nonce: audioNonce,
      },
    });
  } catch (e) { }
}

/**
 * 画像バイナリ一式を受信側（PassengerApp）へ送信する
 * @param imageBlobs ファイル名からAVIFバイナリへのマップ
 */
export function broadcastLcdAssets(
  imageBlobs: Record<string, Uint8Array>,
): void {
  const plainBlobs: Record<string, Uint8Array> = {};
  for (const [fileName, bytes] of Object.entries(imageBlobs)) {
    plainBlobs[fileName] = new Uint8Array(bytes);
  }
  const msg: LcdSyncMessage = {
    type: "sync-assets",
    imageBlobs: plainBlobs,
  };
  lcdChannel.postMessage(msg);
}

/**
 * 受信側（PassengerApp）の起動時に最新状態の再送を要求する
 */
export function requestLcdSync(): void {
  const msg: LcdSyncMessage = { type: "request-sync" };
  lcdChannel.postMessage(msg);
}