import type {
  ActionStep,
  LayerOperationValue,
  LayerSlot,
  AudioSlot,
  LcdSlide,
  ProgressionPhase,
  ResolvedActionState,
  RoutePreset,
} from "./types";

/**
 * プリセットの生成・マイグレーション・状態解決・編集操作を一元管理するサービスクラス
 */
export class PresetService {
  /**
   * 進行パターンのテンプレート（1段階または3段階）を生成する
   * @param pattern "1-step"（案内のみ）または "3-step"（案内・到着・発車）
   * @returns ProgressionPhase の配列
   */
  static createPhaseTemplate(
    pattern: "1-step" | "3-step",
  ): ProgressionPhase[] {
    if (pattern === "1-step") {
      return [
        {
          id: "phase_announce",
          label: "案内",
          lcdGroupNo: 1,
          playAudioSlots: ["announce"],
          applyAtFirstStop: true,
          applyAtMiddleStops: true,
          applyAtLastStop: true,
        },
      ];
    }

    return [
      {
        id: "phase_announce",
        label: "次停留所案内",
        lcdGroupNo: 1,
        playAudioSlots: ["announce"],
        applyAtFirstStop: false,
        applyAtMiddleStops: true,
        applyAtLastStop: true,
      },
      {
        id: "phase_arrive",
        label: "到着 (ドア開)",
        lcdGroupNo: undefined,
        playAudioSlots: ["arrive"],
        applyAtFirstStop: true,
        applyAtMiddleStops: true,
        applyAtLastStop: true,
      },
      {
        id: "phase_depart",
        label: "発車 (ドア閉)",
        lcdGroupNo: 1,
        playAudioSlots: ["depart"],
        applyAtFirstStop: true,
        applyAtMiddleStops: true,
        applyAtLastStop: false,
      },
    ];
  }

  /**
   * 初期状態の空プリセットを生成する
   * @returns 初期化された RoutePreset オブジェクト
   */
  static createDefault(): RoutePreset {
    return {
      meta: { name: "新規プリセット" },
      images: {},
      layerSlots: {
        stop: { name: "停留所名レイヤー", linkedToCsvStop: true, items: {} },
        fare: { name: "運賃表レイヤー", linkedToCsvStop: true, items: {} },
      },
      audios: {},
      audioGroups: {},
      audioSlots: {
        announce: {
          name: "次停留所放送",
          linkedToCsvStop: true,
          inheritPrevious: false,
          items: {},
        },
        arrive: {
          name: "到着・開扉放送",
          linkedToCsvStop: true,
          inheritPrevious: true,
          items: {},
        },
        depart: {
          name: "発車・閉扉放送",
          linkedToCsvStop: true,
          inheritPrevious: true,
          items: {},
        },
      },
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
      stopLcdOverrides: {},
      progressionPhases: this.createPhaseTemplate("3-step"),
      actions: [],
      interrupts: [],
    };
  }

  /**
   * 旧バージョンのプリセット構造を最新構造へ非破壊マイグレーションする
   * @param raw 読み込まれたプリセットオブジェクト
   * @returns マイグレーション済みの RoutePreset
   */
  static ensureMigrated(raw: Partial<RoutePreset>): RoutePreset {
    const defaults = this.createDefault();
    const preset: RoutePreset = {
      meta: raw.meta ?? defaults.meta,
      images: raw.images ?? {},
      layerSlots: raw.layerSlots ?? defaults.layerSlots,
      audios: raw.audios ?? {},
      audioGroups: raw.audioGroups ?? {},
      audioSlots: raw.audioSlots ?? defaults.audioSlots,
      lcdGroups: raw.lcdGroups ?? defaults.lcdGroups,
      stopLcdOverrides: raw.stopLcdOverrides ?? {},
      progressionPhases:
        raw.progressionPhases && raw.progressionPhases.length > 0
          ? raw.progressionPhases
          : defaults.progressionPhases,
      actions: raw.actions ?? [],
      interrupts: raw.interrupts ?? [],
    };

    for (const step of preset.actions) {
      if (!step.playAudioSlots) {
        step.playAudioSlots = [];
      }
    }

    return preset;
  }

