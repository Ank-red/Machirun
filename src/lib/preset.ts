// --- Asset Types ---

/** 変換後のAVIF画像ファイルと元の表示名の紐づけ情報 */
export interface ImageAsset {
  /** アーカイブ内の実ファイル名 (例: "a1b2c3d4e5f6.avif") ※image/ 直下に格納 */
  fileName: string;
  /** エディタ表示用の元ファイル名 (例: "運賃_240円.png") */
  originalName: string;
}

/** 変換後のOpus音声ファイルと元の表示名の紐づけ情報 */
export interface AudioAsset {
  /** アーカイブ内の実ファイル名 (例: "a1b2c3d4e5f6.opus") ※audio/ 直下に格納 */
  fileName: string;
  /** エディタ表示用の元ファイル名 (例: "到着案内.wav") */
  originalName: string;
}

/** 複数の音声アセットを順番に連続再生する音声グループの定義 */
export interface AudioGroup {
  /** グループ名 (例: "次停留所案内_瀬河原", "発車チャイム＋注意放送") */
  name: string;
  /** 順番に連続再生する AudioAsset のハッシュID配列 */
  audioIds: string[];
}

// --- LCD & Layer Types ---

/** ベース画像の上に重ねる透過画像レイヤースロットの定義 */
export interface LayerSlot {
  /** エディタ上の表示名 (例: "停留所名レイヤー", "運賃表レイヤー") */
  name: string;
  /** 車載器の停留所送りと連動させるかどうかのフラグ */
  linkedToCsvStop?: boolean;
  /** レイヤー番号から ImageAsset のハッシュIDへのマップ */
  items: Record<string, string>;
}

/** 車内LCDの1枚分のスライド定義 */
export interface LcdSlide {
  /** ベース画像の ImageAsset ハッシュID */
  baseImageId: string;
  /** ループ再生時の表示秒数 */
  durationSec: number;
  /** 重ねて表示する LayerSlot のキー配列（配列順＝下から重ねる順） */
  visibleLayers: string[];
  /** スライド個別に特定のレイヤー番号を固定表示する場合の上書きマップ */
  layerOverrides?: Record<string, number>;
}

/** 車内LCDの表示グループ（ループ単位）の定義 */
export interface LcdGroup {
  /** グループ名 (例: "通常走行ループ") */
  name: string;
  /** スライドをループ再生するかどうか */
  loop: boolean;
  /** 順番に表示するスライドの配列 */
  slides: LcdSlide[];
}

// --- Action & Preset Root Types ---

/** 1回のメイン操作（右矢印キー等）で実行されるアクションステップの定義 */
export interface ActionStep {
  /** ステップ番号（1始まりの連番） */
  stepNo: number;
  /** 車載器上に表示するステップラベル */
  label: string;
  /** ダイヤ表示の停留所インデックス指定、または "+1" で1つ進める */
  setStopIndex?: number | "+1";
  /** 各レイヤースロットの番号更新指示（"+1" で進める、null で非表示） */
  setLayers?: Record<string, number | "+1" | null>;
  /** 単体の AudioAsset ハッシュID、または "group:<グループ番号>" を指定 */
  playAudioId?: string;
  /** 切り替える LcdGroup の番号 */
  setLcdGroupNo?: number;
}

/** 路線・方向ごとのプリセット全体構造 (preset.json) */
export interface RoutePreset {
  meta: {
    /** プリセット名（路線・方向名） */
    name: string;
  };
  images: Record<string, ImageAsset>;
  layerSlots: Record<string, LayerSlot>;
  audios: Record<string, AudioAsset>;
  audioGroups?: Record<string, AudioGroup>;
  lcdGroups: Record<string, LcdGroup>;
  actions: ActionStep[];
}