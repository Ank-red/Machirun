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
  /** 停留所データ表と連動させるかどうかのフラグ */
  linkedToCsvStop?: boolean;
  /** 全停留所共通のデフォルト画像ID（未指定停留所の初期値） */
  defaultItemId?: string;
  /** 停留所番号（またはレイヤー番号）から ImageAsset のハッシュIDへのマップ（空文字は「前を維持」） */
  items: Record<string, string>;
}

/** 停留所進行やフェーズに応じて再生する音声レイヤースロットの定義 */
export interface AudioSlot {
  /** エディタ上の表示名 (例: "次停留所案内", "到着・開扉放送") */
  name: string;
  /** 停留所データ表の各行で個別に指定するかどうかのフラグ */
  linkedToCsvStop?: boolean;
  /** 空欄（未指定）の停留所で、直前の停留所の音声を引き継ぐかどうか（運賃表・行先案内型） */
  inheritPrevious?: boolean;
  /** 全停留所共通または初期値となる AudioAsset ID または "group:<番号>" */
  defaultItemId?: string;
  /** 停留所番号から AudioAsset ID または "group:<番号>" へのマップ（"__NONE__" で明示的に無音化） */
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

/** 1停留所あたりの共通進行パターンの1フェーズ定義 */
export interface ProgressionPhase {
  /** フェーズID */
  id: string;
  /** 車載器上に表示するフェーズ名（例: "案内", "到着 (ドア開)", "発車 (ドア閉)"） */
  label: string;
  /** このフェーズで切り替えるLCDグループ番号（undefinedで変更なし） */
  lcdGroupNo?: number;
  /** このフェーズで再生する AudioSlot キーの配列（チェックボックスONの項目） */
  playAudioSlots: string[];
  /** 始発停留所（#0）でこのフェーズを実行するかどうか */
  applyAtFirstStop: boolean;
  /** 途中停留所（#1〜#N-1）でこのフェーズを実行するかどうか */
  applyAtMiddleStops: boolean;
  /** 終点停留所（#N）でこのフェーズを実行するかどうか */
  applyAtLastStop: boolean;
}

/** 1回のメイン操作（右矢印キー等）で実行されるアクションステップ（自動合成後または例外差し込み用） */
export interface ActionStep {
  /** ステップ番号（1始まりの連番） */
  stepNo: number;
  /** 車載器上に表示するステップラベル */
  label: string;
  /** 例外アクションの差し込み位置（-1: 始発の前, 0〜N: 指定停留所インデックスの直後） */
  insertAfterStopIdx?: number;
  /** ダイヤ表示の停留所インデックス指定、または "+1" で1つ進める */
  setStopIndex?: number | "+1";
  /** 各画像レイヤースロットの番号更新指示 */
  setLayers?: Record<string, LayerOperationValue>;
  /** このステップで鳴らす音声スロットキー配列（チェックボックス方式） */
  playAudioSlots?: string[];
  /** 旧仕様互換または例外ステップ直接指定用の単体音声ID / "group:<番号>" */
  playAudioId?: string;
  /** 切り替える LcdGroup の番号 */
  setLcdGroupNo?: number;
}

/** 別ショートカットキーによる割り込みアクション定義（降車ボタン「次止まります」等） */
export interface InterruptAction {
  /** 割り込み定義の一意ID */
  id: string;
  /** 表示ラベル（例: "降車ボタン (次止まります)"） */
  label: string;
  /** トリガーとなるキーコード（例: "Space", "Enter", "Digit1"） */
  shortcutKey: string;
  /** 割り込み時に切り替えるLCDグループ番号（undefinedで維持） */
  lcdGroupNo?: number;
  /** 割り込み時に再生する音声スロットキー配列（チェックボックス方式） */
  playAudioSlots: string[];
  /** 直接指定の音声IDまたは "group:<番号>" */
  playAudioId?: string;
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
  audioSlots: Record<string, AudioSlot>;
  lcdGroups: Record<string, LcdGroup>;
  /** 停留所インデックス -> (フェーズID -> 上書きするLCDグループ番号) のマップ */
  stopLcdOverrides?: Record<string, Record<string, number>>;
  /** 共通の進行フェーズ定義配列 */
  progressionPhases: ProgressionPhase[];
  /** 例外差し込みアクションステップ配列（旧プリセット読込時はレガシーステップを保持） */
  actions: ActionStep[];
  /** ショートカット割り込みアクション配列 */
  interrupts: InterruptAction[];
}

/** アクションステップ畳み込み計算後の解決済み状態 */
export interface ResolvedActionState {
  stopIndex: number;
  lcdGroupNo: string;
  layerIndices: Record<string, number | null>;
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
  playingAudioFiles?: string[];
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