  /**
   * 連番キーを持つレコードから次に割り当てる番号文字列を算出する
   * @param record 対象のレコードオブジェクト
   * @returns 次の連番文字列 (例: "1", "2")
   */
  static getNextGroupNumber(record: Record<string, unknown>): string {
    const nums = Object.keys(record)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    return String((nums.length > 0 ? Math.max(...nums) : 0) + 1);
  }

  /**
   * プリセットの初期レイヤー番号マップ（全て0）を生成する
   * @param preset 対象のプリセット
   * @returns 各スロットキーを0に初期化したマップ
   */
  static createInitialLayerIndices(
    preset: RoutePreset,
  ): Record<string, number | null> {
    const indices: Record<string, number | null> = {};
    for (const key of Object.keys(preset.layerSlots)) {
      indices[key] = 0;
    }
    return indices;
  }

  /**
   * 画像レイヤースロットと現在のインデックスから、表示すべき画像ハッシュIDを解決する
   * （対象インデックスが空欄の場合は、それ以前の直近の有効な設定値またはデフォルト画像を継承する）
   * @param slot 対象の画像レイヤースロット
   * @param activeIdx 現在のインデックス
   * @returns 解決された画像ハッシュID（非表示または未設定時は空文字）
   */
  static resolveLayerImageHash(
    slot: LayerSlot | undefined,
    activeIdx: LayerOperationValue | undefined,
  ): string {
    if (!slot || activeIdx === null || activeIdx === undefined || activeIdx === "+1") {
      return "";
    }

    if (slot.linkedToCsvStop === false) {
      return slot.items[String(activeIdx)] || slot.defaultItemId || "";
    }

    for (let i = activeIdx; i >= 0; i--) {
      const candidate = slot.items[String(i)];
      if (candidate) return candidate;
    }

    return slot.defaultItemId || "";
  }

  /**
   * マスター停留所一覧・進行フェーズ定義・例外差し込みステップから、
   * 実際に車載器で実行する全アクションステップ配列を自動構築する
   * @param preset 対象のプリセット
   * @param masterStops CSVから抽出された停留所名配列
   * @returns 実行用の ActionStep 配列
   */
  static buildEffectiveActions(
    preset: RoutePreset,
    masterStops: string[],
  ): ActionStep[] {
    if (masterStops.length === 0) {
      return preset.actions;
    }

    const result: ActionStep[] = [];
    const linkedLayerKeys = Object.entries(preset.layerSlots)
      .filter(([, slot]) => slot.linkedToCsvStop !== false)
      .map(([key]) => key);

    const pushExceptionsFor = (stopIdx: number): void => {
      for (const ex of preset.actions) {
        if (ex.insertAfterStopIdx === stopIdx) {
          result.push({ ...ex, stepNo: result.length + 1 });
        }
      }
    };

    // 始発前の例外ステップ (-1)
    pushExceptionsFor(-1);

    const lastIdx = masterStops.length - 1;
    masterStops.forEach((stopName, sIdx) => {
      const isFirst = sIdx === 0;
      const isLast = sIdx === lastIdx && lastIdx > 0;
      const isMiddle = !isFirst && !isLast;

      const activePhases = preset.progressionPhases.filter(
        (p) =>
          (isFirst && p.applyAtFirstStop) ||
          (isMiddle && p.applyAtMiddleStops) ||
          (isLast && p.applyAtLastStop),
      );

      activePhases.forEach((phase, pIdx) => {
        const isFirstPhaseOfStop = pIdx === 0;
        const setLayers: Record<string, LayerOperationValue> = {};

        if (isFirstPhaseOfStop) {
          for (const key of linkedLayerKeys) {
            setLayers[key] = sIdx;
          }
        }

        const overrideLcd =
          preset.stopLcdOverrides?.[String(sIdx)]?.[phase.id];

        result.push({
          stepNo: result.length + 1,
          label: `${stopName} - ${phase.label}`,
          setStopIndex: isFirstPhaseOfStop ? sIdx : undefined,
          setLcdGroupNo: overrideLcd ?? phase.lcdGroupNo,
          setLayers: isFirstPhaseOfStop ? setLayers : undefined,
          playAudioSlots: [...phase.playAudioSlots],
        });
      });

      // 当該停留所の直後に差し込む例外ステップ
      pushExceptionsFor(sIdx);
    });

    return result;
  }

