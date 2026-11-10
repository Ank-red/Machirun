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

/** ステップ計算結果の状態 */
export interface ResolvedActionState {
  stopIndex: number;
  lcdGroupNo: string;
  layerIndices: Record<string, number | null>;
}

/**
 * 初期状態の空プリセットを生成する
 */
export function createDefaultPreset(): RoutePreset {
  return {
    meta: { name: "新規プリセット" },
    images: {},
    layerSlots: {
      stop: { name: "停留所名レイヤー", linkedToCsvStop: true, items: {} },
      fare: { name: "運賃表レイヤー", items: {} },
    },
    audios: {},
    audioGroups: {},
    lcdGroups: {
      "1": {
        name: "通常走行ループ",
        loop: true,
        slides: [
          {
            baseImageId: "",
            durationSec: 8,
            visibleLayers: ["stop", "fare"],
          },
        ],
      },
    },
    actions: [],
  };
}

/**
 * 先頭(0)から指定インデックスまでのアクションステップを順に畳み込み、
 * 停留所インデックス・LCDグループ番号・各レイヤー番号を算出する
 */
export function resolveActionStateUpTo(
  preset: RoutePreset,
  targetIdx: number,
  maxStopIdx: number = Infinity,
): ResolvedActionState {
  const defaultGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
  const layerIndices: Record<string, number | null> = {};
  for (const key of Object.keys(preset.layerSlots)) {
    layerIndices[key] = 0;
  }

  if (targetIdx < 0 || preset.actions.length === 0) {
    return { stopIndex: 0, lcdGroupNo: defaultGroupNo, layerIndices };
  }

  const clampedIdx = Math.min(targetIdx, preset.actions.length - 1);
  let stopIndex = 0;
  let lcdGroupNo = defaultGroupNo;

  for (let i = 0; i <= clampedIdx; i++) {
    const step = preset.actions[i];
    if (!step) continue;

    if (step.setStopIndex !== undefined) {
      stopIndex =
        step.setStopIndex === "+1"
          ? Math.min(maxStopIdx, stopIndex + 1)
          : Math.min(maxStopIdx, step.setStopIndex);
    }

    if (step.setLcdGroupNo !== undefined) {
      lcdGroupNo = String(step.setLcdGroupNo);
    }

    if (step.setLayers) {
      for (const [slotKey, op] of Object.entries(step.setLayers)) {
        if (op === "+1") {
          const current = layerIndices[slotKey];
          layerIndices[slotKey] = typeof current === "number" ? current + 1 : 0;
        } else if (typeof op === "number" || op === null) {
          layerIndices[slotKey] = op;
        }
      }
    }
  }

  return { stopIndex, lcdGroupNo, layerIndices };
}

/**
 * 単体音声IDまたは音声グループID("group:番号")から再生対象のObject URL配列と先頭ファイル名を解決する
 */
export function resolveAudioSequence(
  preset: RoutePreset,
  audioUrls: Record<string, string>,
  targetId?: string,
): { urls: string[]; firstFileName: string } {
  if (!targetId) return { urls: [], firstFileName: "" };

  if (targetId.startsWith("group:")) {
    const groupNo = targetId.slice(6);
    const group = preset.audioGroups?.[groupNo];
    if (!group || group.audioIds.length === 0) {
      return { urls: [], firstFileName: "" };
    }
    const firstFileName = preset.audios[group.audioIds[0]]?.fileName ?? "";
    const urls = group.audioIds
      .map((id) => audioUrls[id])
      .filter((url): url is string => Boolean(url));
    return { urls, firstFileName };
  }

  const firstFileName = preset.audios[targetId]?.fileName ?? "";
  const url = audioUrls[targetId];
  return { urls: url ? [url] : [], firstFileName };
}