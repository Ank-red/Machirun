import { encode as encodeAvif } from "@jsquash/avif";
import { invoke } from "@tauri-apps/api/core";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { createOggEncoder } from "wasm-media-encoders";
import type {
  AudioAsset,
  ConvertedAssetResult,
  ImageAsset,
  LoadedArchive,
  RawFilePayload,
  RoutePreset,
  StartupLoadPayload,
} from "./types";

/** localStorage に保持する読み込み済みファイルパス一覧のキー */
const RECENT_PATHS_STORAGE_KEY = "machirun_recent_mchrn_paths";

/** localStorage に保持する最後に使用したディレクトリパスのキー */
const LAST_DIR_STORAGE_KEY = "machirun_last_directory";

/**
 * アセットのAVIF/Opus変換および `.mchrn` アーカイブの入出力を担うサービスクラス
 */
export class ArchiveService {
  /**
   * Uint8Arrayをブラウザ標準のBlobオブジェクトへ変換する
   * @param bytes バイナリ配列
   * @param type MIMEタイプ文字列
   * @returns 生成されたBlobインスタンス
   */
  private static toBlob(bytes: Uint8Array, type?: string): Blob {
    return new Blob([bytes as BlobPart], type ? { type } : undefined);
  }

  /**
   * アセット用の16文字のランダムハッシュIDを生成する
   * @returns 16文字の英数字ID
   */
  static generateAssetId(): string {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }

  /**
   * 任意の画像ファイルを透過維持のままAVIFへ変換し、アセット情報とバイナリを返す
   * @param file 入力画像ファイル
   * @param existingHashId 差し替え時に維持する既存ハッシュID（省略時は新規発行）
   * @returns 変換後の画像アセット結果
   */
  static async convertImageToAvif(
    file: File,
    existingHashId?: string,
  ): Promise<ConvertedAssetResult<ImageAsset>> {
    let avifBytes: Uint8Array;

    if (
      file.type === "image/avif" ||
      file.name.toLowerCase().endsWith(".avif")
    ) {
      avifBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();

      const encodedBuffer = await encodeAvif(imageData, {
        quality: 80,
        speed: 8,
      });
      avifBytes = new Uint8Array(encodedBuffer);
    }

    const hashId = existingHashId ?? this.generateAssetId();
    const fileName = `${hashId}.avif`;
    const objectUrl = URL.createObjectURL(this.toBlob(avifBytes, "image/avif"));

    return {
      hashId,
      asset: { fileName, originalName: file.name },
      binary: avifBytes,
      objectUrl,
    };
  }

  /**
   * 任意の音声ファイルをOgg Opusへ変換し、アセット情報とバイナリを返す
   * @param file 入力音声ファイル
   * @param existingHashId 差し替え時に維持する既存ハッシュID（省略時は新規発行）
   * @returns 変換後の音声アセット結果
   */
  static async convertAudioToOpus(
    file: File,
    existingHashId?: string,
  ): Promise<ConvertedAssetResult<AudioAsset>> {
    let opusBytes: Uint8Array;

    if (
      file.name.toLowerCase().endsWith(".opus") ||
      file.type === "audio/opus" ||
      file.type === "audio/ogg"
    ) {
      opusBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      await audioCtx.close();

      const channels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const channelData: Float32Array[] = [];
      for (let c = 0; c < channels; c++) {
        channelData.push(audioBuffer.getChannelData(c));
      }

      const encoder = await createOggEncoder();
      encoder.configure({
        channels: channels as 1 | 2,
        sampleRate,
        vbrQuality: 5,
      });

      const chunks: Uint8Array[] = [];
      const frameSize = 4096;
      const totalSamples = audioBuffer.length;
      for (let i = 0; i < totalSamples; i += frameSize) {
        const slice = channelData.map((ch) =>
          ch.subarray(i, Math.min(i + frameSize, totalSamples)),
        );
        const encoded = encoder.encode(slice);
        if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
      }
      const finalChunk = encoder.finalize();
      if (finalChunk.length > 0) chunks.push(new Uint8Array(finalChunk));

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      opusBytes = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        opusBytes.set(chunk, offset);
        offset += chunk.length;
      }
    }

    const hashId = existingHashId ?? this.generateAssetId();
    const fileName = `${hashId}.opus`;
    const objectUrl = URL.createObjectURL(
      this.toBlob(opusBytes, "audio/ogg; codecs=opus"),
    );

