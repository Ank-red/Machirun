<script lang="ts">
  // --- Imports ---
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { RoutePreset, LcdSlide, ActionStep } from "./preset";
  import { extractMasterStops } from "./timetable";
  import {
    processImageToAvif,
    processAudioToOpus,
    exportArchiveMchrn,
    importArchiveMchrn,
  } from "./archive";
  import {
    broadcastLcdState,
    broadcastLcdAssets,
    lcdChannel,
    type LcdSyncMessage,
  } from "./lcdChannel";
  import LcdScreen from "./LcdScreen.svelte";
  import FileButton from "./FileButton.svelte";
  import Dropdown from "./Dropdown.svelte";

  // --- Constants ---
  const isTauri = "__TAURI_INTERNALS__" in window;

  let {
    preset = $bindable<RoutePreset>({
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
    }),
    timetableCsv = $bindable(""),
    imageBlobs = $bindable<Record<string, Uint8Array>>({}),
    imageUrls = $bindable<Record<string, string>>({}),
    audioBlobs = $bindable<Record<string, Uint8Array>>({}),
    audioUrls = $bindable<Record<string, string>>({}),
  }: {
    preset?: RoutePreset;
    timetableCsv?: string;
    imageBlobs?: Record<string, Uint8Array>;
    imageUrls?: Record<string, string>;
    audioBlobs?: Record<string, Uint8Array>;
    audioUrls?: Record<string, string>;
  } = $props();

  // --- State & Derived ---
  let activeTab = $state<"base" | "layers" | "lcd" | "actions">("base");
  let newSlotKey = $state("");
  let newSlotName = $state("");
  let isLoopPreviewing = $state(false);

  let masterStops = $derived(
    timetableCsv ? extractMasterStops(timetableCsv) : [],
  );

  let isRegisteringImage = $state(false);
  let isRegisteringAudio = $state(false);

  let previewGroupNo = $state("1");
  let previewSlideIdx = $state(0);
  let previewLayerIndices = $state<Record<string, number>>({
    stop: 0,
    fare: 0,
  });

  let currentPreviewSlide = $derived<LcdSlide | undefined>(
    preset.lcdGroups[previewGroupNo]?.slides[previewSlideIdx],
  );

  let activePreviewStepIdx = $state<number | null>(null);
  let previewAudioPlayer: HTMLAudioElement | null = null;

  let imageOptions = $derived([
    { value: "", label: "-- 画像を選択 --" },
    ...Object.entries(preset.images).map(([id, asset]) => ({
      value: id,
      label: `${asset.originalName} (${id.slice(0, 6)})`,
    })),
  ]);

  let lcdGroupOptions = $derived(
    Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
      value: gNo,
      label: `#${gNo}: ${grp.name}`,
    })),
  );

  let expandedStepIdx = $state<number | null>(null);
  let macroPattern = $state<"1-step" | "3-step">("3-step");
  let macroRunningGroupNo = $state<number | undefined>(1);
  let macroStoppingGroupNo = $state<number | undefined>(undefined);
  let macroArriveAudioId = $state<string | undefined>(undefined);
  let macroCloseAudioId = $state<string | undefined>(undefined);
  let audioSelectOptions = $derived([
    { value: undefined, label: "再生しない" },
    ...Object.entries(preset.audioGroups ?? {}).map(([gNo, grp]) => ({
      value: `group:${gNo}`,
      label: `[グループ #${gNo}] ${grp.name}`,
    })),
    ...Object.entries(preset.audios).map(([audId, asset]) => ({
      value: audId,
      label: `${asset.originalName} (${audId.slice(0, 6)})`,
    })),
  ]);

  // --- Handlers & Methods ---

  /**
   * 選択されたダイヤグラムCSVファイルをテキストとして読み込む
   * @param files 選択されたFileList
   */
  async function handleCsvRegister(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    timetableCsv = await file.text();
  }

  /**
   * 選択された画像ファイルをAVIFへ一括変換し、プリセットに登録する
   * @param files 選択されたFileList
   */
  async function handleImageRegister(files: FileList): Promise<void> {
    const fileList = Array.from(files);
    isRegisteringImage = true;
    try {
      for (const file of fileList) {
        try {
          const res = await processImageToAvif(file);
          preset.images[res.hashId] = res.asset;
          imageBlobs[res.asset.fileName] = res.binary;
          imageUrls[res.hashId] = res.objectUrl;
        } catch (err) {
          console.error(`画像変換エラー (${file.name}):`, err);
        }
      }
    } finally {
      isRegisteringImage = false;
    }
  }

  /**
   * 既存の画像アセットを同じハッシュIDのまま別ファイルで差し替える
   * @param hashId 差し替え対象の画像ハッシュID
   * @param files 選択されたFileList
   */
  async function handleImageReplace(
    hashId: string,
    files: FileList,
  ): Promise<void> {
    const file = files[0];
    if (!file) return;
    isRegisteringImage = true;
    try {
      if (imageUrls[hashId]) URL.revokeObjectURL(imageUrls[hashId]);
      const res = await processImageToAvif(file, hashId);
      preset.images[hashId] = res.asset;
      imageBlobs[res.asset.fileName] = res.binary;
      imageUrls[hashId] = res.objectUrl;
    } catch (err) {
      console.error(`画像差し替えエラー (${file.name}):`, err);
    } finally {
      isRegisteringImage = false;
    }
  }

  /**
   * 指定した画像アセットを削除し、参照しているレイヤーやスライドからも除外する
   * @param hashId 削除対象の画像ハッシュID
   */
  function handleImageRemove(hashId: string): void {
    const asset = preset.images[hashId];
    if (!asset) return;

    if (imageUrls[hashId]) {
      URL.revokeObjectURL(imageUrls[hashId]);
      delete imageUrls[hashId];
    }
    delete imageBlobs[asset.fileName];
    delete preset.images[hashId];

    // レイヤースロット内の参照をクリア
    for (const slot of Object.values(preset.layerSlots)) {
      for (const [no, imgId] of Object.entries(slot.items)) {
        if (imgId === hashId) {
          slot.items[no] = "";
        }
      }
    }

    // LCDスライドのベース画像参照をクリア
    for (const grp of Object.values(preset.lcdGroups)) {
      for (const slide of grp.slides) {
        if (slide.baseImageId === hashId) {
          slide.baseImageId = "";
        }
      }
    }
  }

  /**
   * 選択された音声ファイルをOpusへ一括変換し、プリセットに登録する
   * @param files 選択されたFileList
   */
  async function handleAudioRegister(files: FileList): Promise<void> {
    const fileList = Array.from(files);
    isRegisteringAudio = true;
    try {
      for (const file of fileList) {
        try {
          const res = await processAudioToOpus(file);
          preset.audios[res.hashId] = res.asset;
          audioBlobs[res.asset.fileName] = res.binary;
          audioUrls[res.hashId] = res.objectUrl;
        } catch (err) {
          console.error(`音声変換エラー (${file.name}):`, err);
        }
      }
    } finally {
      isRegisteringAudio = false;
    }
  }

  /**
   * 既存の音声アセットを同じハッシュIDのまま別ファイルで差し替える
   * @param hashId 差し替え対象の音声ハッシュID
   * @param files 選択されたFileList
   */
  async function handleAudioReplace(
    hashId: string,
    files: FileList,
  ): Promise<void> {
    const file = files[0];
    if (!file) return;
    isRegisteringAudio = true;
    try {
      if (audioUrls[hashId]) URL.revokeObjectURL(audioUrls[hashId]);
      const res = await processAudioToOpus(file, hashId);
      preset.audios[hashId] = res.asset;
      audioBlobs[res.asset.fileName] = res.binary;
      audioUrls[hashId] = res.objectUrl;
    } catch (err) {
      console.error(`音声差し替えエラー (${file.name}):`, err);
    } finally {
      isRegisteringAudio = false;
    }
  }

  /**
   * 指定した音声アセットを削除し、音声グループやアクションステップからも除外する
   * @param hashId 削除対象の音声ハッシュID
   */
  function handleAudioRemove(hashId: string): void {
    const asset = preset.audios[hashId];
    if (!asset) return;

    if (audioUrls[hashId]) {
      URL.revokeObjectURL(audioUrls[hashId]);
      delete audioUrls[hashId];
    }
    delete audioBlobs[asset.fileName];
    delete preset.audios[hashId];

    // 音声グループ内の参照を除外
    if (preset.audioGroups) {
      for (const grp of Object.values(preset.audioGroups)) {
        grp.audioIds = grp.audioIds.filter((id) => id !== hashId);
      }
    }

    // アクションステップの参照をクリア
    for (const step of preset.actions) {
      if (step.playAudioId === hashId) {
        step.playAudioId = undefined;
      }
    }
  }

  /**
   * 新しいレイヤースロットを追加する
   */
  function addLayerSlot(): void {
    const key = newSlotKey.trim();
    const name = newSlotName.trim();
    if (!key || !name || preset.layerSlots[key]) return;

    preset.layerSlots[key] = {
      name,
      linkedToCsvStop: false,
      items: {},
    };
    previewLayerIndices[key] = 0;
    newSlotKey = "";
    newSlotName = "";
  }

  /**
   * 指定したレイヤースロットを削除する
   * @param slotKey 削除するスロットのキー
   */
  function removeLayerSlot(slotKey: string): void {
    delete preset.layerSlots[slotKey];
    delete previewLayerIndices[slotKey];
    for (const group of Object.values(preset.lcdGroups)) {
      for (const slide of group.slides) {
        slide.visibleLayers = slide.visibleLayers.filter((k) => k !== slotKey);
      }
    }
  }

  /**
   * CSVのマスター停留所数に合わせてレイヤー番号枠を一括生成する
   * @param slotKey 対象スロットのキー
   */
  function syncSlotItemsWithCsv(slotKey: string): void {
    const slot = preset.layerSlots[slotKey];
    if (!slot || masterStops.length === 0) return;

    for (let i = 0; i < masterStops.length; i++) {
      const no = String(i);
      if (!(no in slot.items)) {
        slot.items[no] = "";
      }
    }
  }

  /**
   * 新しいLCDグループを追加し、プレビュー対象をそのグループに切り替える
   */
  function addLcdGroup(): void {
    const existingNos = Object.keys(preset.lcdGroups)
      .map(Number)
      .filter((n) => !isNaN(n));
    const nextNo = String(
      (existingNos.length > 0 ? Math.max(...existingNos) : 0) + 1,
    );
    preset.lcdGroups[nextNo] = {
      name: `グループ #${nextNo}`,
      loop: true,
      slides: [{ baseImageId: "", durationSec: 8, visibleLayers: [] }],
    };
    previewGroupNo = nextNo;
    previewSlideIdx = 0;
  }

  /**
   * 指定したLCDグループを削除する
   * @param groupNo 削除対象のグループ番号
   */
  function removeLcdGroup(groupNo: string): void {
    delete preset.lcdGroups[groupNo];
    const remainingKeys = Object.keys(preset.lcdGroups);
    previewGroupNo = remainingKeys[0] ?? "";
    previewSlideIdx = 0;
  }

  /**
   * 選択中のLCDグループに新しいスライドを追加する
   * @param groupNo 対象グループ番号
   */
  function addSlide(groupNo: string): void {
    const group = preset.lcdGroups[groupNo];
    if (!group) return;
    group.slides.push({
      baseImageId: "",
      durationSec: 6,
      visibleLayers: [],
    });
    previewSlideIdx = group.slides.length - 1;
  }

  /**
   * 指定したスライドを削除する
   * @param groupNo 対象グループ番号
   * @param slideIdx 削除するスライドのインデックス
   */
  function removeSlide(groupNo: string, slideIdx: number): void {
    const group = preset.lcdGroups[groupNo];
    if (!group || group.slides.length <= 1) return;
    group.slides.splice(slideIdx, 1);
    if (previewSlideIdx >= group.slides.length) {
      previewSlideIdx = Math.max(0, group.slides.length - 1);
    }
  }

  /**
   * スライド内の特定レイヤーの表示・非表示を切り替える
   * @param slide 対象スライド
   * @param slotKey レイヤースロットのキー
   * @param checked 表示する場合はtrue
   */
  function toggleSlideLayer(
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
   * スライド個別のレイヤー番号上書き（layerOverrides）を設定・解除する
   * @param slide 対象スライド
   * @param slotKey レイヤースロットのキー
   * @param rawValue 入力された番号文字列（空文字の場合は上書き解除）
   */
  function setSlideLayerOverride(
    slide: LcdSlide,
    slotKey: string,
    rawValue: string,
  ): void {
    if (!rawValue) {
      if (slide.layerOverrides) {
        delete slide.layerOverrides[slotKey];
      }
      return;
    }
    if (!slide.layerOverrides) {
      slide.layerOverrides = {};
    }
    slide.layerOverrides[slotKey] = Number(rawValue);
  }

  /**
   * 単体音声IDまたは音声グループ（"group:番号"）を順番に連続再生する
   * @param targetId 再生対象のID（AudioAssetのhashId または "group:番号"）
   */
  function playAudioSequence(targetId?: string): void {
    if (previewAudioPlayer) {
      previewAudioPlayer.pause();
      previewAudioPlayer = null;
    }
    if (!targetId) return;

    const queue: string[] = [];
    if (targetId.startsWith("group:")) {
      const gNo = targetId.slice(6);
      const grp = preset.audioGroups?.[gNo];
      if (grp) {
        for (const id of grp.audioIds) {
          if (audioUrls[id]) queue.push(audioUrls[id]);
        }
      }
    } else if (audioUrls[targetId]) {
      queue.push(audioUrls[targetId]);
    }

    if (queue.length === 0) return;

    let currentIdx = 0;
    const playNext = () => {
      if (currentIdx >= queue.length) return;
      previewAudioPlayer = new Audio(queue[currentIdx]);
      currentIdx++;
      previewAudioPlayer.onended = playNext;
      previewAudioPlayer
        .play()
        .catch((err) => console.error("Audio Play Error:", err));
    };
    playNext();
  }

  /**
   * 新しい音声グループを追加する
   */
  function addAudioGroup(): void {
    if (!preset.audioGroups) preset.audioGroups = {};
    const nums = Object.keys(preset.audioGroups)
      .map(Number)
      .filter((n) => !isNaN(n));
    const nextNo = String((nums.length > 0 ? Math.max(...nums) : 0) + 1);
    preset.audioGroups[nextNo] = {
      name: `音声グループ #${nextNo}`,
      audioIds: [""],
    };
  }

  /**
   * 全アクションステップの stepNo を 1 からの連番に振り直す
   */
  function renumberActionSteps(): void {
    preset.actions.forEach((step, idx) => {
      step.stepNo = idx + 1;
    });
  }

  /**
   * 新しいアクションステップを末尾に追加する
   */
  function addActionStep(): void {
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
   * 指定したアクションステップを複製して直後に挿入する
   * @param idx 複製元のインデックス
   */
  function duplicateActionStep(idx: number): void {
    const source = preset.actions[idx];
    if (!source) return;
    const clone: ActionStep = JSON.parse(JSON.stringify(source));
    preset.actions.splice(idx + 1, 0, clone);
    renumberActionSteps();
  }

  /**
   * アクションステップの順序を上下に入れ替える
   * @param idx 移動元のインデックス
   * @param direction -1 で上へ、1 で下へ移動
   */
  function moveActionStep(idx: number, direction: -1 | 1): void {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= preset.actions.length) return;
    const temp = preset.actions[idx];
    preset.actions[idx] = preset.actions[targetIdx];
    preset.actions[targetIdx] = temp;
    renumberActionSteps();
  }

  /**
   * 指定したアクションステップを削除する
   * @param idx 削除対象のインデックス
   */
  function removeActionStep(idx: number): void {
    preset.actions.splice(idx, 1);
    renumberActionSteps();
  }

  /**
   * レイヤー制御（setLayers）の選択値を更新する
   * @param step 対象ステップ
   * @param slotKey レイヤースロットのキー
   * @param val 選択された操作値（undefinedの場合はキーを削除）
   */
  function updateStepLayerValue(
    step: ActionStep,
    slotKey: string,
    val: number | "+1" | null | undefined,
  ): void {
    if (!step.setLayers) {
      step.setLayers = {};
    }
    if (val === undefined) {
      delete step.setLayers[slotKey];
    } else {
      step.setLayers[slotKey] = val;
    }
  }

  /**
   * 先頭から指定インデックスまでのステップを順番にシミュレートし、
   * 右カラムのLCDプレビュー状態と音声再生に反映する
   * @param targetIdx テスト実行するステップのインデックス
   */
  function simulateStepAt(targetIdx: number): void {
    activePreviewStepIdx = targetIdx;

    const simulatedLayers: Record<string, number> = {};
    for (const key of Object.keys(preset.layerSlots)) {
      simulatedLayers[key] = 0;
    }
    let simulatedGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";

    for (let i = 0; i <= targetIdx; i++) {
      const step = preset.actions[i];
      if (!step) continue;

      if (step.setLcdGroupNo !== undefined) {
        simulatedGroupNo = String(step.setLcdGroupNo);
      }

      if (step.setLayers) {
        for (const [slotKey, op] of Object.entries(step.setLayers)) {
          if (op === "+1") {
            simulatedLayers[slotKey] = (simulatedLayers[slotKey] ?? 0) + 1;
          } else if (typeof op === "number") {
            simulatedLayers[slotKey] = op;
          } else if (op === null) {
            simulatedLayers[slotKey] = -1;
          }
        }
      }
    }

    previewGroupNo = simulatedGroupNo;
    previewSlideIdx = 0;
    previewLayerIndices = simulatedLayers;

    // 対象ステップに音声が設定されていれば再生
    const targetStep = preset.actions[targetIdx];
    playAudioSequence(targetStep?.playAudioId);
  }

  /**
   * CSVのマスター停留所リストに基づき、1段階式または3段階式の全アクションステップを一括生成する
   */
  function generateStepsFromCsv(): void {
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

    if (macroPattern === "1-step") {
      masterStops.forEach((stopName, sIdx) => {
        if (sIdx === 0) {
          generated.push({
            stepNo: 1,
            label: `業務放送`,
            setStopIndex: 0,
            setLcdGroupNo: macroRunningGroupNo,
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
            setLcdGroupNo: macroStoppingGroupNo ?? macroRunningGroupNo,
            setLayers: { ...initLayers },
            playAudioId: macroArriveAudioId,
          });
          generated.push({
            stepNo: 1,
            label: `${stopName} (ドア閉)`,
            playAudioId: macroCloseAudioId,
          });
        } else {
          generated.push({
            stepNo: 1,
            label: `案内: ${stopName}`,
            setStopIndex: "+1",
            setLcdGroupNo: macroRunningGroupNo,
            setLayers: { ...advanceLayers },
          });
          generated.push({
            stepNo: 1,
            label: `${stopName} (ドア開)`,
            setLcdGroupNo: macroStoppingGroupNo,
            playAudioId: macroArriveAudioId,
          });
          if (sIdx < masterStops.length - 1) {
            generated.push({
              stepNo: 1,
              label: `${stopName} (ドア閉)`,
              playAudioId: macroCloseAudioId,
            });
          }
        }
      });
    }

    preset.actions = generated;
    renumberActionSteps();
    expandedStepIdx = null;
  }

  /**
   * 現在編集中のプリセット一式を .mchrn アーカイブとしてダウンロード保存する
   */
  async function handleExport(): Promise<boolean> {
    const dataMchrn = exportArchiveMchrn({
      preset,
      timetableCsv,
      imageBlobs,
      imageUrls,
      audioBlobs,
      audioUrls,
    });
    if (isTauri) {
      try {
        // Rust側のネイティブ保存ダイアログを呼び出し
        const savedPath = await invoke<string>("save_mchrn_file", {
          defaultName: `${preset.meta.name || "preset"}.mchrn`,
          data: Array.from(dataMchrn.Unit8Array),
        });
        console.log("Saved to:", savedPath);
        return true;
      } catch (e) {
        if (e !== "Cancelled") {
          console.error("Save failed:", e);
        }
        return false;
      }
    } else {
      // ブラウザ環境向けのフォールバック（従来の方法）
      const url = URL.createObjectURL(dataMchrn.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${preset.meta.name || "preset"}.mchrn`;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    }
  }

  /**
   * 既存の .mchrn / .zip アーカイブファイルを読み込み、エディタの状態を復元する
   * @param files 選択されたFileList
   */
  async function handleImport(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    const loaded = await importArchiveMchrn(file);
    preset = loaded.preset;
    timetableCsv = loaded.timetableCsv;
    imageBlobs = loaded.imageBlobs;
    imageUrls = loaded.imageUrls;
    audioBlobs = loaded.audioBlobs;
    audioUrls = loaded.audioUrls;
    if (!loaded.preset.audioGroups) loaded.preset.audioGroups = {};
  }

  // --- Lifecycle & Effects ---

  $effect(() => {
    if (!isLoopPreviewing) return;
    const group = preset.lcdGroups[previewGroupNo];
    if (!group || group.slides.length <= 1) return;

    const currentSlide = group.slides[previewSlideIdx];
    const durationMs = Math.max(1, currentSlide?.durationSec ?? 5) * 1000;

    const timer = setTimeout(() => {
      const nextIdx = previewSlideIdx + 1;
      if (nextIdx < group.slides.length) {
        previewSlideIdx = nextIdx;
      } else if (group.loop) {
        previewSlideIdx = 0;
      } else {
        isLoopPreviewing = false;
      }
    }, durationMs);

    return () => clearTimeout(timer);
  });

  $effect(() => {
    broadcastLcdAssets(imageBlobs);
  });

  $effect(() => {
    broadcastLcdState(
      preset,
      previewGroupNo,
      previewSlideIdx,
      previewLayerIndices,
      imageBlobs,
    );
  });

  onMount(() => {
    const handleSyncRequest = (event: MessageEvent<LcdSyncMessage>) => {
      if (event.data.type === "request-sync") {
        broadcastLcdAssets(imageBlobs);
        broadcastLcdState(
          preset,
          previewGroupNo,
          previewSlideIdx,
          previewLayerIndices,
          imageBlobs,
        );
      }
    };
    lcdChannel.addEventListener("message", handleSyncRequest);
    return () => lcdChannel.removeEventListener("message", handleSyncRequest);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_missing_attribute -->
<!-- svelte-ignore a11y_label_has_associated_control -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="top-margin">
  <div class="space"></div>

  <!-- 上部バー：タイトルとアーカイブ入出力 -->
  <nav class="top-nav">
    <h5 class="max">停留所エディタ</h5>
    <FileButton
      label="読み込み"
      icon="folder_open"
      accept=".mchrn,.zip"
      onselect={handleImport}
    />
    <button class="primary" onclick={handleExport}>
      <i>save</i>
      <span>保存 (.mchrn)</span>
    </button>
  </nav>

  <div class="grid">
    <!-- 左カラム：編集タブ -->
    <div class="s12 m7">
      <div class="tabs left-align">
        <a
          class:active={activeTab === "base"}
          onclick={() => (activeTab = "base")}>1. 基本・素材</a
        >
        <a
          class:active={activeTab === "layers"}
          onclick={() => (activeTab = "layers")}>2. レイヤー</a
        >
        <a
          class:active={activeTab === "lcd"}
          onclick={() => (activeTab = "lcd")}>3. LCDグループ</a
        >
        <a
          class:active={activeTab === "actions"}
          onclick={() => (activeTab = "actions")}>4. アクション</a
        >
      </div>

      <!-- タブ1: 基本情報・CSV・画像・音声登録 -->
      {#if activeTab === "base"}
        <article class="border padding">
          <div class="field label border">
            <input type="text" bind:value={preset.meta.name} />
            <label>プリセット名（路線・方向名）</label>
          </div>

          <h6>ダイヤグラム (timetable.csv)</h6>
          <FileButton
            label="CSVを選択"
            icon="upload_file"
            accept=".csv"
            onselect={handleCsvRegister}
          />

          {#if masterStops.length > 0}
            <p>
              検出された停留所 ({masterStops.length}件): {masterStops.join(
                " → ",
              )}
            </p>
          {/if}

          <div class="space"></div>
          <h6>画像アセット登録 ({Object.keys(preset.images).length}件)</h6>
          <FileButton
            label={isRegisteringImage ? "変換中..." : "画像を追加 (複数可)"}
            icon="image"
            accept="image/*"
            multiple={true}
            disabled={isRegisteringImage}
            onselect={handleImageRegister}
          />
          <div class="space"></div>
          {#each Object.entries(preset.images) as [hashId, asset]}
            <div class="row item-row">
              <code class="small-text">{hashId.slice(0, 8)}</code>
              <span class="max">{asset.originalName}</span>
              <FileButton
                label="差し替え"
                icon="sync_alt"
                accept="image/*"
                disabled={isRegisteringImage}
                onselect={(files) => handleImageReplace(hashId, files)}
              />
              <button
                class="small transparent circle error-text"
                onclick={() => handleImageRemove(hashId)}
                title="画像を削除"
              >
                <i>delete</i>
              </button>
            </div>
          {/each}

          <div class="space"></div>
          <h6>音声アセット登録 ({Object.keys(preset.audios).length}件)</h6>
          <FileButton
            label={isRegisteringAudio ? "変換中..." : "音声を追加 (複数可)"}
            icon="audio_file"
            accept="audio/*"
            multiple={true}
            disabled={isRegisteringAudio}
            onselect={handleAudioRegister}
          />
          <div class="space"></div>
          {#each Object.entries(preset.audios) as [hashId, asset]}
            <div class="row item-row">
              <button
                class="small transparent circle"
                onclick={() => playAudioSequence(hashId)}
                title="試聴"
              >
                <i>volume_up</i>
              </button>
              <code class="small-text">{hashId.slice(0, 8)}</code>
              <span class="max">{asset.originalName}</span>
              <FileButton
                label="差し替え"
                icon="sync_alt"
                accept="audio/*"
                disabled={isRegisteringAudio}
                onselect={(files) => handleAudioReplace(hashId, files)}
              />
              <button
                class="small transparent circle error-text"
                onclick={() => handleAudioRemove(hashId)}
                title="音声を削除"
              >
                <i>delete</i>
              </button>
            </div>
          {/each}

          <div class="space"></div>
          <div class="row wrap-row">
            <h6 class="max no-margin">
              音声グループ (チャイム＋放送などの連続再生セット)
            </h6>
            <button class="small border" onclick={addAudioGroup}>
              <i>add</i>
              <span>グループ追加</span>
            </button>
          </div>
          {#each Object.entries(preset.audioGroups ?? {}) as [gNo, grp]}
            <article class="border top-margin">
              <div class="row wrap-row">
                <span class="bold">#{gNo}</span>
                <div class="field border max no-margin">
                  <input
                    type="text"
                    bind:value={grp.name}
                    placeholder="グループ名"
                  />
                </div>
                <button
                  class="small border"
                  onclick={() => playAudioSequence(`group:${gNo}`)}
                >
                  <i>play_arrow</i>
                  <span>連続試聴</span>
                </button>
                <button
                  class="small border"
                  onclick={() => (grp.audioIds = [...grp.audioIds, ""])}
                >
                  <i>add</i>
                  <span>音声追加</span>
                </button>
                <button
                  class="small transparent circle error-text"
                  onclick={() => delete preset.audioGroups?.[gNo]}
                >
                  <i>delete</i>
                </button>
              </div>
              {#each grp.audioIds as _, aIdx}
                <div class="row item-row top-margin">
                  <span>{aIdx + 1}.</span>
                  <Dropdown
                    full={true}
                    bind:value={grp.audioIds[aIdx]}
                    options={[
                      { value: "", label: "-- 音声を選択 --" },
                      ...Object.entries(preset.audios).map(
                        ([audId, asset]) => ({
                          value: audId,
                          label: `${asset.originalName} (${audId.slice(0, 6)})`,
                        }),
                      ),
                    ]}
                  />
                  <button
                    class="small transparent circle"
                    onclick={() => grp.audioIds.splice(aIdx, 1)}
                  >
                    <i>close</i>
                  </button>
                </div>
              {/each}
            </article>
          {/each}
        </article>
      {/if}

      <!-- タブ2: レイヤースロット設定 -->
      {#if activeTab === "layers"}
        {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
          <article class="border padding top-margin">
            <div class="row wrap-row">
              <h6 class="max no-margin">
                {slot.name} <small>(ID: <code>{slotKey}</code>)</small>
              </h6>
              <label class="checkbox">
                <input type="checkbox" bind:checked={slot.linkedToCsvStop} />
                <span>CSV停留所と連動</span>
              </label>
              <button
                class="small transparent circle"
                onclick={() => removeLayerSlot(slotKey)}
              >
                <i>delete</i>
              </button>
            </div>

            <div class="row wrap-row top-margin">
              <button
                class="small border"
                onclick={() => {
                  const nums = Object.keys(slot.items)
                    .map(Number)
                    .filter((n) => !isNaN(n));
                  const nextNo = nums.length > 0 ? Math.max(...nums) + 1 : 0;
                  slot.items[String(nextNo)] = "";
                }}
              >
                <i>add</i>
                <span>番号を追加</span>
              </button>
              {#if slot.linkedToCsvStop && masterStops.length > 0}
                <button
                  class="small border"
                  onclick={() => syncSlotItemsWithCsv(slotKey)}
                >
                  <i>sync</i>
                  <span>CSV停留所数 ({masterStops.length}件) の枠を作成</span>
                </button>
              {/if}
            </div>

            <div class="space"></div>

            {#each Object.entries(slot.items) as [no]}
              <div class="row item-row">
                <span class="bold">#{no}</span>
                {#if slot.linkedToCsvStop && masterStops[Number(no)]}
                  <span class="chip small stop-chip">
                    {masterStops[Number(no)]}
                  </span>
                {/if}
                <Dropdown
                  full={true}
                  bind:value={slot.items[no]}
                  options={imageOptions}
                />
                <button
                  class="small transparent circle"
                  onclick={() => delete slot.items[no]}
                >
                  <i>close</i>
                </button>
              </div>
            {/each}
          </article>
        {/each}

        <!-- 新規スロット追加フォーム -->
        <article class="border padding top-margin">
          <h6>新規レイヤースロットの追加</h6>
          <div class="field label border">
            <input type="text" bind:value={newSlotKey} />
            <label>スロットID (英数字)</label>
          </div>
          <div class="field label border">
            <input type="text" bind:value={newSlotName} />
            <label>表示名</label>
          </div>
          <div class="space"></div>
          <button class="primary" onclick={addLayerSlot}>
            <i>add</i>
            <span>スロット追加</span>
          </button>
        </article>
      {/if}

      <!-- タブ3: LCDグループのベース画像・表示レイヤー設定 -->
      {#if activeTab === "lcd"}
        <article class="border padding">
          <div class="row wrap-row">
            <Dropdown
              full={true}
              label="編集するLCDグループ"
              bind:value={previewGroupNo}
              options={lcdGroupOptions}
              onchange={() => (previewSlideIdx = 0)}
            />
            <button class="primary" onclick={addLcdGroup}>
              <i>add</i>
              <span>新規</span>
            </button>
            {#if Object.keys(preset.lcdGroups).length > 1}
              <button
                class="border error-text"
                onclick={() => removeLcdGroup(previewGroupNo)}
              >
                <i>delete</i>
              </button>
            {/if}
          </div>

          {#if preset.lcdGroups[previewGroupNo]}
            {@const currentGroup = preset.lcdGroups[previewGroupNo]}
            <div class="space"></div>
            <div class="field label border no-margin">
              <input type="text" bind:value={currentGroup.name} />
              <label>グループ名</label>
            </div>
            <div class="row wrap-row top-margin">
              <label class="checkbox max">
                <input type="checkbox" bind:checked={currentGroup.loop} />
                <span>スライドをループ再生する</span>
              </label>
              <button class="border" onclick={() => addSlide(previewGroupNo)}>
                <i>add_photo_alternate</i>
                <span>スライド追加</span>
              </button>
            </div>
          {/if}
        </article>

        <!-- 選択中グループ内のスライド一覧 -->
        {#if preset.lcdGroups[previewGroupNo]}
          {@const currentGroup = preset.lcdGroups[previewGroupNo]}
          {#each currentGroup.slides as slide, sIdx}
            <article
              class="border padding top-margin"
              class:fill={previewSlideIdx === sIdx}
              onclick={() => (previewSlideIdx = sIdx)}
            >
              <div class="row wrap-row">
                <h6 class="max no-margin">
                  スライド #{sIdx + 1}
                  {#if previewSlideIdx === sIdx}
                    <span class="chip small primary">プレビュー中</span>
                  {/if}
                </h6>
                <div class="field label border small no-margin number-box">
                  <input type="number" min="1" bind:value={slide.durationSec} />
                  <label>表示秒数</label>
                </div>
                {#if currentGroup.slides.length > 1}
                  <button
                    class="small transparent circle"
                    onclick={(e) => {
                      e.stopPropagation();
                      removeSlide(previewGroupNo, sIdx);
                    }}
                  >
                    <i>delete</i>
                  </button>
                {/if}
              </div>

              <div class="space"></div>
              <Dropdown
                full={true}
                label="ベース画像"
                bind:value={slide.baseImageId}
                options={imageOptions}
              />

              <div class="space"></div>
              <p class="bold no-margin">
                重ねるレイヤー（チェック順＝下から重ねる順）:
              </p>
              {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
                {@const isVisible = slide.visibleLayers.includes(slotKey)}
                <div class="row wrap-row">
                  <label class="checkbox max">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onchange={(e) =>
                        toggleSlideLayer(
                          slide,
                          slotKey,
                          e.currentTarget.checked,
                        )}
                    />
                    <span>{slot.name} (<code>{slotKey}</code>)</span>
                  </label>

                  {#if isVisible}
                    <div class="field label border small no-margin number-box">
                      <input
                        type="number"
                        min="0"
                        placeholder="連動"
                        value={slide.layerOverrides?.[slotKey] ?? ""}
                        oninput={(e) =>
                          setSlideLayerOverride(
                            slide,
                            slotKey,
                            e.currentTarget.value,
                          )}
                      />
                      <label>番号固定</label>
                    </div>
                  {/if}
                </div>
              {/each}
            </article>
          {/each}
        {/if}
      {/if}

      <!-- タブ4: アクションステップ設定 -->
      {#if activeTab === "actions"}
        <!-- 一括自動生成マクロパネル -->
        <article class="border">
          <h6>CSV停留所から一括自動生成</h6>
          {#if masterStops.length === 0}
            <p class="small-text">
              ※「1.
              基本・素材」タブでダイヤグラムCSVを読み込むと、全停留所分のステップを自動生成できます。
            </p>
          {:else}
            <div class="grid">
              <div class="s12 m4">
                <Dropdown
                  full={true}
                  label="生成パターン"
                  bind:value={macroPattern}
                  options={[
                    { value: "1-step", label: "1段階式 (案内のみ)" },
                    { value: "3-step", label: "3段階式 (発車・到着・閉扉)" },
                  ]}
                />
              </div>
              <div class="s12 m4">
                <Dropdown
                  full={true}
                  label="走行中LCDグループ"
                  bind:value={macroRunningGroupNo}
                  options={[
                    { value: undefined, label: "指定なし" },
                    ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                      value: Number(gNo),
                      label: `#${gNo}: ${grp.name}`,
                    })),
                  ]}
                />
              </div>
              {#if macroPattern === "3-step"}
                <div class="s12 m4">
                  <Dropdown
                    full={true}
                    label="停車中LCDグループ"
                    bind:value={macroStoppingGroupNo}
                    options={[
                      { value: undefined, label: "切替なし" },
                      ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                        value: Number(gNo),
                        label: `#${gNo}: ${grp.name}`,
                      })),
                    ]}
                  />
                </div>
                <div class="s12 m6">
                  <Dropdown
                    full={true}
                    label="到着・開扉時の共通音声"
                    bind:value={macroArriveAudioId}
                    options={audioSelectOptions}
                  />
                </div>
                <div class="s12 m6">
                  <Dropdown
                    full={true}
                    label="ドア閉め時の共通音声"
                    bind:value={macroCloseAudioId}
                    options={audioSelectOptions}
                  />
                </div>
              {/if}
            </div>
            <div class="row wrap-row top-margin">
              <span class="small-text max">
                対象: {masterStops.length}停留所 ({macroPattern === "1-step"
                  ? masterStops.length
                  : masterStops.length * 3 - 1}ステップ)
              </span>
              <button class="border" onclick={generateStepsFromCsv}>
                <i>auto_awesome</i>
                <span>全停留所分を一括生成</span>
              </button>
            </div>
          {/if}
        </article>

        <!-- ステップ一覧ヘッダー -->
        <article class="border top-margin">
          <div class="row wrap-row">
            <h6 class="max no-margin">
              アクションステップ一覧 ({preset.actions.length}件)
            </h6>
            <button
              class="primary"
              onclick={() => {
                addActionStep();
                expandedStepIdx = preset.actions.length - 1;
              }}
            >
              <i>add</i>
              <span>ステップ追加</span>
            </button>
          </div>
        </article>

        <!-- コンパクト折りたたみ式ステップリスト -->
        {#each preset.actions as step, idx}
          {@const isExpanded = expandedStepIdx === idx}
          <article
            class="border top-margin step-card"
            class:fill={activePreviewStepIdx === idx}
          >
            <!-- 常時表示の1行ヘッダー（クリックで詳細を開閉） -->
            <div
              class="row wrap-row step-header"
              onclick={() => (expandedStepIdx = isExpanded ? null : idx)}
            >
              <i>{isExpanded ? "expand_less" : "expand_more"}</i>
              <span class="chip small bold">#{step.stepNo}</span>
              <span class="bold max step-title">{step.label}</span>

              {#if step.setStopIndex !== undefined}
                <span class="chip small">
                  停留所: {step.setStopIndex === "+1"
                    ? "+1"
                    : `#${step.setStopIndex}`}
                </span>
              {/if}
              {#if step.setLcdGroupNo !== undefined}
                <span class="chip small">LCD #{step.setLcdGroupNo}</span>
              {/if}
              {#if step.playAudioId}
                <span class="chip small"><i>volume_up</i></span>
              {/if}

              <!-- 操作ボタン群（クリックイベントの伝播を止めて開閉と干渉させない） -->
              <div class="row no-space" onclick={(e) => e.stopPropagation()}>
                <button
                  class="small border"
                  onclick={() => simulateStepAt(idx)}
                >
                  <i>play_circle</i>
                  <span>テスト</span>
                </button>
                <button
                  class="small transparent circle"
                  disabled={idx === 0}
                  onclick={() => moveActionStep(idx, -1)}
                >
                  <i>arrow_upward</i>
                </button>
                <button
                  class="small transparent circle"
                  disabled={idx === preset.actions.length - 1}
                  onclick={() => moveActionStep(idx, 1)}
                >
                  <i>arrow_downward</i>
                </button>
                <button
                  class="small transparent circle"
                  onclick={() => duplicateActionStep(idx)}
                >
                  <i>content_copy</i>
                </button>
                <button
                  class="small transparent circle error-text"
                  onclick={() => removeActionStep(idx)}
                >
                  <i>delete</i>
                </button>
              </div>
            </div>

            <!-- 展開時のみ表示される詳細設定エリア -->
            {#if isExpanded}
              <div class="space"></div>
              <div class="field label border no-bottom-margin">
                <input type="text" bind:value={step.label} />
                <label>ステップ表示名</label>
              </div>

              <div class="grid top-margin">
                <div class="s12 m6">
                  <Dropdown
                    full={true}
                    label="車載器ダイヤ停留所"
                    bind:value={step.setStopIndex}
                    options={[
                      { value: undefined, label: "変更なし" },
                      { value: "+1", label: "次の停留所へ (+1)" },
                      ...masterStops.map((stopName, sIdx) => ({
                        value: sIdx,
                        label: `#${sIdx}: ${stopName}`,
                      })),
                    ]}
                  />
                </div>

                <div class="s12 m6">
                  <Dropdown
                    full={true}
                    label="LCDグループ切替"
                    bind:value={step.setLcdGroupNo}
                    options={[
                      { value: undefined, label: "変更なし" },
                      ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                        value: Number(gNo),
                        label: `#${gNo}: ${grp.name}`,
                      })),
                    ]}
                  />
                </div>

                <div class="s12">
                  <Dropdown
                    full={true}
                    label="再生する音声 / 音声グループ"
                    bind:value={step.playAudioId}
                    options={audioSelectOptions}
                  />
                </div>
              </div>

              <div class="space"></div>
              <p class="bold no-margin">レイヤー番号の更新:</p>
              <div class="grid">
                {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
                  <div class="s12 m6">
                    <Dropdown
                      full={true}
                      label={`${slot.name} (${slotKey})`}
                      value={step.setLayers?.[slotKey]}
                      onchange={(val) =>
                        updateStepLayerValue(step, slotKey, val)}
                      options={[
                        { value: undefined, label: "変更なし (維持)" },
                        { value: "+1", label: "次の番号へ (+1)" },
                        { value: null, label: "非表示にする" },
                        ...Object.keys(slot.items).map((itemNo) => ({
                          value: Number(itemNo),
                          label:
                            slot.linkedToCsvStop && masterStops[Number(itemNo)]
                              ? `#${itemNo} (${masterStops[Number(itemNo)]})`
                              : `#${itemNo} に指定`,
                        })),
                      ]}
                    />
                  </div>
                {/each}
              </div>
            {/if}
          </article>
        {/each}
      {/if}
    </div>

    <!-- 右カラム：常時表示のLCDリアルタイムプレビュー -->
    <div class="s12 m5">
      <article class="border padding">
        <div class="row">
          <h6 class="max">LCDリアルタイムプレビュー</h6>
          <button
            class="small"
            class:primary={isLoopPreviewing}
            class:border={!isLoopPreviewing}
            onclick={() => (isLoopPreviewing = !isLoopPreviewing)}
          >
            <i>{isLoopPreviewing ? "stop" : "play_arrow"}</i>
            <span>{isLoopPreviewing ? "ループ停止" : "ループ再生テスト"}</span>
          </button>
        </div>

        <div class="space"></div>

        <LcdScreen
          slide={currentPreviewSlide}
          layerSlots={preset.layerSlots}
          {imageUrls}
          activeLayerIndices={previewLayerIndices}
        />

        {#if preset.lcdGroups[previewGroupNo]}
          {@const grp = preset.lcdGroups[previewGroupNo]}
          <div class="row center-align top-margin">
            {#each grp.slides as _, idx}
              <button
                class="small circle"
                class:fill={previewSlideIdx === idx}
                class:border={previewSlideIdx !== idx}
                onclick={() => (previewSlideIdx = idx)}
              >
                {idx + 1}
              </button>
            {/each}
          </div>
        {/if}

        <div class="space"></div>
        <p>プレビュー用レイヤー番号切り替え:</p>
        {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
          <div class="field label border small">
            <input
              type="number"
              min="0"
              bind:value={previewLayerIndices[slotKey]}
            />
            <label>{slot.name} 番号</label>
          </div>
        {/each}
      </article>
    </div>
  </div>
</section>

<style>
  /* グリッド要素の横幅突き抜け防止 */
  .grid > * {
    min-width: 0;
  }

  /* 折り返し可能な横並び行 */
  .wrap-row {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* レイヤー番号行の整列 */
  .item-row {
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    min-width: 0;
  }

  .stop-chip {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .number-box {
    width: 6.5rem;
  }

  /* 長いファイル名リストの折り返し */
  ul {
    word-break: break-all;
  }

  .step-card {
    padding: 0.5rem 0.75rem;
  }

  .step-header {
    cursor: pointer;
    user-select: none;
  }

  .step-title {
    min-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
