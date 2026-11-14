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
  import type {
    ConvertedAssetResult,
    LcdSlide,
    RoutePreset,
  } from "../core/types";

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
    onsave?: () => void;
    onsaveas?: () => void;
    onimport?: () => void;
  } = $props();

  // --- Services & Editor UI State ---

  /** エディタ内試聴用の音声プレイヤーインスタンス */
  const previewPlayer = new AudioPlayerService();

  /** 現在開いている編集タブ */
  let activeTab = $state<"base" | "layers" | "lcd" | "actions">("base");

  /** 新規レイヤースロット追加用の入力状態 */
  let newSlotKey = $state("");
  let newSlotName = $state("");

  /** アセット変換処理中のローディング状態 */
  let isRegisteringImage = $state(false);
  let isRegisteringAudio = $state(false);

  /** LCDリアルタイムプレビューの状態 */
  let isLoopPreviewing = $state(false);
  let previewGroupNo = $state("1");
  let previewSlideIdx = $state(0);
  let previewLayerIndices = $state<Record<string, number | null>>({
    stop: 0,
    fare: 0,
  });
  let activePreviewStepIdx = $state<number | null>(null);

  /** アクションステップの展開・一括生成マクロ設定状態 */
  let expandedStepIdx = $state<number | null>(null);
  let macroPattern = $state<"1-step" | "3-step">("3-step");
  let macroRunningGroupNo = $state<number | undefined>(1);
  let macroStoppingGroupNo = $state<number | undefined>(undefined);
  let macroArriveAudioId = $state<string | undefined>(undefined);
  let macroCloseAudioId = $state<string | undefined>(undefined);

  // --- Derived ---

  /** CSVから抽出されたマスター停留所リスト */
  let masterStops = $derived(TimetableService.extractMasterStops(timetableCsv));

  /** 現在プレビュー中のLCDスライド */
  let currentPreviewSlide = $derived<LcdSlide | undefined>(
    preset.lcdGroups[previewGroupNo]?.slides[previewSlideIdx],
  );

  /** 画像選択ドロップダウン用の選択肢配列 */
  let imageOptions = $derived([
    { value: "", label: "-- 画像を選択 --" },
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

  /** アクションステップ用（音声グループ＋単体音声）の選択肢配列 */
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
  async function registerAssetsBatch<
    T extends { fileName: string; originalName: string },
  >(
    files: FileList,
    converter: (
      file: File,
      existingId?: string,
    ) => Promise<ConvertedAssetResult<T>>,
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
  async function replaceSingleAsset<
    T extends { fileName: string; originalName: string },
  >(
    hashId: string,
    files: FileList,
    converter: (
      file: File,
      existingId?: string,
    ) => Promise<ConvertedAssetResult<T>>,
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
    } finally {
      isRegisteringImage = false;
    }
  }

  /**
   * 既存の画像アセットを別ファイルで差し替える
   * @param hashId 差し替え対象の画像ハッシュID
   * @param files 選択された画像FileList
   */
  async function handleImageReplace(
    hashId: string,
    files: FileList,
  ): Promise<void> {
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
  async function handleAudioReplace(
    hashId: string,
    files: FileList,
  ): Promise<void> {
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

  // --- Layer & LCD Group Handlers ---

  /**
   * 新規レイヤースロットを追加する
   */
  function handleAddLayerSlot(): void {
    const key = newSlotKey.trim();
    const name = newSlotName.trim();
    if (!key || !name || preset.layerSlots[key]) return;

    preset.layerSlots[key] = { name, linkedToCsvStop: false, items: {} };
    previewLayerIndices[key] = 0;
    newSlotKey = "";
    newSlotName = "";
  }

  /**
   * レイヤースロットを削除する
   * @param slotKey 削除対象のスロットキー
   */
  function handleRemoveLayerSlot(slotKey: string): void {
    PresetService.removeLayerSlot(preset, slotKey);
    delete previewLayerIndices[slotKey];
  }

  /**
   * CSVのマスター停留所数に合わせてレイヤースロットの番号枠を作成する
   * @param slotKey 対象のスロットキー
   */
  function syncSlotItemsWithCsv(slotKey: string): void {
    const slot = preset.layerSlots[slotKey];
    if (!slot || masterStops.length === 0) return;

    for (let i = 0; i < masterStops.length; i++) {
      const no = String(i);
      if (!(no in slot.items)) slot.items[no] = "";
    }
  }

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

  // --- Action Step & Preview Simulation Handlers ---

  /**
   * 指定インデックスまでのステップを畳み込み、LCDプレビューと音声再生をテストする
   * @param targetIdx テスト対象のステップインデックス
   */
  function simulateStepAt(targetIdx: number): void {
    activePreviewStepIdx = targetIdx;
    const resolved = PresetService.resolveStateUpTo(preset, targetIdx);
    previewGroupNo = resolved.lcdGroupNo;
    previewSlideIdx = 0;
    previewLayerIndices = resolved.layerIndices;

    previewPlayer.playFromPreset(
      preset,
      audioUrls,
      preset.actions[targetIdx]?.playAudioId,
    );
  }

  /**
   * マクロ設定に基づきCSV停留所から全アクションステップを一括生成する
   */
  function handleGenerateStepsFromCsv(): void {
    PresetService.generateStepsFromCsv(preset, masterStops, {
      pattern: macroPattern,
      runningGroupNo: macroRunningGroupNo,
      stoppingGroupNo: macroStoppingGroupNo,
      arriveAudioId: macroArriveAudioId,
      closeAudioId: macroCloseAudioId,
    });
    expandedStepIdx = null;
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
    {#if onimport}
      <button type="button" class="border" onclick={onimport}>
        <i>folder_open</i>
        <span>読み込み</span>
      </button>
    {:else}
      <FileButton
        label="読み込み"
        icon="folder_open"
        accept=".mchrn,.zip"
        onselect={handleImport}
      />
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
    <button
      type="button"
      class="primary"
      onclick={() => (onsave ? onsave() : handleExport())}
      title="Ctrl + S"
    >
      <i>save</i>
      <span>上書き保存</span>
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
                onclick={() =>
                  previewPlayer.playFromPreset(preset, audioUrls, hashId)}
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
            <h6 class="max no-margin">
              音声グループ (チャイム＋放送などの連続再生セット)
            </h6>
            <button
              type="button"
              class="small border"
              onclick={handleAddAudioGroup}
            >
              <i>add</i>
              <span>グループ追加</span>
            </button>
          </div>
          {#each Object.entries(preset.audioGroups ?? {}) as [gNo, grp] (gNo)}
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
                  type="button"
                  class="small border"
                  onclick={() =>
                    previewPlayer.playFromPreset(
                      preset,
                      audioUrls,
                      `group:${gNo}`,
                    )}
                >
                  <i>play_arrow</i>
                  <span>連続試聴</span>
                </button>
                <button
                  type="button"
                  class="small border"
                  onclick={() => (grp.audioIds = [...grp.audioIds, ""])}
                >
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
                  <Dropdown
                    full={true}
                    bind:value={grp.audioIds[aIdx]}
                    options={singleAudioOptions}
                  />
                  <button
                    type="button"
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
        {#each Object.entries(preset.layerSlots) as [slotKey, slot] (slotKey)}
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
                type="button"
                class="small transparent circle"
                onclick={() => handleRemoveLayerSlot(slotKey)}
              >
                <i>delete</i>
              </button>
            </div>

            <div class="row wrap-row top-margin">
              <button
                type="button"
                class="small border"
                onclick={() => {
                  const nums = Object.keys(slot.items)
                    .map(Number)
                    .filter((n) => !Number.isNaN(n));
                  const nextNo = nums.length > 0 ? Math.max(...nums) + 1 : 0;
                  slot.items[String(nextNo)] = "";
                }}
              >
                <i>add</i>
                <span>番号を追加</span>
              </button>
              {#if slot.linkedToCsvStop && masterStops.length > 0}
                <button
                  type="button"
                  class="small border"
                  onclick={() => syncSlotItemsWithCsv(slotKey)}
                >
                  <i>sync</i>
                  <span>CSV停留所数 ({masterStops.length}件) の枠を作成</span>
                </button>
              {/if}
            </div>

            <div class="space"></div>

            {#each Object.keys(slot.items) as no (no)}
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
                  type="button"
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
          <button type="button" class="primary" onclick={handleAddLayerSlot}>
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
            <button type="button" class="primary" onclick={handleAddLcdGroup}>
              <i>add</i>
              <span>新規</span>
            </button>
            {#if Object.keys(preset.lcdGroups).length > 1}
              <button
                type="button"
                class="border error-text"
                onclick={() => handleRemoveLcdGroup(previewGroupNo)}
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
              <button
                type="button"
                class="border"
                onclick={() => handleAddSlide(previewGroupNo)}
              >
                <i>add_photo_alternate</i>
                <span>スライド追加</span>
              </button>
            </div>
          {/if}
        </article>

        <!-- 選択中グループ内のスライド一覧 -->
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
              {#each Object.entries(preset.layerSlots) as [slotKey, slot] (slotKey)}
                {@const isVisible = slide.visibleLayers.includes(slotKey)}
                <div class="row wrap-row">
                  <label class="checkbox max">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onchange={(e) =>
                        PresetService.toggleSlideLayer(
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
                          PresetService.setSlideLayerOverride(
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
              <button
                type="button"
                class="border"
                onclick={handleGenerateStepsFromCsv}
              >
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
              type="button"
              class="primary"
              onclick={() => {
                PresetService.addActionStep(preset);
                expandedStepIdx = preset.actions.length - 1;
              }}
            >
              <i>add</i>
              <span>ステップ追加</span>
            </button>
          </div>
        </article>

        <!-- コンパクト折りたたみ式ステップリスト -->
        {#each preset.actions as step, idx (step.stepNo)}
          {@const isExpanded = expandedStepIdx === idx}
          <article
            class="border top-margin step-card"
            class:fill={activePreviewStepIdx === idx}
          >
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

              <div class="row no-space" onclick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  class="small border"
                  onclick={() => simulateStepAt(idx)}
                >
                  <i>play_circle</i>
                  <span>テスト</span>
                </button>
                <button
                  type="button"
                  class="small transparent circle"
                  disabled={idx === 0}
                  onclick={() => PresetService.moveActionStep(preset, idx, -1)}
                >
                  <i>arrow_upward</i>
                </button>
                <button
                  type="button"
                  class="small transparent circle"
                  disabled={idx === preset.actions.length - 1}
                  onclick={() => PresetService.moveActionStep(preset, idx, 1)}
                >
                  <i>arrow_downward</i>
                </button>
                <button
                  type="button"
                  class="small transparent circle"
                  onclick={() => PresetService.duplicateActionStep(preset, idx)}
                >
                  <i>content_copy</i>
                </button>
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
                {#each Object.entries(preset.layerSlots) as [slotKey, slot] (slotKey)}
                  <div class="s12 m6">
                    <Dropdown
                      full={true}
                      label={`${slot.name} (${slotKey})`}
                      value={step.setLayers?.[slotKey]}
                      onchange={(val) =>
                        PresetService.updateStepLayerValue(step, slotKey, val)}
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
        <p>プレビュー用レイヤー番号切り替え:</p>
        {#each Object.entries(preset.layerSlots) as [slotKey, slot] (slotKey)}
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

  .stop-chip {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .number-box {
    width: 6.5rem;
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
