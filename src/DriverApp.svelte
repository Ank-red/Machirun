<script lang="ts">
  // --- Imports ---

  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import DownloadView from "./views/Download.svelte";
  import DriverView from "./views/Driver.svelte";
  import EditorView from "./views/Editor.svelte";
  import InfoView from "./views/Info.svelte";
  import { ArchiveService } from "./core/archive";
  import { AudioPlayerService } from "./core/audioPlayer";
  import { IS_TAURI, LcdSyncService } from "./core/lcdSync";
  import { PresetService } from "./core/preset";
  import { TimetableService } from "./core/timetable";
  import type { LayerOperationValue, LoadedPresetItem } from "./core/types";
  import Dropdown from "./components/Dropdown.svelte";
  import FileButton from "./components/FileButton.svelte";
  import Header from "./components/Header.svelte";

  // --- Constants & Services ---

  /** 開発モード判定フラグ */
  const IS_DEV = import.meta.env.DEV;

  /** 車載器運行用の音声プレイヤーインスタンス */
  const driverAudioPlayer = new AudioPlayerService();

  // --- View & Preset Collection State ---

  /** 現在選択されている画面ビュー */
  let currentView = $state<"driver" | "editor" | "info">("driver");

  /** 読み込み済みの `.mchrn` プリセット一覧 */
  let loadedPresets = $state<LoadedPresetItem[]>([]);

  /** 現在アクティブなプリセットのID */
  let activePresetId = $state<string>("");

  /** 現在アクティブなプリセットアイテム */
  let activeItem = $derived(
    loadedPresets.find((p) => p.id === activePresetId) ??
      loadedPresets[0] ??
      null,
  );

  /** アクティブなプリセット構造 */
  let preset = $derived(activeItem?.preset ?? PresetService.createDefault());

  /** プリセットファイルの読み込み中フラグ */
  let isLoadingPresets = $state<boolean>(false);

  /** 移動・削除により読み込めなかったファイルの通知メッセージ */
  let missingFilesNotice = $state<string>("");

  /** アクティブなダイヤグラムCSV文字列 */
  let timetableCsv = $derived(activeItem?.timetableCsv ?? "");

  /** アクティブな画像バイナリマップ */
  let imageBlobs = $derived(activeItem?.imageBlobs ?? {});

  /** アクティブな音声バイナリマップ */
  let audioBlobs = $derived(activeItem?.audioBlobs ?? {});

  /** アクティブな音声Object URLマップ */
  let audioUrls = $derived(activeItem?.audioUrls ?? {});

  // --- Driver Operation State ---

  /** 選択中の運行便インデックス */
  let selectedTripIdx = $state<number>(0);

  /** 現在の停留所インデックス */
  let currentStopIdx = $state<number>(0);

  /** 現在のアクションステップインデックス（-1は運行準備中） */
  let currentActionIdx = $state<number>(-1);

  /** OBS側で再生トリガーをかける先頭音声ファイル名 */
  let currentPlayingAudioFile = $state<string>("");

  /** OBS側の音声再生トリガー用カウンタ */
  let audioNonce = $state<number>(0);

  /** 現在表示中のLCDグループ番号 */
  let activeLcdGroupNo = $state<string>("1");

  /** 現在表示中のLCDスライドインデックス */
  let activeLcdSlideIdx = $state<number>(0);

  /** 現在の各レイヤースロット番号マップ */
  let activeLayerIndices = $state<Record<string, LayerOperationValue>>({
    stop: 0,
    fare: 0,
  });

  /** 現在時刻 */
  let now = $state<Date>(new Date());

  /** アプリ全体のミュート状態 */
  let isMuted = $state<boolean>(false);

  // --- Derived Timetable & Step Data ---

  /** プリセットにアクションステップが存在するかどうか */
  let hasPresetActions = $derived(preset.actions.length > 0);

  /** CSVからパースされた全運行便データ */
  let rawTrips = $derived.by(() => {
    try {
      return TimetableService.parseOptDiaCsv(timetableCsv);
    } catch (err) {
      console.error("CSV Parse Error:", err);
      return [];
    }
  });

  /** 当日運行対象の便リスト */
  let activeTrips = $derived(TimetableService.getTodayTrips(rawTrips, now));

  /** 現在選択されている便データ */
  let currentTrip = $derived(activeTrips[selectedTripIdx] ?? null);

  /** 現在表示中の停留所スケジュール */
  let currentStop = $derived(currentTrip?.stops[currentStopIdx] ?? null);

  /** 現在アクティブなプリセットに未保存の変更があるかどうか */
  let isDirty = $derived(
    activeItem
      ? ArchiveService.createSnapshot(
          activeItem.preset,
          activeItem.timetableCsv,
        ) !== activeItem.savedSnapshot
      : false,
  );

  // --- Handlers & Methods ---

  /**
   * 通知スナックバーを一定時間表示する
   * @param message 表示するメッセージ
   */
  function showNotice(message: string): void {
    missingFilesNotice = message;
    setTimeout(() => {
      if (missingFilesNotice === message) {
        missingFilesNotice = "";
      }
    }, 5000);
  }

  /**
   * 新規の空プリセットを作成してアクティブにする
   */
  async function handleCreateNewPreset(): Promise<void> {
    if (isDirty) {
      const ok = await ArchiveService.confirmDiscardChanges(
        "現在のプリセットに未保存の変更があります。新規プリセットを作成しますか？",
      );
      if (!ok) return;
    }

    const presetData = PresetService.createDefault();
    const id = crypto.randomUUID().slice(0, 8);
    const savedSnapshot = ArchiveService.createSnapshot(presetData, "");

    const newItem: LoadedPresetItem = {
      id,
      fileName: "新規プリセット.mchrn",
      filePath: undefined,
      savedSnapshot,
      preset: presetData,
      timetableCsv: "",
      imageBlobs: {},
      imageUrls: {},
      audioBlobs: {},
      audioUrls: {},
    };

    loadedPresets = [...loadedPresets, newItem];
    activePresetId = id;
    currentView = "editor";
    resetOperationState();
  }

  /**
   * 車載器の運行状態を初期（運行準備中）へリセットする
   */
  function resetOperationState(): void {
    driverAudioPlayer.stop();
    selectedTripIdx = 0;
    currentActionIdx = -1;
    currentStopIdx = 0;
    activeLcdGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
    activeLcdSlideIdx = 0;
    activeLayerIndices = PresetService.createInitialLayerIndices(preset);
  }

  /**
   * Rustから受け取った生ファイル配列をプリセット一覧へ追加し、パス履歴を更新する
   * @param rawFiles 読み込まれた生ファイルデータの配列
   * @param replaceActive 現在のアクティブアイテムを置き換える場合はtrue
   */
  function registerRawFiles(
    rawFiles: { path: string; fileName: string; data: number[] }[],
    replaceActive: boolean = false,
  ): void {
    if (rawFiles.length === 0) return;

    for (const raw of rawFiles) {
      try {
        const loaded = ArchiveService.importFromBytes(new Uint8Array(raw.data));
        const savedSnapshot = ArchiveService.createSnapshot(
          loaded.preset,
          loaded.timetableCsv,
        );

        if (replaceActive && activeItem) {
          activeItem.fileName = raw.fileName;
          activeItem.filePath = raw.path;
          activeItem.preset = loaded.preset;
          activeItem.timetableCsv = loaded.timetableCsv;
          activeItem.imageBlobs = loaded.imageBlobs;
          activeItem.imageUrls = loaded.imageUrls;
          activeItem.audioBlobs = loaded.audioBlobs;
          activeItem.audioUrls = loaded.audioUrls;
          activeItem.savedSnapshot = savedSnapshot;
        } else {
          const existingIdx = loadedPresets.findIndex(
            (p) => p.filePath && p.filePath === raw.path,
          );
          const id =
            existingIdx >= 0
              ? loadedPresets[existingIdx].id
              : crypto.randomUUID().slice(0, 8);
          const newItem: LoadedPresetItem = {
            id,
            fileName: raw.fileName,
            filePath: raw.path,
            savedSnapshot,
            ...loaded,
          };

          if (existingIdx >= 0) {
            loadedPresets[existingIdx] = newItem;
          } else {
            loadedPresets = [...loadedPresets, newItem];
          }
          if (!activePresetId) activePresetId = id;
        }
      } catch (err) {
        console.error(`プリセット読込失敗 (${raw.fileName}):`, err);
      }
    }

    ArchiveService.saveRecentPaths(loadedPresets.map((p) => p.filePath));
    resetOperationState();
  }

  async function handleOpenNativeFiles(
    replaceActive: boolean = false,
  ): Promise<void> {
    if (replaceActive && isDirty) {
      const ok = await ArchiveService.confirmDiscardChanges();
      if (!ok) return;
    }
    isLoadingPresets = true;
    try {
      const rawFiles = await ArchiveService.openFilesNative();
      registerRawFiles(rawFiles, replaceActive);
    } finally {
      isLoadingPresets = false;
    }
  }

  /**
   * ブラウザのFileListから `.mchrn` を追加読み込みする（Webフォールバック用）
   * @param files 選択されたFileList
   */
  async function handleLoadPresetFiles(files: FileList): Promise<void> {
    for (const file of Array.from(files)) {
      try {
        const loaded = await ArchiveService.importMchrn(file);
        const id = crypto.randomUUID().slice(0, 8);
        const savedSnapshot = ArchiveService.createSnapshot(
          loaded.preset,
          loaded.timetableCsv,
        );
        loadedPresets = [
          ...loadedPresets,
          { id, fileName: file.name, savedSnapshot, ...loaded },
        ];
        if (!activePresetId) activePresetId = id;
      } catch (err) {
        console.error(`プリセット読込失敗 (${file.name}):`, err);
      }
    }
    resetOperationState();
  }

  /**
   * 現在アクティブなプリセットを保存する
   * @param forceSaveAs trueの場合は既存パスがあっても「名前をつけて保存」ダイアログを開く
   */
  async function handleSaveActivePreset(
    forceSaveAs: boolean = false,
  ): Promise<void> {
    if (!activeItem) return;

    const targetPath = forceSaveAs ? undefined : activeItem.filePath;
    const savedPath = await ArchiveService.saveMchrn(
      {
        preset: activeItem.preset,
        timetableCsv: activeItem.timetableCsv,
        imageBlobs: activeItem.imageBlobs,
        audioBlobs: activeItem.audioBlobs,
      },
      targetPath,
    );

    if (savedPath) {
      activeItem.filePath = savedPath;
      activeItem.fileName =
        savedPath.split(/[/\\]/).pop() ?? activeItem.fileName;
      activeItem.savedSnapshot = ArchiveService.createSnapshot(
        activeItem.preset,
        activeItem.timetableCsv,
      );
      ArchiveService.saveRecentPaths(loadedPresets.map((p) => p.filePath));
    }
  }

  /**
   * 画面ビュー切り替え時に未保存の変更があれば確認を行う
   * @param nextView 切り替え先のビュー
   */
  async function handleViewChange(
    nextView: "driver" | "editor" | "info",
  ): Promise<void> {
    if (currentView === "editor" && nextView !== "editor" && isDirty) {
      const ok = await ArchiveService.confirmDiscardChanges(
        "編集中のプリセットに保存されていない変更があります。このまま別画面へ切り替えますか？",
      );
      if (!ok) {
        currentView = "editor";
        return;
      }
    }
    currentView = nextView;
  }

  /**
   * アクティブプリセット切り替え時に未保存の変更があれば確認を行う
   * @param nextId 切り替え先のプリセットID
   */
  async function handlePresetChange(nextId: string): Promise<void> {
    if (isDirty && activeItem && nextId !== activeItem.id) {
      const ok = await ArchiveService.confirmDiscardChanges(
        "現在のプリセットに保存されていない変更があります。別のプリセットへ切り替えますか？",
      );
      if (!ok) {
        activePresetId = activeItem.id;
        return;
      }
    }
    activePresetId = nextId;
    resetOperationState();
  }

  /**
   * ミュート状態を切り替える
   */
  function toggleMute(): void {
    isMuted = !isMuted;
    driverAudioPlayer.setMuted(isMuted);
  }

  /**
   * ステップの音声を再生し、OBS（Rustサーバー）側へも再生トリガーを同期する
   * @param targetId 再生対象の音声IDまたはグループID
   */
  function playStepAudio(targetId?: string): void {
    const firstFileName = driverAudioPlayer.playFromPreset(
      preset,
      audioUrls,
      targetId,
    );

    if (firstFileName) {
      const isStandby = hasPresetActions && currentActionIdx === -1;
      currentPlayingAudioFile = firstFileName;
      audioNonce++;
      LcdSyncService.syncState({
        preset: isStandby ? null : preset,
        groupNo: activeLcdGroupNo,
        slideIdx: activeLcdSlideIdx,
        layerIndices: activeLayerIndices,
        imageBlobs: isStandby ? {} : imageBlobs,
        playingAudioFile: isStandby ? "" : currentPlayingAudioFile,
        audioNonce: isStandby ? 0 : audioNonce,
      });
    }
  }

  /**
   * 指定インデックスのアクションステップ状態を適用する
   * @param targetIdx 適用するステップインデックス（-1で待機状態へ戻す）
   * @param shouldPlayAudio 音声を再生するかどうか
   */
  function applyStepAt(targetIdx: number, shouldPlayAudio: boolean): void {
    if (preset.actions.length === 0) return;

    if (targetIdx < 0) {
      currentActionIdx = -1;
      const initial = PresetService.resolveStateUpTo(preset, -1);
      currentStopIdx = initial.stopIndex;
      activeLcdGroupNo = initial.lcdGroupNo;
      activeLcdSlideIdx = 0;
      activeLayerIndices = initial.layerIndices;
      driverAudioPlayer.stop();
      return;
    }

    const clampedIdx = Math.max(
      0,
      Math.min(targetIdx, preset.actions.length - 1),
    );
    currentActionIdx = clampedIdx;

    const maxStopIdx = Math.max(0, (currentTrip?.stops.length ?? 1) - 1);
    const resolved = PresetService.resolveStateUpTo(
      preset,
      clampedIdx,
      maxStopIdx,
    );

    currentStopIdx = resolved.stopIndex;
    if (activeLcdGroupNo !== resolved.lcdGroupNo) {
      activeLcdGroupNo = resolved.lcdGroupNo;
      activeLcdSlideIdx = 0;
    }
    activeLayerIndices = resolved.layerIndices;

    if (shouldPlayAudio) {
      playStepAudio(preset.actions[clampedIdx]?.playAudioId);
    } else {
      driverAudioPlayer.stop();
    }
  }

  /**
   * アクションステップを1つ進める
   */
  function advanceStep(): void {
    if (!currentTrip || !hasPresetActions) return;
    if (currentActionIdx < preset.actions.length - 1) {
      applyStepAt(currentActionIdx + 1, true);
    }
  }

  /**
   * アクションステップを1つ戻す（音声は鳴らさない）
   */
  function retreatStep(): void {
    if (!hasPresetActions) return;
    if (currentActionIdx > -1) {
      applyStepAt(currentActionIdx - 1, false);
    }
  }

  // --- Effects & Lifecycle ---

  /** アクティブなプリセットの音声バイナリが変わったらRust側へ登録 */
  $effect(() => {
    LcdSyncService.registerAudioBlobs(audioBlobs);
  });

  /** 車載器モード中のLCDスライド自動ループタイマー */
  $effect(() => {
    if (!IS_TAURI || currentView !== "driver") return;
    const group = preset.lcdGroups[activeLcdGroupNo];
    if (!group || group.slides.length <= 1) return;

    const slide = group.slides[activeLcdSlideIdx];
    const durationMs = Math.max(1, slide?.durationSec ?? 5) * 1000;

    const timer = setTimeout(() => {
      const nextIdx = activeLcdSlideIdx + 1;
      if (nextIdx < group.slides.length) {
        activeLcdSlideIdx = nextIdx;
      } else if (group.loop) {
        activeLcdSlideIdx = 0;
      }
    }, durationMs);

    return () => clearTimeout(timer);
  });

  /** 車載器モード中のLCD状態をRustサーバーへ同期 */
  $effect(() => {
    if (!IS_TAURI || currentView !== "driver") return;
    const isStandby = hasPresetActions && currentActionIdx === -1;

    LcdSyncService.syncState({
      preset: isStandby ? null : preset,
      groupNo: activeLcdGroupNo,
      slideIdx: activeLcdSlideIdx,
      layerIndices: activeLayerIndices,
      imageBlobs: isStandby ? {} : imageBlobs,
      playingAudioFile: isStandby ? "" : currentPlayingAudioFile,
      audioNonce: isStandby ? 0 : audioNonce,
    });
  });

  /** 未保存変更状態（isDirty）をRust側のウィンドウ終了ガードへ同期 */
  $effect(() => {
    ArchiveService.syncUnsavedState(isDirty);
  });

  onMount(() => {
    // Ctrl + S / Ctrl + Shift + S ショートカット監視
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeItem) {
          handleSaveActivePreset(e.shiftKey);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    if (!IS_TAURI) {
      return () => window.removeEventListener("keydown", handleKeyDown);
    }

    // 前回読み込んだ .mchrn パス一覧の自動復元
    const recentPaths = ArchiveService.loadRecentPaths();
    if (recentPaths.length > 0) {
      isLoadingPresets = true;
      ArchiveService.readFilesByPaths(recentPaths)
        .then(({ loaded, missing }) => {
          registerRawFiles(loaded, false);
          if (missing.length > 0) {
            const names = missing
              .map((p) => p.split(/[/\\]/).pop() ?? p)
              .join(", ");
            showNotice(
              `移動または削除されたファイルをスキップしました: ${names}`,
            );
            // 読み込めた有効なパスだけで localStorage を更新
            ArchiveService.saveRecentPaths(
              loadedPresets.map((p) => p.filePath),
            );
          }
        })
        .finally(() => {
          isLoadingPresets = false;
        });
    }

    const timer = setInterval(() => {
      now = new Date();
    }, 1000);

    let unlistenKey: (() => void) | null = null;
    listen<string>("global-key", (event) => {
      if (currentView !== "driver") return;
      if (event.payload === "ArrowRight") advanceStep();
      else if (event.payload === "ArrowLeft") retreatStep();
    }).then((fn) => {
      unlistenKey = fn;
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearInterval(timer);
      unlistenKey?.();
    };
  });
</script>

{#if !IS_TAURI && !IS_DEV}
  <DownloadView />
{:else}
  <Header title="Machirun">
    <Dropdown
      value={currentView}
      onchange={handleViewChange}
      options={[
        { value: "driver", label: "車載器" },
        { value: "editor", label: "停留所エディタ" },
        { value: "info", label: "ソフトウェア情報" },
      ]}
    />
    <div class="max" data-tauri-drag-region></div>

    {#if activeTrips.length > 0 && currentView === "driver"}
      <Dropdown
        bind:value={selectedTripIdx}
        onchange={() => applyStepAt(-1, false)}
        options={activeTrips.map((trip, idx) => ({
          value: idx,
          label: `${trip.trainNumber}便 (${trip.operationNumber}) ${trip.destination}行`,
        }))}
      />
    {/if}
    {#if loadedPresets.length > 0}
      <Dropdown
        value={activePresetId}
        options={loadedPresets.map((p) => ({
          value: p.id,
          label: p.fileName,
        }))}
        onchange={handlePresetChange}
      />
    {/if}
    <button
      type="button"
      class="border circle"
      onclick={toggleMute}
      title={isMuted ? "ミュート解除" : "ミュート"}
    >
      <i>{isMuted ? "volume_off" : "volume_up"}</i>
    </button>
    {#if IS_TAURI}
      <button
        type="button"
        class="border"
        onclick={() => handleOpenNativeFiles(false)}
      >
        <i>folder_open</i>
        <span>mchrn追加読込</span>
      </button>
    {:else}
      <FileButton
        label="mchrn追加読込"
        icon="folder_open"
        accept=".mchrn,.zip"
        multiple={true}
        onselect={handleLoadPresetFiles}
      />
    {/if}
  </Header>

  <main class="responsive padding">
    {#if currentView === "driver"}
      <DriverView
        isLoading={isLoadingPresets}
        hasLoadedPresets={loadedPresets.length > 0}
        {currentTrip}
        {currentStop}
        {currentStopIdx}
        {currentActionIdx}
        actions={preset.actions}
        {now}
        onadvance={advanceStep}
        onretreat={retreatStep}
      />
    {:else if currentView === "editor"}
      {#if isLoadingPresets}
        <article class="border round large-padding center-align">
          <progress class="circle large"></progress>
          <h6 class="top-margin">プリセットファイルを読み込み中...</h6>
        </article>
      {:else if activeItem}
        <EditorView
          bind:preset={activeItem.preset}
          bind:timetableCsv={activeItem.timetableCsv}
          bind:imageBlobs={activeItem.imageBlobs}
          bind:imageUrls={activeItem.imageUrls}
          bind:audioBlobs={activeItem.audioBlobs}
          bind:audioUrls={activeItem.audioUrls}
          {isMuted}
          {isDirty}
          onsave={() => handleSaveActivePreset(false)}
          onsaveas={() => handleSaveActivePreset(true)}
          onimport={IS_TAURI ? () => handleOpenNativeFiles(true) : undefined}
        />
      {:else}
        <article class="border round large-padding center-align">
          <p>
            編集する mchrn
            プリセットが読み込まれていません。「mchrn追加読込」からファイルを追加するか、新規作成してください。
          </p>
          <nav class="center-align">
            <button
              type="button"
              class="primary"
              onclick={handleCreateNewPreset}
            >
              <i>add</i>
              <span>新規プリセットを作成</span>
            </button>
          </nav>
        </article>
      {/if}
    {:else if currentView === "info"}
      <InfoView />
    {/if}

    {#if missingFilesNotice}
      <div class="snackbar active">
        <i>info</i>
        <div class="max">{missingFilesNotice}</div>
      </div>
    {/if}
  </main>
{/if}
