// --- Asset & Preset Types ---

/** 変換後のAVIF画像ファイルと元の表示名の紐づけ情報 */
export interface ImageAsset {
  /** アーカイブ内の実ファイル名 (例: "a1b2c3d4e5f6.avif") */
  fileName: string;
  /** エディタ表示用の元ファイル名 (例: "運賃_240円.png") */
  originalName: string;
}

/** 変換後のOpus音声ファイルと元の表示名の紐づけ情報 */
export interface AudioAsset {
  /** アーカイブ内の実ファイル名 (例: "a1b2c3d4e5f6.opus") */
  fileName: string;
  /** エディタ表示用の元ファイル名 (例: "到着案内.wav") */
  originalName: string;
}

/** 複数の音声アセットを順番に連続再生する音声グループの定義 */
export interface AudioGroup {
  /** グループ名 (例: "次停留所案内_瀬河原") */
  name: string;
  /** 順番に連続再生する AudioAsset のハッシュID配列 */
  audioIds: string[];
}

/** ベース画像の上に重ねる透過画像レイヤースロットの定義 */
export interface LayerSlot {
  /** エディタ上の表示名 (例: "停留所名レイヤー") */
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

/** レイヤー番号の操作指示値（番号指定、"+1" で進める、null で非表示） */
export type LayerOperationValue = number | "+1" | null;

/** 1回のメイン操作（右矢印キー等）で実行されるアクションステップの定義 */
export interface ActionStep {
  /** ステップ番号（1始まりの連番） */
  stepNo: number;
  /** 車載器上に表示するステップラベル */
  label: string;
  /** ダイヤ表示の停留所インデックス指定、または "+1" で1つ進める */
  setStopIndex?: number | "+1";
  /** 各レイヤースロットの番号更新指示 */
  setLayers?: Record<string, LayerOperationValue>;
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

/** アクションステップ畳み込み計算後の解決済み状態 */
export interface ResolvedActionState {
  stopIndex: number;
  lcdGroupNo: string;
  layerIndices: Record<string, number | null>;
}

/** CSVからのアクションステップ一括生成マクロの設定パラメータ */
export interface MacroGenerateParams {
  pattern: "1-step" | "3-step";
  runningGroupNo?: number;
  stoppingGroupNo?: number;
  arriveAudioId?: string;
  closeAudioId?: string;
}

// --- Timetable Types ---

/** 1つの停留所における到着・発車予定時刻 */
export interface StopSchedule {
  name: string;
  arrival: string | null;
  departure: string | null;
}

/** 1便分の運行ダイヤ情報 */
export interface BusTrip {
  trainNumber: string;
  operationDay: string;
  operationNumber: string;
  destination: string;
  stops: StopSchedule[];
}

// --- Archive & App State Types ---

/** メモリ上に保持する展開済みアーカイブデータ */
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

/** Rust側から返却されるネイティブファイル読込結果 */
export interface RawFilePayload {
  path: string;
  fileName: string;
  data: number[];
}

/** 起動時のパス一括読み込み結果ペイロード */
export interface StartupLoadPayload {
  loaded: RawFilePayload[];
  missing: string[];
}

/** 車載器・エディタで管理する読み込み済みプリセット単位のアイテム */
export interface LoadedPresetItem extends LoadedArchive {
  id: string;
  fileName: string;
  /** ローカルディスク上のフルパス（Web環境や新規未保存時はundefined） */
  filePath?: string;
  /** 最終保存・読込時点の変更検知用スナップショット文字列 */
  savedSnapshot: string;
}

/** アセット変換結果の共通構造 */
export interface ConvertedAssetResult<T> {
  hashId: string;
  asset: T;
  binary: Uint8Array;
  objectUrl: string;
}

/** Rust側ローカルHTTPサーバーへ同期するLCD・音声状態のペイロード */
export interface LcdSyncPayload {
  preset: RoutePreset | null;
  groupNo: string;
  slideIdx: number;
  layerIndices: Record<string, LayerOperationValue>;
  imageBlobs: Record<string, Uint8Array>;
  playingAudioFile?: string;
  audioNonce?: number;
}

// --- Changelog & Release Types ---

/** Gitコミット履歴の1エントリ */
export interface CommitEntry {
  hash: string;
  date: string;
  subject: string;
  versionTag?: string;
}

/** 配布バイナリのダウンロードURLマップ */
export interface ReleaseDownloadUrls {
  windows: string;
  rpm: string;
  deb: string;
  appImage: string;
}