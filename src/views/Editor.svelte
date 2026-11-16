<script lang="ts">
  // --- Imports ---

  import Dropdown from "../components/Dropdown.svelte";
  import FileButton from "../components/FileButton.svelte";
  import LcdScreen from "../components/LcdScreen.svelte";
  import { ArchiveService } from "../core/archive";
  import { AudioPlayerService } from "../core/audioPlayer";
  import { LcdSyncService } from "../core/lcdSync";
  import { PresetService } from "../core/preset";
  import { TimetableService } from "../core/timetable";
  import type { ConvertedAssetResult, LcdSlide, RoutePreset } from "../core/types";

  // --- Props ---

  let {
    preset = $bindable<RoutePreset>(PresetService.createDefault()),
    timetableCsv = $bindable(""),
    imageBlobs = $bindable<Record<string, Uint8Array>>({}),
    imageUrls = $bindable<Record<string, string>>({}),
    audioBlobs = $bindable<Record<string, Uint8Array>>({}),
    audioUrls = $bindable<Record<string, string>>({}),
    isMuted = false,
    isDirty = false,
    oncreate,
    onsave,
    onsaveas,
    onimport,
  }: {
    preset?: RoutePreset;
    timetableCsv?: string;
    imageBlobs?: Record<string, Uint8Array>;
    imageUrls?: Record<string, string>;
    audioBlobs?: Record<string, Uint8Array>;
    audioUrls?: Record<string, string>;
    isMuted?: boolean;
    isDirty?: boolean;
    oncreate?: () => void;
    onsave?: () => void;
    onsaveas?: () => void;
    onimport?: () => void;
  } = $props();

  // --- Constants ---

  /** 割り込みショートカットとして選択可能なキー一覧 */
  const SHORTCUT_KEY_OPTIONS = [
    { value: "Space", label: "Space キー" },
    { value: "Enter", label: "Enter キー" },
    { value: "ArrowUp", label: "↑ (上矢印) キー" },
    { value: "ArrowDown", label: "↓ (下矢印) キー" },
    { value: "Digit1", label: "1 キー" },
    { value: "Digit2", label: "2 キー" },
    { value: "Digit3", label: "3 キー" },
    { value: "Digit4", label: "4 キー" },
    { value: "Digit5", label: "5 キー" },
    { value: "Digit6", label: "6 キー" },
    { value: "Digit7", label: "7 キー" },
    { value: "Digit8", label: "8 キー" },
    { value: "Digit9", label: "9 キー" },
  ];

  // --- Services & Editor UI State ---

  /** エディタ内試聴用の音声プレイヤーインスタンス */
  const previewPlayer = new AudioPlayerService();

  /** 現在開いている編集タブ */
  let activeTab = $state<"base" | "stops" | "lcd" | "actions">("base");

  /** 新規レイヤースロット追加用の入力状態 */
  let newSlotKind = $state<"image" | "audio">("image");
  let newSlotKey = $state("");
  let newSlotName = $state("");
  let newSlotInherit = $state(false);

  /** アセット変換処理中のローディング状態 */
  let isRegisteringImage = $state(false);
  let isRegisteringAudio = $state(false);

  /** LCDリアルタイムプレビューの状態 */
  let isLoopPreviewing = $state(false);
  let previewGroupNo = $state("1");
  let previewSlideIdx = $state(0);
  let previewStopIdx = $state(0);
  let previewLayerIndices = $state<Record<string, number | null>>({
    stop: 0,
    fare: 0,
  });

  /** 例外アクションステップの展開状態 */
  let expandedStepIdx = $state<number | null>(null);

  // --- Derived ---

  /** CSVから抽出されたマスター停留所リスト */
  let masterStops = $derived(TimetableService.extractMasterStops(timetableCsv));

  /** 現在プレビュー中のLCDスライド */
  let currentPreviewSlide = $derived<LcdSlide | undefined>(preset.lcdGroups[previewGroupNo]?.slides[previewSlideIdx]);

  /** ベース画像選択ドロップダウン用の選択肢配列 */
  let imageOptions = $derived([
    { value: "", label: "-- 画像を選択 --" },
    ...Object.entries(preset.images).map(([id, asset]) => ({
      value: id,
      label: `${asset.originalName} (${id.slice(0, 6)})`,
    })),
  ]);

  /** 停留所テーブルの画像セル用（前を維持対応）の選択肢配列 */
  let tableImageOptions = $derived([
    { value: "", label: "── (前を維持 / 未指定)" },
    ...Object.entries(preset.images).map(([id, asset]) => ({
      value: id,
      label: `${asset.originalName} (${id.slice(0, 6)})`,
    })),
  ]);

  /** LCDグループ選択ドロップダウン用の選択肢配列 */
  let lcdGroupOptions = $derived(
    Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
      value: gNo,
      label: `#${gNo}: ${grp.name}`,
    })),
  );

  /** 単体音声選択ドロップダウン用の選択肢配列 */
  let singleAudioOptions = $derived([
    { value: "", label: "-- 音声を選択 --" },
    ...Object.entries(preset.audios).map(([audId, asset]) => ({
      value: audId,
      label: `${asset.originalName} (${audId.slice(0, 6)})`,
    })),
  ]);

  /** 音声グループ＋単体音声の共通選択肢配列 */
  let audioTargetEntries = $derived([
    ...Object.entries(preset.audioGroups ?? {}).map(([gNo, grp]) => ({
      value: `group:${gNo}`,
      label: `[グループ #${gNo}] ${grp.name}`,
    })),
    ...Object.entries(preset.audios).map(([audId, asset]) => ({
      value: audId,
      label: `${asset.originalName} (${audId.slice(0, 6)})`,
    })),
  ]);

  /** 直接指定用（再生しない＋グループ＋単体音声）の選択肢配列 */
  let audioSelectOptions = $derived([{ value: undefined, label: "直接指定なし" }, ...audioTargetEntries]);

  /** 停留所テーブル内の音声セル用の選択肢配列を生成するヘルパー */
  function getTableAudioOptions(inheritPrevious?: boolean): { value: string; label: string }[] {
    return [
      {
        value: "",
        label: inheritPrevious ? "── (前を維持)" : "── (再生しない)",
      },
      ...(inheritPrevious ? [{ value: "__NONE__", label: "🔇 無音にする (継承停止)" }] : []),
      ...audioTargetEntries,
    ];
  }

  /** CSV停留所と連動する画像レイヤー一覧 */
  let linkedImageSlots = $derived(
    Object.entries(preset.layerSlots).filter(([, slot]) => slot.linkedToCsvStop !== false),
  );

  /** CSV停留所と連動する音声レイヤー一覧 */
  let linkedAudioSlots = $derived(
    Object.entries(preset.audioSlots ?? {}).filter(([, slot]) => slot.linkedToCsvStop !== false),
  );

  /** 自動合成された実行ステップ総数（プレビュー確認用） */
  let effectiveActions = $derived(PresetService.buildEffectiveActions(preset, masterStops));

  // --- Unified Asset Management Handlers ---

  /**
   * ダイヤグラムCSVファイルを読み込んで状態を更新する
   * @param files 選択されたFileList
   */
  async function handleCsvRegister(files: FileList): Promise<void> {
    const file = files[0];
    if (file) timetableCsv = await file.text();
  }

  /**
   * 複数のファイルに対して変換関数を実行し、アセット辞書・バイナリ・Object URLへ一括登録する共通ヘルパー
   * @param files 登録するファイル群
   * @param converter ファイル変換関数
   * @param targetAssets 登録先のアセット辞書
   * @param targetBlobs 登録先のバイナリ辞書
   * @param targetUrls 登録先のObject URL辞書
   */
  async function registerAssetsBatch<T extends { fileName: string; originalName: string }>(
    files: FileList,
    converter: (file: File, existingId?: string) => Promise<ConvertedAssetResult<T>>,
    targetAssets: Record<string, T>,
    targetBlobs: Record<string, Uint8Array>,
    targetUrls: Record<string, string>,
  ): Promise<void> {
    for (const file of Array.from(files)) {
      try {
        const res = await converter(file);
        targetAssets[res.hashId] = res.asset;
        targetBlobs[res.asset.fileName] = res.binary;
        targetUrls[res.hashId] = res.objectUrl;
      } catch (err) {
        console.error(`アセット変換エラー (${file.name}):`, err);
      }
    }
  }

  /**
   * 既存ハッシュIDを維持したまま単一ファイルを差し替える共通ヘルパー
   * @param hashId 差し替え対象のハッシュID
   * @param files 選択されたFileList
   * @param converter ファイル変換関数
   * @param targetAssets 登録先のアセット辞書
   * @param targetBlobs 登録先のバイナリ辞書
   * @param targetUrls 登録先のObject URL辞書
   */
  async function replaceSingleAsset<T extends { fileName: string; originalName: string }>(
    hashId: string,
    files: FileList,
    converter: (file: File, existingId?: string) => Promise<ConvertedAssetResult<T>>,
    targetAssets: Record<string, T>,
    targetBlobs: Record<string, Uint8Array>,
    targetUrls: Record<string, string>,
  ): Promise<void> {
    const file = files[0];
    if (!file) return;
    try {
      if (targetUrls[hashId]) URL.revokeObjectURL(targetUrls[hashId]);
      const res = await converter(file, hashId);
      targetAssets[hashId] = res.asset;
      targetBlobs[res.asset.fileName] = res.binary;
      targetUrls[hashId] = res.objectUrl;
    } catch (err) {
      console.error(`アセット差し替えエラー (${file.name}):`, err);
    }
  }

  /**
   * 画像アセットを追加登録する
   * @param files 選択された画像FileList
   */
  async function handleImageRegister(files: FileList): Promise<void> {
    isRegisteringImage = true;
    try {
      await registerAssetsBatch(
        files,
        (f, id) => ArchiveService.convertImageToAvif(f, id),
        preset.images,
        imageBlobs,
        imageUrls,
      );
      await LcdSyncService.registerImageBlobs(imageBlobs);
    } finally {
      isRegisteringImage = false;
    }
  }

  /**
   * 既存の画像アセットを別ファイルで差し替える
   * @param hashId 差し替え対象の画像ハッシュID
   * @param files 選択された画像FileList
   */
  async function handleImageReplace(hashId: string, files: FileList): Promise<void> {
    isRegisteringImage = true;
    try {
      await replaceSingleAsset(
        hashId,
        files,
        (f, id) => ArchiveService.convertImageToAvif(f, id),
        preset.images,
        imageBlobs,
        imageUrls,
      );
      await LcdSyncService.registerImageBlobs(imageBlobs);
    } finally {
      isRegisteringImage = false;
    }
  }

  /**
   * 画像アセットを削除し、プリセット内の参照をクリーンアップする
   * @param hashId 削除する画像ハッシュID
   */
  function handleImageRemove(hashId: string): void {
    const asset = preset.images[hashId];
    if (!asset) return;
    if (imageUrls[hashId]) {
      URL.revokeObjectURL(imageUrls[hashId]);
      delete imageUrls[hashId];
    }
    delete imageBlobs[asset.fileName];
    PresetService.cleanupImageReferences(preset, hashId);
  }

  /**
   * 音声アセットを追加登録し、Rustサーバーへ同期する
   * @param files 選択された音声FileList
   */
  async function handleAudioRegister(files: FileList): Promise<void> {
    isRegisteringAudio = true;
    try {
      await registerAssetsBatch(
        files,
        (f, id) => ArchiveService.convertAudioToOpus(f, id),
        preset.audios,
        audioBlobs,
        audioUrls,
      );
      await LcdSyncService.registerAudioBlobs(audioBlobs);
    } finally {
      isRegisteringAudio = false;
    }
  }

  /**
   * 既存の音声アセットを別ファイルで差し替え、Rustサーバーへ同期する
   * @param hashId 差し替え対象の音声ハッシュID
   * @param files 選択された音声FileList
   */
  async function handleAudioReplace(hashId: string, files: FileList): Promise<void> {
    isRegisteringAudio = true;
    try {
      await replaceSingleAsset(
        hashId,
        files,
        (f, id) => ArchiveService.convertAudioToOpus(f, id),
        preset.audios,
        audioBlobs,
        audioUrls,
      );
      await LcdSyncService.registerAudioBlobs(audioBlobs);
    } finally {
      isRegisteringAudio = false;
    }
  }

  /**
   * 音声アセットを削除し、プリセット内の参照をクリーンアップする
   * @param hashId 削除する音声ハッシュID
   */
  function handleAudioRemove(hashId: string): void {
    const asset = preset.audios[hashId];
    if (!asset) return;
    if (audioUrls[hashId]) {
      URL.revokeObjectURL(audioUrls[hashId]);
      delete audioUrls[hashId];
    }
    delete audioBlobs[asset.fileName];
    PresetService.cleanupAudioReferences(preset, hashId);
  }

  /**
   * 新規音声グループを追加する
   */
  function handleAddAudioGroup(): void {
    if (!preset.audioGroups) preset.audioGroups = {};
    const nextNo = PresetService.getNextGroupNumber(preset.audioGroups);
    preset.audioGroups[nextNo] = {
      name: `音声グループ #${nextNo}`,
      audioIds: [""],
    };
  }

  // --- Stop Data & Slot Management Handlers ---

  /**
   * 停留所データテーブルで指定した停留所インデックスを右側のLCDプレビューへ反映する
   * @param stopIdx プレビューする停留所インデックス
   */
  function selectPreviewStop(stopIdx: number): void {
    previewStopIdx = stopIdx;
    for (const [key, slot] of Object.entries(preset.layerSlots)) {
      if (slot.linkedToCsvStop !== false) {
        previewLayerIndices[key] = stopIdx;
      }
    }
  }

  /**
   * 新規の画像レイヤーまたは音声レイヤースロットを追加する
   */
  function handleAddSlot(): void {
    const key = newSlotKey.trim();
    const name = newSlotName.trim();
    if (!key || !name) return;

    if (newSlotKind === "image") {
      if (preset.layerSlots[key]) return;
      preset.layerSlots[key] = { name, linkedToCsvStop: true, items: {} };
      previewLayerIndices[key] = previewStopIdx;
    } else {
      if (preset.audioSlots[key]) return;
      preset.audioSlots[key] = {
        name,
        linkedToCsvStop: true,
        inheritPrevious: newSlotInherit,
        items: {},
      };
    }

    newSlotKey = "";
    newSlotName = "";
  }

  /**
   * 画像レイヤースロットを削除する
   * @param slotKey 削除対象のスロットキー
   */
  function handleRemoveLayerSlot(slotKey: string): void {
    PresetService.removeLayerSlot(preset, slotKey);
    delete previewLayerIndices[slotKey];
  }

  /**
   * 音声レイヤースロットを削除する
   * @param slotKey 削除対象の音声スロットキー
   */
  function handleRemoveAudioSlot(slotKey: string): void {
    PresetService.removeAudioSlot(preset, slotKey);
  }

  // --- LCD Group Handlers ---

  /**
   * 新規LCDグループを追加する
   */
  function handleAddLcdGroup(): void {
    const nextNo = PresetService.getNextGroupNumber(preset.lcdGroups);
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
  function handleRemoveLcdGroup(groupNo: string): void {
    delete preset.lcdGroups[groupNo];
    previewGroupNo = Object.keys(preset.lcdGroups)[0] ?? "";
    previewSlideIdx = 0;
  }

  /**
   * 選択中のLCDグループに新規スライドを追加する
   * @param groupNo 対象のグループ番号
   */
  function handleAddSlide(groupNo: string): void {
    const group = preset.lcdGroups[groupNo];
    if (!group) return;
    group.slides.push({ baseImageId: "", durationSec: 6, visibleLayers: [] });
    previewSlideIdx = group.slides.length - 1;
  }

  /**
   * 特定停留所・特定フェーズのLCDグループ上書き設定を更新する
   * @param stopIdx 停留所インデックス
   * @param phaseId フェーズID
   * @param groupNo 上書きするLCDグループ番号（undefinedで解除）
   */
  function setStopPhaseLcdOverride(stopIdx: number, phaseId: string, groupNo: number | undefined): void {
    if (!preset.stopLcdOverrides) preset.stopLcdOverrides = {};
    const key = String(stopIdx);
    if (!preset.stopLcdOverrides[key]) preset.stopLcdOverrides[key] = {};

    if (groupNo === undefined) {
      delete preset.stopLcdOverrides[key][phaseId];
    } else {
      preset.stopLcdOverrides[key][phaseId] = groupNo;
    }
  }

  /**
   * 指定したスライドを削除する
   * @param groupNo 対象のグループ番号
   * @param slideIdx 削除するスライドのインデックス
   */
  function handleRemoveSlide(groupNo: string, slideIdx: number): void {
    const group = preset.lcdGroups[groupNo];
    if (!group || group.slides.length <= 1) return;
    group.slides.splice(slideIdx, 1);
    if (previewSlideIdx >= group.slides.length) {
      previewSlideIdx = Math.max(0, group.slides.length - 1);
    }
  }

  // --- Progression Phases & Interrupts Handlers ---

  /**
   * 進行フェーズにテンプレートを適用する（既存のレガシー手動ステップがあればクリアして自動合成へ切り替える）
   * @param pattern "1-step" または "3-step"
   */
  function applyPhaseTemplate(pattern: "1-step" | "3-step"): void {
    preset.progressionPhases = PresetService.createPhaseTemplate(pattern);
    preset.actions = preset.actions.filter((a) => a.insertAfterStopIdx !== undefined);
  }

  /**
   * 進行フェーズを1つ追加する
   */
  function handleAddPhase(): void {
    preset.progressionPhases.push({
      id: `phase_${crypto.randomUUID().slice(0, 6)}`,
      label: `フェーズ #${preset.progressionPhases.length + 1}`,
      lcdGroupNo: undefined,
      playAudioSlots: [],
      applyAtFirstStop: true,
      applyAtMiddleStops: true,
      applyAtLastStop: true,
    });
  }

  /**
   * ショートカット割り込みアクションを1つ追加する
   */
  function handleAddInterrupt(): void {
    preset.interrupts.push({
      id: `intr_${crypto.randomUUID().slice(0, 6)}`,
      label: "次止まります (降車ボタン)",
      shortcutKey: "Space",
      lcdGroupNo: undefined,
      playAudioSlots: [],
      playAudioId: undefined,
    });
  }

  // --- Archive Export / Import Handlers ---

  /**
   * 編集中のプリセットを `.mchrn` ファイルとして保存する
   */
  async function handleExport(): Promise<void> {
    await ArchiveService.saveMchrn({
      preset,
      timetableCsv,
      imageBlobs,
      audioBlobs,
    });
  }

  /**
   * `.mchrn` ファイルを読み込んでエディタの状態を置き換える
   * @param files 選択されたFileList
   */
  async function handleImport(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    const loaded = await ArchiveService.importMchrn(file);
    preset = loaded.preset;
    timetableCsv = loaded.timetableCsv;
    imageBlobs = loaded.imageBlobs;
    imageUrls = loaded.imageUrls;
    audioBlobs = loaded.audioBlobs;
    audioUrls = loaded.audioUrls;
    await LcdSyncService.registerAudioBlobs(loaded.audioBlobs);
  }

  // --- Effects ---

  /** ループ再生テスト中のスライド自動送りタイマー */
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

  /** プレビュー状態のRust側OBSサーバーへのリアルタイム同期 */
  $effect(() => {
    LcdSyncService.syncState({
      preset,
      groupNo: previewGroupNo,
      slideIdx: previewSlideIdx,
      layerIndices: previewLayerIndices,
      imageBlobs,
    });
  });

  /** 親コンポーネントのミュート状態の反映 */
  $effect(() => {
    previewPlayer.setMuted(isMuted);
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
    <h5 class="max">
      停留所エディタ
      {#if isDirty}
        <span class="chip small amber-text border">* 未保存</span>
      {/if}
    </h5>
    {#if oncreate}
      <button type="button" class="border" onclick={oncreate}>
        <i>add</i>
        <span>新規作成</span>
      </button>
    {/if}
    {#if onimport}
      <button type="button" class="border" onclick={onimport}>
        <i>folder_open</i>
        <span>読み込み</span>
      </button>
    {:else}
      <FileButton label="読み込み" icon="folder_open" accept=".mchrn,.zip" onselect={handleImport} />
    {/if}
    <button
      type="button"
      class="border"
      onclick={() => (onsaveas ? onsaveas() : handleExport())}
      title="Ctrl + Shift + S"
    >
      <i>save_as</i>
      <span>名前をつけて保存</span>
    </button>
    <button type="button" class="primary" onclick={() => (onsave ? onsave() : handleExport())} title="Ctrl + S">
      <i>save</i>
      <span>上書き保存</span>
    </button>
  </nav>

  <div class="grid">
    <!-- 左カラム：編集タブ -->
    <div class="s12 m7">
      <div class="tabs left-align">
        <a class:active={activeTab === "base"} onclick={() => (activeTab = "base")}>1. 基本・素材</a>
        <a class:active={activeTab === "stops"} onclick={() => (activeTab = "stops")}>2. 停留所</a>
        <a class:active={activeTab === "lcd"} onclick={() => (activeTab = "lcd")}>3. LCDグループ</a>
        <a class:active={activeTab === "actions"} onclick={() => (activeTab = "actions")}>4. アクション</a>
      </div>

      <!-- タブ1: 基本情報・CSV・画像・音声登録 -->
      {#if activeTab === "base"}
        <article class="border padding">
          <div class="field label border">
            <input type="text" bind:value={preset.meta.name} />
            <label>プリセット名（路線・方向名）</label>
          </div>

          <h6>ダイヤグラム (timetable.csv)</h6>
          <FileButton label="CSVを選択" icon="upload_file" accept=".csv" onselect={handleCsvRegister} />

          {#if masterStops.length > 0}
            <p>
              検出された停留所 ({masterStops.length}件): {masterStops.join(" → ")}
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
          {#each Object.entries(preset.images) as [hashId, asset] (hashId)}
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
                type="button"
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
          {#each Object.entries(preset.audios) as [hashId, asset] (hashId)}
            <div class="row item-row">
              <button
                type="button"
                class="small transparent circle"
                onclick={() => previewPlayer.playFromPreset(preset, audioUrls, hashId)}
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
                type="button"
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
            <h6 class="max no-margin">音声グループ (チャイム＋放送などの連続再生セット)</h6>
            <button type="button" class="small border" onclick={handleAddAudioGroup}>
              <i>add</i>
              <span>グループ追加</span>
            </button>
          </div>
          {#each Object.entries(preset.audioGroups ?? {}) as [gNo, grp] (gNo)}
            <article class="border top-margin">
              <div class="row wrap-row">
                <span class="bold">#{gNo}</span>
                <div class="field border max no-margin">
                  <input type="text" bind:value={grp.name} placeholder="グループ名" />
                </div>
                <button
                  type="button"
                  class="small border"
                  onclick={() => previewPlayer.playFromPreset(preset, audioUrls, `group:${gNo}`)}
                >
                  <i>play_arrow</i>
                  <span>連続試聴</span>
                </button>
                <button type="button" class="small border" onclick={() => (grp.audioIds = [...grp.audioIds, ""])}>
                  <i>add</i>
                  <span>音声追加</span>
                </button>
                <button
                  type="button"
                  class="small transparent circle error-text"
                  onclick={() => delete preset.audioGroups?.[gNo]}
                >
                  <i>delete</i>
                </button>
              </div>
              {#each grp.audioIds as _, aIdx (aIdx)}
                <div class="row item-row top-margin">
                  <span>{aIdx + 1}.</span>
                  <Dropdown full={true} bind:value={grp.audioIds[aIdx]} options={singleAudioOptions} />
                  <button type="button" class="small transparent circle" onclick={() => grp.audioIds.splice(aIdx, 1)}>
                    <i>close</i>
                  </button>
                </div>
              {/each}
            </article>
          {/each}
        </article>
      {/if}

      <!-- タブ2: 停留所データ・画像/音声レイヤー定義 -->
      {#if activeTab === "stops"}
        <article class="border padding">
          <div class="row wrap-row">
            <h6 class="max no-margin">停留所データ</h6>
            <span class="small-text">
              ※行をクリックすると右側のLCDプレビューに反映されます。空欄（前を維持）のセルは上の停留所の設定を自動で引き継ぎます。
            </span>
          </div>

          {#if masterStops.length === 0}
            <p class="top-margin">
              「1. 基本・素材」タブでダイヤグラム (timetable.csv) を読み込むと、ここに全停留所の一覧表が表示されます。
            </p>
          {:else}
            <div class="table-scroll top-margin">
              <table class="border stop-table">
                <thead>
                  <tr>
                    <th class="stop-col-no">#</th>
                    <th class="stop-col-name">停留所名</th>
                    {#each linkedImageSlots as [slotKey, slot] (slotKey)}
                      <th class="stop-col-slot">
                        <div class="slot-header">
                          <i>image</i>
                          <span>{slot.name}</span>
                          <code>({slotKey})</code>
                        </div>
                      </th>
                    {/each}
                    {#each linkedAudioSlots as [slotKey, slot] (slotKey)}
                      <th class="stop-col-slot">
                        <div class="slot-header">
                          <i>volume_up</i>
                          <span>{slot.name}</span>
                          <code>({slotKey})</code>
                        </div>
                      </th>
                    {/each}
                    {#each preset.progressionPhases as phase (phase.id)}
                      <th class="stop-col-slot">
                        <div class="slot-header">
                          <i>tv</i>
                          <span>LCD: {phase.label}</span>
                        </div>
                      </th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each masterStops as stopName, sIdx (sIdx)}
                    {@const keyStr = String(sIdx)}
                    <tr class:active-row={previewStopIdx === sIdx} onclick={() => selectPreviewStop(sIdx)}>
                      <td class="bold">#{sIdx}</td>
                      <td class="bold stop-name-cell">{stopName}</td>

                      {#each linkedImageSlots as [slotKey, slot] (slotKey)}
                        {@const effectiveHash = PresetService.resolveLayerImageHash(slot, sIdx)}
                        <td>
                          <Dropdown
                            full={true}
                            value={slot.items[keyStr] ?? ""}
                            onchange={(val) => {
                              slot.items[keyStr] = val;
                              selectPreviewStop(sIdx);
                            }}
                            options={tableImageOptions}
                          />
                          {#if !slot.items[keyStr] && effectiveHash && preset.images[effectiveHash]}
                            <div class="inherited-hint">
                              ↳ {preset.images[effectiveHash].originalName}
                            </div>
                          {/if}
                        </td>
                      {/each}

                      {#each linkedAudioSlots as [slotKey, slot] (slotKey)}
                        {@const effectiveAudId = PresetService.resolveAudioSlotTargetId(slot, sIdx)}
                        <td>
                          <div class="row item-row no-margin">
                            <Dropdown
                              full={true}
                              value={slot.items[keyStr] ?? ""}
                              onchange={(val) => {
                                slot.items[keyStr] = val;
                              }}
                              options={getTableAudioOptions(slot.inheritPrevious)}
                            />
                            {#if effectiveAudId}
                              <button
                                type="button"
                                class="small transparent circle"
                                title="この停留所で鳴る音声を試聴"
                                onclick={(e) => {
                                  e.stopPropagation();
                                  previewPlayer.playFromPreset(preset, audioUrls, effectiveAudId);
                                }}
                              >
                                <i>play_arrow</i>
                              </button>
                            {/if}
                          </div>
                        </td>
                      {/each}
                      {#each preset.progressionPhases as phase (phase.id)}
                        {@const overrideNo = preset.stopLcdOverrides?.[keyStr]?.[phase.id]}
                        <td>
                          <Dropdown
                            full={true}
                            value={overrideNo}
                            onchange={(val) => {
                              setStopPhaseLcdOverride(sIdx, phase.id, val);
                              if (val !== undefined) {
                                previewGroupNo = String(val);
                                previewSlideIdx = 0;
                              }
                            }}
                            options={[
                              {
                                value: undefined,
                                label:
                                  phase.lcdGroupNo !== undefined
                                    ? `── (基本: #${phase.lcdGroupNo})`
                                    : "── (基本: 切替なし)",
                              },
                              ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                                value: Number(gNo),
                                label: `#${gNo}: ${grp.name}`,
                              })),
                            ]}
                          />
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </article>

        <!-- レイヤー列（画像・音声スロット）の管理パネル -->
        <article class="border padding top-margin">
          <h6>レイヤー枠（テーブル列・非連動素材）の管理</h6>

          <p class="bold small-text no-margin">画像レイヤー:</p>
          {#each Object.entries(preset.layerSlots) as [slotKey, slot] (slotKey)}
            <div class="row wrap-row top-margin">
              <div class="field border small max no-margin">
                <input type="text" bind:value={slot.name} />
              </div>
              <code>{slotKey}</code>
              <label class="checkbox">
                <input type="checkbox" bind:checked={slot.linkedToCsvStop} />
                <span>停留所テーブル連動</span>
              </label>
              <button
                type="button"
                class="small transparent circle error-text"
                onclick={() => handleRemoveLayerSlot(slotKey)}
                title="レイヤー削除"
              >
                <i>delete</i>
              </button>
            </div>
          {/each}

          <div class="space"></div>
          <p class="bold small-text no-margin">音声レイヤー:</p>
          {#each Object.entries(preset.audioSlots ?? {}) as [slotKey, slot] (slotKey)}
            <div class="row wrap-row top-margin">
              <div class="field border small max no-margin">
                <input type="text" bind:value={slot.name} />
              </div>
              <code>{slotKey}</code>
              <label class="checkbox">
                <input type="checkbox" bind:checked={slot.linkedToCsvStop} />
                <span>停留所テーブル連動</span>
              </label>
              {#if slot.linkedToCsvStop}
                <label class="checkbox">
                  <input type="checkbox" bind:checked={slot.inheritPrevious} />
                  <span>空欄時は前を維持 (運賃・行先型)</span>
                </label>
              {:else}
                <Dropdown
                  bind:value={slot.defaultItemId}
                  options={[{ value: "", label: "-- 共通音声を選択 --" }, ...audioTargetEntries]}
                />
              {/if}
              <button
                type="button"
                class="small transparent circle error-text"
                onclick={() => handleRemoveAudioSlot(slotKey)}
                title="音声レイヤー削除"
              >
                <i>delete</i>
              </button>
            </div>
          {/each}

          <hr class="small-divider" />
          <h6>新規レイヤー枠の追加</h6>
          <div class="grid">
            <div class="s12 m4">
              <Dropdown
                full={true}
                label="種類"
                bind:value={newSlotKind}
                options={[
                  { value: "image", label: "画像レイヤー" },
                  { value: "audio", label: "音声レイヤー" },
                ]}
              />
            </div>
            <div class="s12 m4">
              <div class="field label border no-margin">
                <input type="text" bind:value={newSlotKey} />
                <label>ID (英数字)</label>
              </div>
            </div>
            <div class="s12 m4">
              <div class="field label border no-margin">
                <input type="text" bind:value={newSlotName} />
                <label>表示名</label>
              </div>
            </div>
          </div>
          <div class="row wrap-row top-margin">
            {#if newSlotKind === "audio"}
              <label class="checkbox max">
                <input type="checkbox" bind:checked={newSlotInherit} />
                <span>空欄時は前の停留所の音声を維持する</span>
              </label>
            {:else}
              <div class="max"></div>
            {/if}
            <button type="button" class="primary" onclick={handleAddSlot}>
              <i>add</i>
              <span>レイヤー枠を追加</span>
            </button>
          </div>
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
            <button type="button" class="primary" onclick={handleAddLcdGroup}>
              <i>add</i>
              <span>新規</span>
            </button>
            {#if Object.keys(preset.lcdGroups).length > 1}
              <button type="button" class="border error-text" onclick={() => handleRemoveLcdGroup(previewGroupNo)}>
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
              <button type="button" class="border" onclick={() => handleAddSlide(previewGroupNo)}>
                <i>add_photo_alternate</i>
                <span>スライド追加</span>
              </button>
            </div>
          {/if}
        </article>

        {#if preset.lcdGroups[previewGroupNo]}
          {@const currentGroup = preset.lcdGroups[previewGroupNo]}
          {#each currentGroup.slides as slide, sIdx (sIdx)}
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
                    type="button"
                    class="small transparent circle"
                    onclick={(e) => {
                      e.stopPropagation();
                      handleRemoveSlide(previewGroupNo, sIdx);
                    }}
                  >
                    <i>delete</i>
                  </button>
                {/if}
              </div>

              <div class="space"></div>
              <Dropdown full={true} label="ベース画像" bind:value={slide.baseImageId} options={imageOptions} />

              <div class="space"></div>
              <p class="bold no-margin">重ねる画像レイヤー（チェック順＝下から重ねる順）:</p>
              {#each Object.entries(preset.layerSlots) as [slotKey, slot] (slotKey)}
                {@const isVisible = slide.visibleLayers.includes(slotKey)}
                <div class="row wrap-row">
                  <label class="checkbox max">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onchange={(e) => PresetService.toggleSlideLayer(slide, slotKey, e.currentTarget.checked)}
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
                        oninput={(e) => PresetService.setSlideLayerOverride(slide, slotKey, e.currentTarget.value)}
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

      <!-- タブ4: 基本進行パターン・割り込み・例外アクション設定 -->
      {#if activeTab === "actions"}
        <!-- ① 1停留所あたりの基本進行パターン定義 -->
        <article class="border padding">
          <div class="row wrap-row">
            <h6 class="max no-margin">
              1停留所あたりの基本進行パターン (自動展開: 全{effectiveActions.length}ステップ)
            </h6>
            <button type="button" class="small border" onclick={() => applyPhaseTemplate("1-step")}>
              <span>1段階 (案内のみ)</span>
            </button>
            <button type="button" class="small border" onclick={() => applyPhaseTemplate("3-step")}>
              <span>3段階 (案内・到着・発車)</span>
            </button>
            <button type="button" class="small primary" onclick={handleAddPhase}>
              <i>add</i>
              <span>フェーズ追加</span>
            </button>
          </div>
          <p class="small-text">
            ここで定義したフェーズが「2.
            停留所」の全停留所に対して自動的に適用されます。各フェーズで鳴らす音声レイヤーにチェックを入れてください。
          </p>

          {#each preset.progressionPhases as phase, pIdx (phase.id)}
            <article class="border top-margin">
              <div class="row wrap-row">
                <span class="chip small bold">段階 {pIdx + 1}</span>
                <div class="field border small max no-margin">
                  <input type="text" bind:value={phase.label} placeholder="フェーズ表示名" />
                </div>
                <Dropdown
                  bind:value={phase.lcdGroupNo}
                  options={[
                    { value: undefined, label: "LCD切替なし (維持)" },
                    ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                      value: Number(gNo),
                      label: `LCD #${gNo}: ${grp.name}`,
                    })),
                  ]}
                />
                {#if preset.progressionPhases.length > 1}
                  <button
                    type="button"
                    class="small transparent circle error-text"
                    onclick={() => preset.progressionPhases.splice(pIdx, 1)}
                  >
                    <i>delete</i>
                  </button>
                {/if}
              </div>

              <div class="row wrap-row top-margin">
                <span class="small-text bold">鳴らす音声レイヤー:</span>
                {#each Object.entries(preset.audioSlots ?? {}) as [slotKey, slot] (slotKey)}
                  {@const isChecked = phase.playAudioSlots.includes(slotKey)}
                  <label class="checkbox">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onchange={(e) => {
                        phase.playAudioSlots = PresetService.toggleKeyInList(
                          phase.playAudioSlots,
                          slotKey,
                          e.currentTarget.checked,
                        );
                      }}
                    />
                    <span>{slot.name}</span>
                  </label>
                {/each}
              </div>

              <div class="row wrap-row top-margin">
                <span class="small-text bold">適用する停留所:</span>
                <label class="checkbox">
                  <input type="checkbox" bind:checked={phase.applyAtFirstStop} />
                  <span>始発 (#0)</span>
                </label>
                <label class="checkbox">
                  <input type="checkbox" bind:checked={phase.applyAtMiddleStops} />
                  <span>途中停留所</span>
                </label>
                <label class="checkbox">
                  <input type="checkbox" bind:checked={phase.applyAtLastStop} />
                  <span>終点</span>
                </label>
              </div>
            </article>
          {/each}
        </article>

        <!-- ② ショートカット割り込みアクション定義 -->
        <article class="border padding top-margin">
          <div class="row wrap-row">
            <h6 class="max no-margin">割り込みアクション (「次止まります」等の別ショートカット)</h6>
            <button type="button" class="small primary" onclick={handleAddInterrupt}>
              <i>add</i>
              <span>割り込み追加</span>
            </button>
          </div>

          {#if (preset.interrupts ?? []).length === 0}
            <p class="small-text">
              降車ボタン音や「次止まります」のLCD切り替えなど、通常のステップ進行とは独立したキー操作を追加できます。
            </p>
          {/if}

          {#each preset.interrupts ?? [] as intr, iIdx (intr.id)}
            <article class="border top-margin">
              <div class="row wrap-row">
                <div class="field border small max no-margin">
                  <input type="text" bind:value={intr.label} placeholder="割り込み名" />
                </div>
                <Dropdown bind:value={intr.shortcutKey} options={SHORTCUT_KEY_OPTIONS} />
                <Dropdown
                  bind:value={intr.lcdGroupNo}
                  options={[
                    { value: undefined, label: "LCD切替なし" },
                    ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                      value: Number(gNo),
                      label: `LCD #${gNo}: ${grp.name}`,
                    })),
                  ]}
                />
                <button
                  type="button"
                  class="small transparent circle error-text"
                  onclick={() => preset.interrupts.splice(iIdx, 1)}
                >
                  <i>delete</i>
                </button>
              </div>

              <div class="row wrap-row top-margin">
                <span class="small-text bold">鳴らす音声レイヤー:</span>
                {#each Object.entries(preset.audioSlots ?? {}) as [slotKey, slot] (slotKey)}
                  {@const isChecked = intr.playAudioSlots.includes(slotKey)}
                  <label class="checkbox">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onchange={(e) => {
                        intr.playAudioSlots = PresetService.toggleKeyInList(
                          intr.playAudioSlots,
                          slotKey,
                          e.currentTarget.checked,
                        );
                      }}
                    />
                    <span>{slot.name}</span>
                  </label>
                {/each}
              </div>

              <div class=" top-margin">
                <Dropdown
                  full={true}
                  label="または単体音声・音声グループを直接指定"
                  bind:value={intr.playAudioId}
                  options={audioSelectOptions}
                />
              </div>
            </article>
          {/each}
        </article>

        <!-- ③ 例外アクションの差し込み -->
        <article class="border padding top-margin">
          <div class="row wrap-row">
            <h6 class="max no-margin">
              例外アクションの差し込み ({preset.actions.length}件)
            </h6>
            <button
              type="button"
              class="small border"
              onclick={() => {
                PresetService.addExceptionStep(preset);
                expandedStepIdx = preset.actions.length - 1;
              }}
            >
              <i>add</i>
              <span>例外ステップ追加</span>
            </button>
          </div>
          <p class="small-text">
            始発前の業務放送や特定停留所でのみ挟む特別なアナウンスなど、基本進行パターン以外の例外ステップを差し込みます。
          </p>

          {#each preset.actions as step, idx (step.stepNo)}
            {@const isExpanded = expandedStepIdx === idx}
            <article class="border top-margin step-card">
              <div class="row wrap-row step-header" onclick={() => (expandedStepIdx = isExpanded ? null : idx)}>
                <i>{isExpanded ? "expand_less" : "expand_more"}</i>
                <span class="chip small bold">例外 #{idx + 1}</span>
                <span class="bold max step-title">{step.label}</span>
                {#if step.insertAfterStopIdx !== undefined}
                  <span class="chip small">
                    {step.insertAfterStopIdx < 0
                      ? "始発の前"
                      : `#${step.insertAfterStopIdx} ${masterStops[step.insertAfterStopIdx] ?? ""} の後`}
                  </span>
                {/if}
                <div class="row no-space" onclick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    class="small transparent circle error-text"
                    onclick={() => PresetService.removeActionStep(preset, idx)}
                  >
                    <i>delete</i>
                  </button>
                </div>
              </div>

              {#if isExpanded}
                <div class="space"></div>
                <div class="grid">
                  <div class="s12 m6">
                    <div class="field label border no-margin">
                      <input type="text" bind:value={step.label} />
                      <label>ステップ表示名</label>
                    </div>
                  </div>
                  <div class="s12 m6">
                    <Dropdown
                      full={true}
                      label="差し込み位置"
                      bind:value={step.insertAfterStopIdx}
                      options={[
                        { value: -1, label: "始発停留所の前 (運行開始直後)" },
                        ...masterStops.map((stopName, sIdx) => ({
                          value: sIdx,
                          label: `#${sIdx}: ${stopName} の全フェーズ完了後`,
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
                  <div class="s12 m6">
                    <Dropdown
                      full={true}
                      label="直接再生する音声 / グループ"
                      bind:value={step.playAudioId}
                      options={audioSelectOptions}
                    />
                  </div>
                </div>

                <div class="row wrap-row top-margin">
                  <span class="small-text bold">鳴らす音声レイヤー:</span>
                  {#each Object.entries(preset.audioSlots ?? {}) as [slotKey, slot] (slotKey)}
                    {@const isChecked = (step.playAudioSlots ?? []).includes(slotKey)}
                    <label class="checkbox">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onchange={(e) => {
                          step.playAudioSlots = PresetService.toggleKeyInList(
                            step.playAudioSlots,
                            slotKey,
                            e.currentTarget.checked,
                          );
                        }}
                      />
                      <span>{slot.name}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </article>
          {/each}
        </article>
      {/if}
    </div>

    <!-- 右カラム：常時表示のLCDリアルタイムプレビュー -->
    <div class="s12 m5">
      <article class="border padding">
        <div class="row">
          <h6 class="max">LCDリアルタイムプレビュー</h6>
          <button
            type="button"
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
            {#each grp.slides as _, idx (idx)}
              <button
                type="button"
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
        {#if masterStops.length > 0}
          <Dropdown
            full={true}
            label="プレビュー中の停留所"
            value={previewStopIdx}
            onchange={(idx) => selectPreviewStop(idx)}
            options={masterStops.map((name, idx) => ({
              value: idx,
              label: `#${idx}: ${name}`,
            }))}
          />
        {/if}
      </article>
    </div>
  </div>
</section>

<style>
  .grid > * {
    min-width: 0;
  }

  .wrap-row {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .item-row {
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    min-width: 0;
  }

  .number-box {
    width: 6.5rem;
  }

  .small-divider {
    margin: 1rem 0;
    opacity: 0.2;
  }

  .table-scroll {
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
  }

  .stop-table {
    min-width: 100%;
    table-layout: fixed;
    width: max-content;
  }

  .stop-col-no {
    width: 3.5rem;
  }

  .stop-col-name {
    width: 8.5rem;
  }

  .stop-col-slot {
    width: 14rem;
  }

  .slot-header {
    align-items: center;
    display: flex;
    gap: 0.25rem;
    min-width: 0;
    overflow: hidden;
  }

  .slot-header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stop-name-cell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active-row {
    background-color: rgb(255 255 255 / 8%);
  }

  .inherited-hint {
    font-size: 0.7rem;
    margin-top: 0.15rem;
    opacity: 0.65;
    overflow: hidden;
    padding-left: 0.25rem;
    text-overflow: ellipsis;
    white-space: nowrap;
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
