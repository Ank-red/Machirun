// src/lib/preset.ts

// 変換後のAVIFファイルと元の表示名の紐づけ
export interface ImageAsset {
  fileName: string;     // アーカイブ内の実ファイル名 (例: "a1b2c3d4e5f6.avif") ※image/ 直下に格納
  originalName: string; // エディタ表示用の元ファイル名 (例: "運賃_240円.png")
}

export interface AudioAsset {
  fileName: string;     // アーカイブ内の実ファイル名 (例: "a1b2c3d4e5f6.opus") ※audio/ 直下に格納
  originalName: string;
}

export interface LayerSlot {
  name: string;         // 例: "停留所名レイヤー", "運賃表レイヤー"
  linkedToCsvStop?: boolean;
  items: Record<string, string>; // 番号 -> ImageAssetのキー(ハッシュID)
}

export interface LcdSlide {
  baseImageId: string;  // ImageAssetのキー(ハッシュID)
  durationSec: number;
  visibleLayers: string[];
  layerOverrides?: Record<string, number>;
}

export interface LcdGroup {
  name: string;
  loop: boolean;
  slides: LcdSlide[];
}

export interface ActionStep {
  stepNo: number;
  label: string;
  setStopIndex?: number | "+1";
  setLayers?: Record<string, number | "+1" | null>;
  playAudioId?: string;
  setLcdGroupNo?: number;
}

export interface RoutePreset {
  meta: {
    name: string;
  };
  images: Record<string, ImageAsset>; // ハッシュID -> 画像情報
  layerSlots: Record<string, LayerSlot>;
  audios: Record<string, AudioAsset>;
  lcdGroups: Record<string, LcdGroup>;
  actions: ActionStep[];
}