// --- Imports ---
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from "fflate";
import { encode as encodeAvif } from "@jsquash/avif";
import { createOggEncoder } from "wasm-media-encoders";
import type { RoutePreset, ImageAsset, AudioAsset } from "./preset";

// --- Types ---

/** エディタおよび再生時にメモリ上で保持する展開済みアーカイブデータ */
export interface LoadedArchive {
  preset: RoutePreset;
  timetableCsv: string;
  /** fileName ("xxx.avif") から画像バイナリへのマップ */
  imageBlobs: Record<string, Uint8Array>;
  /** hashId からプレビュー・描画用 Object URL へのマップ */
  imageUrls: Record<string, string>;
  /** fileName ("xxx.opus") から音声バイナリへのマップ */
  audioBlobs: Record<string, Uint8Array>;
  /** hashId から再生用 Object URL へのマップ */
  audioUrls: Record<string, string>;
}

// --- Internal Helpers ---

/**
 * Uint8Arrayをブラウザ標準のBlobオブジェクトへ安全に変換する
 * @param bytes 変換元のバイト配列
 * @param type MIMEタイプ文字列
 * @returns 生成されたBlobインスタンス
 */
function toBlob(bytes: Uint8Array, type?: string): Blob {
  return new Blob([bytes as BlobPart], type ? { type } : undefined);
}

/**
 * アセット用の16文字のランダムIDを生成する
 * @returns 16文字の英数字ID
 */
function generateShortId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

// --- Asset Processing Functions ---

/**
 * 任意の画像ファイルを透過維持のままAVIFへ変換し、アセット情報とバイナリを返す
 * @param file 入力された画像ファイル
 * @returns ハッシュID、アセットメタデータ、AVIFバイナリ、Object URL
 */
export async function processImageToAvif(file: File): Promise<{
  hashId: string;
  asset: ImageAsset;
  binary: Uint8Array;
  objectUrl: string;
}> {
  let avifBytes: Uint8Array;

  if (file.type === "image/avif" || file.name.toLowerCase().endsWith(".avif")) {
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

    const encodedBuffer = await encodeAvif(imageData, { quality: 80, speed: 8 });
    avifBytes = new Uint8Array(encodedBuffer);
  }

  const hashId = generateShortId();
  const fileName = `${hashId}.avif`;
  const objectUrl = URL.createObjectURL(toBlob(avifBytes, "image/avif"));

  return {
    hashId,
    asset: { fileName, originalName: file.name },
    binary: avifBytes,
    objectUrl,
  };
}

/**
 * 任意の音声ファイル（WAV/FLAC等）をOgg Opusへ変換し、アセット情報とバイナリを返す
 * @param file 入力された音声ファイル
 * @returns ハッシュID、アセットメタデータ、Opusバイナリ、Object URL
 */
export async function processAudioToOpus(file: File): Promise<{
  hashId: string;
  asset: AudioAsset;
  binary: Uint8Array;
  objectUrl: string;
}> {
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

  const hashId = generateShortId();
  const fileName = `${hashId}.opus`;
  const objectUrl = URL.createObjectURL(toBlob(opusBytes, "audio/ogg; codecs=opus"));

  return {
    hashId,
    asset: { fileName, originalName: file.name },
    binary: opusBytes,
    objectUrl,
  };
}

// --- Archive I/O Functions ---

/**
 * プリセットデータ一式を独自アーカイブ形式（.mchrn / ZIP構造）のBlobとして書き出す
 * - テキスト（preset.json, timetable.csv）は圧縮レベル9で格納
 * - 画像・音声（AVIF, Opus）は無圧縮（レベル0）で格納
 * @param data メモリ上のアーカイブデータ一式
 * @returns 書き出し用のBlobインスタンス
 */
export function exportArchiveMchrn(data: LoadedArchive): Blob {
  const files: Zippable = {
    "preset.json": [strToU8(JSON.stringify(data.preset, null, 2)), { level: 9 }],
    "timetable.csv": [strToU8(data.timetableCsv), { level: 9 }],
  };

  for (const [fileName, bin] of Object.entries(data.imageBlobs)) {
    files[`image/${fileName}`] = [bin, { level: 0 }];
  }
  for (const [fileName, bin] of Object.entries(data.audioBlobs)) {
    files[`audio/${fileName}`] = [bin, { level: 0 }];
  }

  const zipped = zipSync(files);
  return toBlob(zipped, "application/octet-stream");
}

/**
 * アーカイブファイル（.mchrn / .zip）を読み込み、メモリ上のデータ構造へ展開する
 * @param file 読み込むアーカイブファイル
 * @returns 展開されたアーカイブデータ一式
 */
export async function importArchiveZip(file: File): Promise<LoadedArchive> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const unzipped = unzipSync(buffer);

  const presetJson = unzipped["preset.json"] ? strFromU8(unzipped["preset.json"]) : "{}";
  const timetableCsv = unzipped["timetable.csv"] ? strFromU8(unzipped["timetable.csv"]) : "";
  const preset: RoutePreset = JSON.parse(presetJson);

  const imageBlobs: Record<string, Uint8Array> = {};
  const imageUrls: Record<string, string> = {};
  const audioBlobs: Record<string, Uint8Array> = {};
  const audioUrls: Record<string, string> = {};

  for (const [hashId, asset] of Object.entries(preset.images || {})) {
    const path = `image/${asset.fileName}`;
    if (unzipped[path]) {
      imageBlobs[asset.fileName] = unzipped[path];
      imageUrls[hashId] = URL.createObjectURL(toBlob(unzipped[path], "image/avif"));
    }
  }

  for (const [hashId, asset] of Object.entries(preset.audios || {})) {
    const path = `audio/${asset.fileName}`;
    if (unzipped[path]) {
      audioBlobs[asset.fileName] = unzipped[path];
      audioUrls[hashId] = URL.createObjectURL(
        toBlob(unzipped[path], "audio/ogg; codecs=opus"),
      );
    }
  }

  return { preset, timetableCsv, imageBlobs, imageUrls, audioBlobs, audioUrls };
}