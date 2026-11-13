import { encode as encodeAvif } from "@jsquash/avif";
import { invoke } from "@tauri-apps/api/core";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { createOggEncoder } from "wasm-media-encoders";
import type {
  AudioAsset,
  ConvertedAssetResult,
  ImageAsset,
  LoadedArchive,
  RoutePreset,
} from "./types";

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
   * プリセットデータ一式を `.mchrn` として圧縮し、ネイティブダイアログ（Web時はダウンロード）で保存する
   * @param data 保存対象のプリセット・CSV・画像/音声バイナリ
   * @returns 保存成功時はtrue、キャンセルまたは失敗時はfalse
   */
  static async saveMchrn(
    data: Pick<
      LoadedArchive,
      "preset" | "timetableCsv" | "imageBlobs" | "audioBlobs"
    >,
  ): Promise<boolean> {
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
      try {
        await invoke<string>("save_mchrn_file", {
          defaultName,
          data: Array.from(zippedBytes),
        });
        return true;
      } catch (err) {
        if (err !== "Cancelled") console.error("Save failed:", err);
        return false;
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
    return true;
  }

  /**
   * アーカイブファイル（.mchrn / .zip）を読み込み、メモリ上のデータ構造へ展開する
   * @param file 読み込むアーカイブファイル
   * @returns 展開されたプリセット・CSV・バイナリ・Object URL一式
   */
  static async importMchrn(file: File): Promise<LoadedArchive> {
    const buffer = new Uint8Array(await file.arrayBuffer());
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
}