// src/lib/archive.ts
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from "fflate";
import { encode as encodeAvif } from "@jsquash/avif";
import { createOggEncoder } from "wasm-media-encoders";
import type { RoutePreset, ImageAsset } from "./preset";

// エディタおよび再生時にメモリ上で保持する実ファイルデータ
export interface LoadedArchive {
  preset: RoutePreset;
  timetableCsv: string;
  imageBlobs: Record<string, Uint8Array>; // fileName ("xxx.avif") -> バイナリ
  imageUrls: Record<string, string>;      // hashId -> プレビュー・描画用 Object URL
  audioBlobs: Record<string, Uint8Array>; // target ("audio/xxx.opus") -> バイナリ
  audioUrls: Record<string, string>;      // target -> 再生用 Object URL
}

// 1. 任意の画像Fileを透過維持のままAVIFへ変換し、SHA-256ハッシュIDを返す
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
    // Canvas経由でRGBAピクセルデータを取得してAVIFエンコード
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

    const encodedBuffer = await encodeAvif(imageData, { quality: 80 });
    avifBytes = new Uint8Array(encodedBuffer);
  }

  // SHA-256の先頭16文字をハッシュIDにする（重複排除＆文字化け防止）
  const hashBuffer = await crypto.subtle.digest("SHA-256", avifBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashId = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const fileName = `${hashId}.avif`;

  const blob = new Blob([avifBytes], { type: "image/avif" });
  const objectUrl = URL.createObjectURL(blob);

  return {
    hashId,
    asset: { fileName, originalName: file.name },
    binary: avifBytes,
    objectUrl,
  };
}

// 2. アーカイブ（ZIP）の書き出し
export function exportArchiveZip(data: LoadedArchive): Blob {
  const files: Record<string, Uint8Array> = {
    "preset.json": strToU8(JSON.stringify(data.preset, null, 2)),
    "timetable.csv": strToU8(data.timetableCsv),
  };

  for (const [fileName, bin] of Object.entries(data.imageBlobs)) {
    files[`image/${fileName}`] = bin;
  }
  for (const [targetPath, bin] of Object.entries(data.audioBlobs)) {
    const cleanPath = targetPath.startsWith("audio/") ? targetPath : `audio/${targetPath}`;
    files[cleanPath] = bin;
  }

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

// 3. アーカイブ（ZIP）の読み込み
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

  // 画像の復元とObject URL生成
  for (const [hashId, asset] of Object.entries(preset.images || {})) {
    const path = `image/${asset.fileName}`;
    if (unzipped[path]) {
      imageBlobs[asset.fileName] = unzipped[path];
      imageUrls[hashId] = URL.createObjectURL(new Blob([unzipped[path]], { type: "image/avif" }));
    }
  }

  // 音声の復元とObject URL生成
  for (const [entryPath, bytes] of Object.entries(unzipped)) {
    if (entryPath.startsWith("audio/") && bytes.length > 0) {
      audioBlobs[entryPath] = bytes;
      audioUrls[entryPath] = URL.createObjectURL(new Blob([bytes]));
    }
  }

  return { preset, timetableCsv, imageBlobs, imageUrls, audioBlobs, audioUrls };
}

// 音声ファイル（WAV/FLAC等）をOgg Opusへ高速変換し、ハッシュIDとバイナリを返す
export async function processAudioToOpus(file: File): Promise<{
  hashId: string;
  targetPath: string; // "audio/<hash>.opus"
  originalName: string;
  binary: Uint8Array;
  objectUrl: string;
}> {
  let opusBytes: Uint8Array;

  if (file.name.toLowerCase().endsWith(".opus") || file.type === "audio/ogg") {
    opusBytes = new Uint8Array(await file.arrayBuffer());
  } else {
    // 1. Web Audio API で WAV / FLAC をデコードして Float32 PCM を取得
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

    // 2. Wasm Ogg Opus エンコーダで一括変換 (64kbps: 音声案内に十分な高音質・極小サイズ)
    const encoder = await createOggEncoder();
    encoder.configure({
      channels: channels as 1 | 2,
      sampleRate,
      // vbrQuality: ,
      // bitrate: 64000,
    });

    const chunks: Uint8Array[] = [];
    // 4096サンプルずつ投入
    const frameSize = 4096;
    const totalSamples = audioBuffer.length;
    for (let i = 0; i < totalSamples; i += frameSize) {
      const slice = channelData.map((ch) => ch.subarray(i, Math.min(i + frameSize, totalSamples)));
      const encoded = encoder.encode(slice);
      if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
    }
    const finalChunk = encoder.finalize();
    if (finalChunk.length > 0) chunks.push(new Uint8Array(finalChunk));

    // チャンクを結合
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    opusBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      opusBytes.set(chunk, offset);
      offset += chunk.length;
    }
  }

  // SHA-256ハッシュ生成
  const hashBuffer = await crypto.subtle.digest("SHA-256", opusBytes);
  const hashId = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  const targetPath = `audio/${hashId}.opus`;
  const blob = new Blob([opusBytes], { type: "audio/opus; codecs=opus" });
  const objectUrl = URL.createObjectURL(blob);

  return {
    hashId,
    targetPath,
    originalName: file.name,
    binary: opusBytes,
    objectUrl,
  };
}

// アーカイブ（.mchrn）の書き出し：テキストは最大圧縮(9)、画像・音声は無圧縮(0)
export function exportArchiveMchrn(data: LoadedArchive): Blob {
  const files: Zippable = {
    "preset.json": [strToU8(JSON.stringify(data.preset, null, 2)), { level: 9 }],
    "timetable.csv": [strToU8(data.timetableCsv), { level: 9 }],
  };

  for (const [fileName, bin] of Object.entries(data.imageBlobs)) {
    files[`image/${fileName}`] = [bin, { level: 0 }];
  }
  for (const [targetPath, bin] of Object.entries(data.audioBlobs)) {
    const cleanPath = targetPath.startsWith("audio/") ? targetPath : `audio/${targetPath}`;
    files[cleanPath] = [bin, { level: 0 }];
  }

  const zipped = zipSync(files);
  return new Blob([zipped], { type: "application/octet-stream" });
}