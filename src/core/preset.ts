import type {
  ActionStep,
  LayerOperationValue,
  LcdSlide,
  MacroGenerateParams,
  ResolvedActionState,
  RoutePreset,
} from "./types";

/**
 * プリセットの生成・状態解決・編集操作を一元管理するサービスクラス
 */
export class PresetService {
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
   * 先頭(0)から指定インデックスまでのアクションステップを順に畳み込み、
   * 停留所インデックス・LCDグループ番号・各レイヤー番号を算出する
   * @param preset 対象のプリセット
   * @param targetIdx 畳み込む最終ステップのインデックス（負数の場合は初期状態）
   * @param maxStopIdx 停留所インデックスの上限値
   * @returns 解決された状態オブジェクト
   */
  static resolveStateUpTo(
    preset: RoutePreset,
    targetIdx: number,
    maxStopIdx: number = Infinity,
  ): ResolvedActionState {
    const defaultGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
    const layerIndices = this.createInitialLayerIndices(preset);

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
   * 単体音声IDまたは音声グループID("group:番号")から再生対象のObject URL配列と先頭ファイル名を解決する
   * @param preset 対象のプリセット
   * @param audioUrls 音声ハッシュIDからObject URLへのマップ
   * @param targetId 再生対象のIDまたはグループ指定文字列
   * @returns Object URL配列と先頭音声ファイル名
   */
  static resolveAudioSequence(
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

  /**
   * プリセットから指定した画像アセットの参照を全て解除・削除する
   * @param preset 対象のプリセット
   * @param hashId 削除する画像のハッシュID
   */
  static cleanupImageReferences(preset: RoutePreset, hashId: string): void {
    delete preset.images[hashId];

    for (const slot of Object.values(preset.layerSlots)) {
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
    for (const step of preset.actions) {
      if (step.playAudioId === hashId) step.playAudioId = undefined;
    }
  }

  /**
   * レイヤースロットを削除し、全スライドの可視レイヤー配列からも除外する
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
    if (checked) {
      if (!slide.visibleLayers.includes(slotKey)) {
        slide.visibleLayers = [...slide.visibleLayers, slotKey];
      }
    } else {
      slide.visibleLayers = slide.visibleLayers.filter((k) => k !== slotKey);
    }
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
   * 新規アクションステップを末尾に追加する
   * @param preset 対象のプリセット
   */
  static addActionStep(preset: RoutePreset): void {
    const isFirst = preset.actions.length === 0;
    const defaultGroupNo = Number(Object.keys(preset.lcdGroups)[0] ?? 1);

    preset.actions.push({
      stepNo: preset.actions.length + 1,
      label: isFirst ? "始発待機" : "次停留所案内",
      setStopIndex: isFirst ? 0 : undefined,
      setLcdGroupNo: isFirst ? defaultGroupNo : undefined,
      setLayers: isFirst ? { stop: 0, fare: 0 } : { stop: "+1" },
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

  /**
   * マスター停留所リストとマクロ設定から全停留所分のアクションステップを一括生成する
   * @param preset 対象のプリセット
   * @param masterStops マスター停留所名リスト
   * @param params 一括生成マクロの設定パラメータ
   */
  static generateStepsFromCsv(
    preset: RoutePreset,
    masterStops: string[],
    params: MacroGenerateParams,
  ): void {
    if (masterStops.length === 0) return;

    const linkedLayerKeys = Object.entries(preset.layerSlots)
      .filter(([, slot]) => slot.linkedToCsvStop)
      .map(([key]) => key);

    const initLayers: Record<string, number> = {};
    for (const key of Object.keys(preset.layerSlots)) {
      initLayers[key] = 0;
    }

    const advanceLayers: Record<string, "+1"> = {};
    for (const key of linkedLayerKeys) {
      advanceLayers[key] = "+1";
    }

    const generated: ActionStep[] = [];

    if (params.pattern === "1-step") {
      masterStops.forEach((stopName, sIdx) => {
        if (sIdx === 0) {
          generated.push({
            stepNo: 1,
            label: "業務放送",
            setStopIndex: 0,
            setLcdGroupNo: params.runningGroupNo,
            setLayers: { ...initLayers },
          });
        } else {
          generated.push({
            stepNo: 1,
            label: `案内: ${stopName}`,
            setStopIndex: "+1",
            setLayers: { ...advanceLayers },
          });
        }
      });
    } else {
      masterStops.forEach((stopName, sIdx) => {
        if (sIdx === 0) {
          generated.push({
            stepNo: 1,
            label: `${stopName} (ドア開)`,
            setStopIndex: 0,
            setLcdGroupNo: params.stoppingGroupNo ?? params.runningGroupNo,
            setLayers: { ...initLayers },
            playAudioId: params.arriveAudioId,
          });
          generated.push({
            stepNo: 1,
            label: `${stopName} (ドア閉)`,
            playAudioId: params.closeAudioId,
          });
        } else {
          generated.push({
            stepNo: 1,
            label: `案内: ${stopName}`,
            setStopIndex: "+1",
            setLcdGroupNo: params.runningGroupNo,
            setLayers: { ...advanceLayers },
          });
          generated.push({
            stepNo: 1,
            label: `${stopName} (ドア開)`,
            setLcdGroupNo: params.stoppingGroupNo,
            playAudioId: params.arriveAudioId,
          });
          if (sIdx < masterStops.length - 1) {
            generated.push({
              stepNo: 1,
              label: `${stopName} (ドア閉)`,
              playAudioId: params.closeAudioId,
            });
          }
        }
      });
    }

    preset.actions = generated;
    this.renumberSteps(preset.actions);
  }
}