  /**
   * 音声レイヤースロットと現在の停留所インデックスから、再生すべき音声ID（または "group:番号"）を解決する
   * @param slot 対象の音声レイヤースロット
   * @param stopIndex 現在の停留所インデックス
   * @returns 解決された音声IDまたはグループ指定文字列（無音時は空文字）
   */
  static resolveAudioSlotTargetId(
    slot: AudioSlot | undefined,
    stopIndex: number,
  ): string {
    if (!slot) return "";

    if (!slot.linkedToCsvStop) {
      return slot.defaultItemId || "";
    }

    if (slot.inheritPrevious) {
      for (let i = stopIndex; i >= 0; i--) {
        const candidate = slot.items[String(i)];
        if (candidate === "__NONE__") return "";
        if (candidate) return candidate;
      }
      return slot.defaultItemId || "";
    }

    const direct = slot.items[String(stopIndex)];
    if (direct === "__NONE__") return "";
    return direct || slot.defaultItemId || "";
  }

  /**
   * 先頭(0)から指定インデックスまでのアクションステップを順に畳み込み、
   * 停留所インデックス・LCDグループ番号・各レイヤー番号を算出する
   * @param preset 対象のプリセット
   * @param targetIdx 畳み込む最終ステップのインデックス（負数の場合は初期状態）
   * @param maxStopIdx 停留所インデックスの上限値
   * @param effectiveActions 自動構築済みのステップ配列（省略時は preset.actions）
   * @returns 解決された状態オブジェクト
   */
  static resolveStateUpTo(
    preset: RoutePreset,
    targetIdx: number,
    maxStopIdx: number = Infinity,
    effectiveActions: ActionStep[] = preset.actions,
  ): ResolvedActionState {
    const defaultGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
    const layerIndices = this.createInitialLayerIndices(preset);

    if (targetIdx < 0 || effectiveActions.length === 0) {
      return { stopIndex: 0, lcdGroupNo: defaultGroupNo, layerIndices };
    }

    const clampedIdx = Math.min(targetIdx, effectiveActions.length - 1);
    let stopIndex = 0;
    let lcdGroupNo = defaultGroupNo;

    for (let i = 0; i <= clampedIdx; i++) {
      const step = effectiveActions[i];
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
            layerIndices[slotKey] =
              typeof current === "number" ? current + 1 : 0;
          } else if (typeof op === "number" || op === null) {
            layerIndices[slotKey] = op;
          }
        }
      }
    }

    return { stopIndex, lcdGroupNo, layerIndices };
  }

  /**
   * 単体音声IDまたは音声グループID("group:番号")から再生対象のObject URL配列とファイル名配列を解決する
   * @param preset 対象のプリセット
   * @param audioUrls 音声ハッシュIDからObject URLへのマップ
   * @param targetId 再生対象のIDまたはグループ指定文字列
   * @returns Object URL配列・ファイル名配列・先頭ファイル名
   */
  static resolveAudioSequence(
    preset: RoutePreset,
    audioUrls: Record<string, string>,
    targetId?: string,
  ): { urls: string[]; fileNames: string[]; firstFileName: string } {
    if (!targetId) return { urls: [], fileNames: [], firstFileName: "" };

    if (targetId.startsWith("group:")) {
      const groupNo = targetId.slice(6);
      const group = preset.audioGroups?.[groupNo];
      if (!group || group.audioIds.length === 0) {
        return { urls: [], fileNames: [], firstFileName: "" };
      }
      const urls: string[] = [];
      const fileNames: string[] = [];
      for (const id of group.audioIds) {
        const url = audioUrls[id];
        const fName = preset.audios[id]?.fileName;
        if (url) urls.push(url);
        if (fName) fileNames.push(fName);
      }
      return { urls, fileNames, firstFileName: fileNames[0] ?? "" };
    }

    const firstFileName = preset.audios[targetId]?.fileName ?? "";
    const url = audioUrls[targetId];
    return {
      urls: url ? [url] : [],
      fileNames: firstFileName ? [firstFileName] : [],
      firstFileName,
    };
  }

  /**
   * ステップまたは割り込みで指定された音声スロット配列（および直接指定ID）から、
   * 現在の停留所インデックスに応じた再生URL配列と先頭ファイル名を解決する
   * @param preset 対象のプリセット
   * @param audioUrls 音声ハッシュIDからObject URLへのマップ
   * @param stopIndex 現在の停留所インデックス
   * @param playAudioSlots チェックされた音声スロットキーの配列
   * @param directAudioId 直接指定された音声IDまたはグループID（オプション）
   * @returns 結合されたObject URL配列と先頭ファイル名
   */
  static resolveStepAudios(
    preset: RoutePreset,
    audioUrls: Record<string, string>,
    stopIndex: number,
    playAudioSlots?: string[],
    directAudioId?: string,
  ): { urls: string[]; fileNames: string[]; firstFileName: string } {
    const allUrls: string[] = [];
    const allFileNames: string[] = [];

    for (const slotKey of playAudioSlots ?? []) {
      const slot = preset.audioSlots?.[slotKey];
      const targetId = this.resolveAudioSlotTargetId(slot, stopIndex);
      if (!targetId) continue;

      const seq = this.resolveAudioSequence(preset, audioUrls, targetId);
      allUrls.push(...seq.urls);
      allFileNames.push(...seq.fileNames);
    }

    if (directAudioId) {
      const seq = this.resolveAudioSequence(preset, audioUrls, directAudioId);
      allUrls.push(...seq.urls);
      allFileNames.push(...seq.fileNames);
    }

    return {
      urls: allUrls,
      fileNames: allFileNames,
      firstFileName: allFileNames[0] ?? "",
    };
  }

  /**
   * プリセットから指定した画像アセットの参照を全て解除・削除する
   * @param preset 対象のプリセット
   * @param hashId 削除する画像のハッシュID
   */
  static cleanupImageReferences(preset: RoutePreset, hashId: string): void {
    delete preset.images[hashId];

    for (const slot of Object.values(preset.layerSlots)) {
      if (slot.defaultItemId === hashId) slot.defaultItemId = "";
      for (const [no, imgId] of Object.entries(slot.items)) {
        if (imgId === hashId) slot.items[no] = "";
      }
    }
    for (const grp of Object.values(preset.lcdGroups)) {
      for (const slide of grp.slides) {
        if (slide.baseImageId === hashId) slide.baseImageId = "";
      }
    }
  }

  /**
   * プリセットから指定した音声アセットの参照を全て解除・削除する
   * @param preset 対象のプリセット
   * @param hashId 削除する音声のハッシュID
   */
  static cleanupAudioReferences(preset: RoutePreset, hashId: string): void {
    delete preset.audios[hashId];

    if (preset.audioGroups) {
      for (const grp of Object.values(preset.audioGroups)) {
        grp.audioIds = grp.audioIds.filter((id) => id !== hashId);
      }
    }
    for (const slot of Object.values(preset.audioSlots ?? {})) {
      if (slot.defaultItemId === hashId) slot.defaultItemId = "";
      for (const [no, audId] of Object.entries(slot.items)) {
        if (audId === hashId) slot.items[no] = "";
      }
    }
    for (const step of preset.actions) {
      if (step.playAudioId === hashId) step.playAudioId = undefined;
    }
    for (const intr of preset.interrupts ?? []) {
      if (intr.playAudioId === hashId) intr.playAudioId = undefined;
    }
  }

  /**
   * 画像レイヤースロットを削除し、全スライドの可視レイヤー配列からも除外する
   * @param preset 対象のプリセット
   * @param slotKey 削除するスロットのキー
   */
  static removeLayerSlot(preset: RoutePreset, slotKey: string): void {
    delete preset.layerSlots[slotKey];
    for (const group of Object.values(preset.lcdGroups)) {
      for (const slide of group.slides) {
        slide.visibleLayers = slide.visibleLayers.filter((k) => k !== slotKey);
      }
    }
  }

  /**
   * 音声レイヤースロットを削除し、進行フェーズ・ステップ・割り込みからも除外する
   * @param preset 対象のプリセット
   * @param slotKey 削除する音声スロットのキー
   */
  static removeAudioSlot(preset: RoutePreset, slotKey: string): void {
    delete preset.audioSlots[slotKey];
    for (const phase of preset.progressionPhases) {
      phase.playAudioSlots = phase.playAudioSlots.filter((k) => k !== slotKey);
    }
    for (const step of preset.actions) {
      if (step.playAudioSlots) {
        step.playAudioSlots = step.playAudioSlots.filter((k) => k !== slotKey);
      }
    }
    for (const intr of preset.interrupts) {
      intr.playAudioSlots = intr.playAudioSlots.filter((k) => k !== slotKey);
    }
  }

  /**
   * 文字列配列（visibleLayers や playAudioSlots）に対するチェックボックスON/OFFを切り替える共通ヘルパー
   * @param list 対象のキー配列
   * @param key 追加・削除するキー
   * @param checked チェック状態
   * @returns 更新後の新しい配列
   */
  static toggleKeyInList(
    list: string[] | undefined,
    key: string,
    checked: boolean,
  ): string[] {
    const current = list ?? [];
    if (checked) {
      return current.includes(key) ? current : [...current, key];
    }
    return current.filter((k) => k !== key);
  }

  /**
   * スライドの可視レイヤーのON/OFFを切り替える
   * @param slide 対象のLCDスライド
   * @param slotKey レイヤースロットのキー
   * @param checked 表示する場合はtrue
   */
  static toggleSlideLayer(
    slide: LcdSlide,
    slotKey: string,
    checked: boolean,
  ): void {
    slide.visibleLayers = this.toggleKeyInList(
      slide.visibleLayers,
      slotKey,
      checked,
    );
  }

  /**
   * スライドの特定レイヤーに対する固定番号オーバーライドを設定または解除する
   * @param slide 対象のLCDスライド
   * @param slotKey レイヤースロットのキー
   * @param rawValue 入力された文字列（空文字で解除）
   */
  static setSlideLayerOverride(
    slide: LcdSlide,
    slotKey: string,
    rawValue: string,
  ): void {
    if (!rawValue) {
      delete slide.layerOverrides?.[slotKey];
      return;
    }
    if (!slide.layerOverrides) slide.layerOverrides = {};
    slide.layerOverrides[slotKey] = Number(rawValue);
  }

  /**
   * アクションステップ配列の stepNo を 1 からの連番に振り直す
   * @param actions アクションステップ配列
   */
  static renumberSteps(actions: ActionStep[]): void {
    actions.forEach((step, idx) => {
      step.stepNo = idx + 1;
    });
  }

  /**
   * 新規の例外差し込みアクションステップを末尾に追加する
   * @param preset 対象のプリセット
   */
  static addExceptionStep(preset: RoutePreset): void {
    preset.actions.push({
      stepNo: preset.actions.length + 1,
      label: "特別案内・業務放送",
      insertAfterStopIdx: -1,
      setStopIndex: undefined,
      setLcdGroupNo: undefined,
      setLayers: {},
      playAudioSlots: [],
      playAudioId: undefined,
    });
  }

  /**
   * 指定インデックスのアクションステップを複製して直後に挿入する
   * @param preset 対象のプリセット
   * @param idx 複製元ステップのインデックス
   */
  static duplicateActionStep(preset: RoutePreset, idx: number): void {
    const source = preset.actions[idx];
    if (!source) return;
    const clone: ActionStep = JSON.parse(JSON.stringify(source));
    preset.actions.splice(idx + 1, 0, clone);
    this.renumberSteps(preset.actions);
  }

  /**
   * 指定インデックスのアクションステップを上下に移動する
   * @param preset 対象のプリセット
   * @param idx 移動元インデックス
   * @param direction 移動方向 (-1: 上へ, 1: 下へ)
   */
  static moveActionStep(
    preset: RoutePreset,
    idx: number,
    direction: -1 | 1,
  ): void {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= preset.actions.length) return;
    const temp = preset.actions[idx];
    preset.actions[idx] = preset.actions[targetIdx];
    preset.actions[targetIdx] = temp;
    this.renumberSteps(preset.actions);
  }

  /**
   * 指定インデックスのアクションステップを削除する
   * @param preset 対象のプリセット
   * @param idx 削除するインデックス
   */
  static removeActionStep(preset: RoutePreset, idx: number): void {
    preset.actions.splice(idx, 1);
    this.renumberSteps(preset.actions);
  }

  /**
   * アクションステップ内の特定レイヤー操作値を更新する
   * @param step 対象のアクションステップ
   * @param slotKey レイヤースロットのキー
   * @param val 設定する操作値（undefinedで「変更なし」としてキー削除）
   */
  static updateStepLayerValue(
    step: ActionStep,
    slotKey: string,
    val: LayerOperationValue | undefined,
  ): void {
    if (!step.setLayers) step.setLayers = {};
    if (val === undefined) {
      delete step.setLayers[slotKey];
    } else {
      step.setLayers[slotKey] = val;
    }
  }
}