    return {
      hashId,
      asset: { fileName, originalName: file.name },
      binary: opusBytes,
      objectUrl,
    };
  }

  /**
     * 未保存変更（Dirty状態）を検知するための状態スナップショット文字列を生成する
     * @param preset 対象のプリセット
     * @param timetableCsv ダイヤグラムCSV文字列
     * @returns 比較用のJSON文字列
     */
  static createSnapshot(preset: RoutePreset, timetableCsv: string): string {
    return JSON.stringify({ preset, timetableCsv });
  }

  /**
   * 未保存変更の有無をRust側（ウィンドウ終了ガード用）へ同期する
   * @param dirty 未保存の変更がある場合はtrue
   */
  static async syncUnsavedState(dirty: boolean): Promise<void> {
    if (!("__TAURI_INTERNALS__" in window)) return;
    try {
      await invoke("set_unsaved_changes", { dirty });
    } catch (err) {
      console.error("Failed to sync unsaved state:", err);
    }
  }

  /**
   * 読み込み済みファイルのフルパス一覧を localStorage へ保存する
   * @param paths ファイルパスの配列
   */
  static saveRecentPaths(paths: (string | undefined)[]): void {
    const validPaths = Array.from(
      new Set(paths.filter((p): p is string => Boolean(p))),
    );
    localStorage.setItem(RECENT_PATHS_STORAGE_KEY, JSON.stringify(validPaths));
  }

  /**
   * localStorage から前回保存されたファイルパス一覧を取得する
   * @returns ファイルパスの配列
   */
  static loadRecentPaths(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_PATHS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * 未保存の変更がある場合に確認ダイアログを表示する
   * @param message 確認メッセージ
   * @returns 破棄して続行する場合はtrue
   */
  static async confirmDiscardChanges(
    message: string = "保存されていない変更があります。破棄して移動しますか？",
  ): Promise<boolean> {
    if ("__TAURI_INTERNALS__" in window) {
      return invoke<boolean>("confirm_unsaved_dialog", { message });
    }
    return window.confirm(message);
  }

  /**
   * ファイルのフルパスから親ディレクトリパスを抽出して localStorage に記憶する（Windows / Linux 両対応）
   * @param filePath ファイルのフルパス
   */
  static rememberDirectoryFromFile(filePath?: string): void {
    if (!filePath) return;
    const lastSepIdx = Math.max(
      filePath.lastIndexOf("/"),
      filePath.lastIndexOf("\\"),
    );
    if (lastSepIdx > 0) {
      const dir = filePath.slice(0, lastSepIdx);
      localStorage.setItem(LAST_DIR_STORAGE_KEY, dir);
    }
  }

  /**
   * 前回記憶したディレクトリパスを取得する
   * @returns ディレクトリパス（未記憶時は undefined）
   */
  static getLastDirectory(): string | undefined {
    return localStorage.getItem(LAST_DIR_STORAGE_KEY) ?? undefined;
  }

  /**
   * ネイティブダイアログを開いて `.mchrn` ファイルを読み込む（Tauri専用）
   * @returns 読み込まれた生ファイルデータの配列
   */
  static async openFilesNative(): Promise<RawFilePayload[]> {
    if (!("__TAURI_INTERNALS__" in window)) return [];
    const defaultDir = this.getLastDirectory();
    return invoke<RawFilePayload[]>("open_mchrn_files_dialog", { defaultDir });
  }

  /**
    * 指定されたパス配列から `.mchrn` ファイルを読み込む（起動時の自動復元用）
    * @param paths ファイルパスの配列
    * @returns 読み込めたファイル配列と、移動・削除されたパス配列
    */
  static async readFilesByPaths(paths: string[]): Promise<StartupLoadPayload> {
    if (!("__TAURI_INTERNALS__" in window) || paths.length === 0) {
      return { loaded: [], missing: [] };
    }
    return invoke<StartupLoadPayload>("read_mchrn_files_by_paths", { paths });
  }

  /**
   * プリセットデータ一式を `.mchrn` として圧縮し、上書き保存または名前をつけて保存する
   * （上書き保存時に元フォルダが移動・削除されていた場合は保存ダイアログへ自動フォールバック）
   * @param data 保存対象のプリセット・CSV・画像/音声バイナリ
   * @param targetPath 上書き保存先のフルパス（省略時は「名前をつけて保存」ダイアログを表示）
   * @returns 保存されたファイルパス（Web時はファイル名）、キャンセル・失敗時は null
   */
  static async saveMchrn(
    data: Pick<
      LoadedArchive,
      "preset" | "timetableCsv" | "imageBlobs" | "audioBlobs"
    >,
    targetPath?: string,
  ): Promise<string | null> {
    const files: Zippable = {
      "preset.json": [
        strToU8(JSON.stringify(data.preset, null, 2)),
        { level: 9 },
      ],
      "timetable.csv": [strToU8(data.timetableCsv), { level: 9 }],
    };

    for (const [fileName, bin] of Object.entries(data.imageBlobs)) {
      files[`image/${fileName}`] = [bin, { level: 0 }];
    }
    for (const [fileName, bin] of Object.entries(data.audioBlobs)) {
      files[`audio/${fileName}`] = [bin, { level: 0 }];
    }

    const zippedBytes = zipSync(files);
    const defaultName = `${data.preset.meta.name || "preset"}.mchrn`;

    if ("__TAURI_INTERNALS__" in window) {
      const byteArray = Array.from(zippedBytes);

      if (targetPath) {
        try {
          const saved = await invoke<string>("write_mchrn_file_direct", {
            path: targetPath,
            data: byteArray,
          });
          this.rememberDirectoryFromFile(saved);
          return saved;
        } catch (err) {
          console.warn(
            "Direct write failed, falling back to Save As dialog:",
            err,
          );
        }
      }

      try {
        const saved = await invoke<string>("save_mchrn_file", {
          defaultName,
          defaultDir: this.getLastDirectory(),
          data: byteArray,
        });
        this.rememberDirectoryFromFile(saved);
        return saved;
      } catch (err) {
        if (err !== "Cancelled") console.error("Save failed:", err);
        return null;
      }
    }

    const url = URL.createObjectURL(
      this.toBlob(zippedBytes, "application/octet-stream"),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    URL.revokeObjectURL(url);
    return defaultName;
  }

  /**
   * バイト配列（Uint8Array）からアーカイブを展開する
   * @param buffer ZIP/mchrn のバイナリ配列
   * @returns 展開されたプリセット・CSV・バイナリ・Object URL一式
   */
  static importFromBytes(buffer: Uint8Array): LoadedArchive {
    const unzipped = unzipSync(buffer);

    const presetJson = unzipped["preset.json"]
      ? strFromU8(unzipped["preset.json"])
      : "{}";
    const timetableCsv = unzipped["timetable.csv"]
      ? strFromU8(unzipped["timetable.csv"])
      : "";
    const preset: RoutePreset = JSON.parse(presetJson);
    if (!preset.audioGroups) preset.audioGroups = {};

    const imageBlobs: Record<string, Uint8Array> = {};
    const imageUrls: Record<string, string> = {};
    const audioBlobs: Record<string, Uint8Array> = {};
    const audioUrls: Record<string, string> = {};

    for (const [hashId, asset] of Object.entries(preset.images || {})) {
      const path = `image/${asset.fileName}`;
      if (unzipped[path]) {
        imageBlobs[asset.fileName] = unzipped[path];
        imageUrls[hashId] = URL.createObjectURL(
          this.toBlob(unzipped[path], "image/avif"),
        );
      }
    }

    for (const [hashId, asset] of Object.entries(preset.audios || {})) {
      const path = `audio/${asset.fileName}`;
      if (unzipped[path]) {
        audioBlobs[asset.fileName] = unzipped[path];
        audioUrls[hashId] = URL.createObjectURL(
          this.toBlob(unzipped[path], "audio/ogg; codecs=opus"),
        );
      }
    }

    return {
      preset,
      timetableCsv,
      imageBlobs,
      imageUrls,
      audioBlobs,
      audioUrls,
    };
  }

  /**
   * ブラウザの File オブジェクトからアーカイブを展開する
   * @param file 読み込むアーカイブファイル
   * @returns 展開されたプリセット・CSV・バイナリ・Object URL一式
   */
  static async importMchrn(file: File): Promise<LoadedArchive> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    return this.importFromBytes(buffer);
  }
}