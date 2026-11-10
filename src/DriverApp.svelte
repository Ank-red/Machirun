<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import {
    createDefaultPreset,
    resolveActionStateUpTo,
    resolveAudioSequence,
  } from "./lib/preset";
  import { parseOptDiaCsv, getTodayTrips } from "./lib/timetable";
  import { importMchrnArchive, type LoadedArchive } from "./lib/archive";
  import {
    syncLcdStateToRust,
    registerAudioBlobsToRust,
  } from "./lib/lcdChannel";
  import Header from "./lib/Header.svelte";
  import Dropdown from "./lib/Dropdown.svelte";
  import FileButton from "./lib/FileButton.svelte";
  import PresetEditor from "./lib/PresetEditor.svelte";

  const isTauri = "__TAURI_INTERNALS__" in window;
  const isDev = import.meta.env.DEV;

  interface LoadedPresetItem extends LoadedArchive {
    id: string;
    fileName: string;
  }

  // --- View & Preset Collection State ---
  let currentView = $state<"driver" | "editor">("driver");
  let loadedPresets = $state<LoadedPresetItem[]>([]);
  let activePresetId = $state<string>("");

  let activeItem = $derived(
    loadedPresets.find((p) => p.id === activePresetId) ??
      loadedPresets[0] ??
      null,
  );

  let preset = $derived(activeItem?.preset ?? createDefaultPreset());
  let timetableCsv = $derived(activeItem?.timetableCsv ?? "");
  let imageBlobs = $derived(activeItem?.imageBlobs ?? {});
  let audioBlobs = $derived(activeItem?.audioBlobs ?? {});
  let audioUrls = $derived(activeItem?.audioUrls ?? {});

  // --- Driver Operation State ---
  let selectedTripIdx = $state<number>(0);
  let currentStopIdx = $state<number>(0);
  let currentActionIdx = $state<number>(-1);
  let currentPlayingAudioFile = $state<string>("");
  let audioNonce = $state<number>(0);
  let activeLcdGroupNo = $state<string>("1");
  let activeLcdSlideIdx = $state<number>(0);
  let activeLayerIndices = $state<Record<string, number | "+1" | null>>({
    stop: 0,
    fare: 0,
  });
  let now = $state<Date>(new Date());
  let activeAudioPlayer: HTMLAudioElement | null = null;
  let isMuted = $state<boolean>(false);

  // --- Release Download URLs (Web Only) ---
  let releaseUrls = $state({
    windows: "#",
    rpm: "#",
    deb: "#",
    appImage: "#",
  });

  // --- Derived Timetable & Step Data ---
  let hasPresetActions = $derived(preset.actions.length > 0);
  let currentActionStep = $derived(preset.actions[currentActionIdx] ?? null);

  let rawTrips = $derived.by(() => {
    if (!timetableCsv) return [];
    try {
      return parseOptDiaCsv(timetableCsv);
    } catch (err) {
      console.error("CSV Parse Error:", err);
      return [];
    }
  });

  let activeTrips = $derived(getTodayTrips(rawTrips, now));
  let currentTrip = $derived(activeTrips[selectedTripIdx] ?? null);
  let currentStop = $derived(currentTrip?.stops[currentStopIdx] ?? null);

  // --- Handlers & Methods ---

  function stopAudioPlayback(): void {
    if (activeAudioPlayer) {
      activeAudioPlayer.pause();
      activeAudioPlayer = null;
    }
  }

  function resetOperationState(): void {
    stopAudioPlayback();
    selectedTripIdx = 0;
    currentActionIdx = -1;
    currentStopIdx = 0;
    activeLcdGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
    activeLcdSlideIdx = 0;
    const initialLayers: Record<string, number | null> = {};
    for (const key of Object.keys(preset.layerSlots)) {
      initialLayers[key] = 0;
    }
    activeLayerIndices = initialLayers;
  }

  async function handleLoadPresetFiles(files: FileList): Promise<void> {
    for (const file of Array.from(files)) {
      try {
        const loaded = await importMchrnArchive(file);
        if (!loaded.preset.audioGroups) loaded.preset.audioGroups = {};

        const id = crypto.randomUUID().slice(0, 8);
        loadedPresets = [
          ...loadedPresets,
          { id, fileName: file.name, ...loaded },
        ];
        if (!activePresetId) {
          activePresetId = id;
        }
      } catch (err) {
        console.error(`プリセット読込失敗 (${file.name}):`, err);
      }
    }
    resetOperationState();
  }

  function playStepAudio(targetId?: string): void {
    if (isMuted) return;
    stopAudioPlayback();
    const { urls, firstFileName } = resolveAudioSequence(
      preset,
      audioUrls,
      targetId,
    );

    if (firstFileName) {
      const isStandby = hasPresetActions && currentActionIdx === -1;
      currentPlayingAudioFile = firstFileName;
      audioNonce++;
      syncLcdStateToRust({
        preset: isStandby ? null : preset,
        groupNo: activeLcdGroupNo,
        slideIdx: activeLcdSlideIdx,
        layerIndices: activeLayerIndices,
        imageBlobs: isStandby ? {} : imageBlobs,
        playingAudioFile: isStandby ? "" : currentPlayingAudioFile,
        audioNonce: isStandby ? 0 : audioNonce,
      });
    }

    if (urls.length === 0) return;

    let idx = 0;
    const playNext = () => {
      if (idx >= urls.length) return;
      activeAudioPlayer = new Audio(urls[idx++]);
      activeAudioPlayer.onended = playNext;
      activeAudioPlayer
        .play()
        .catch((err) => console.error("Audio Play Error:", err));
    };
    playNext();
  }

  function applyStepAt(targetIdx: number, shouldPlayAudio: boolean): void {
    if (preset.actions.length === 0) return;

    if (targetIdx < 0) {
      currentActionIdx = -1;
      const initial = resolveActionStateUpTo(preset, -1);
      currentStopIdx = initial.stopIndex;
      activeLcdGroupNo = initial.lcdGroupNo;
      activeLcdSlideIdx = 0;
      activeLayerIndices = initial.layerIndices;
      stopAudioPlayback();
      return;
    }

    const clampedIdx = Math.max(
      0,
      Math.min(targetIdx, preset.actions.length - 1),
    );
    currentActionIdx = clampedIdx;

    const maxStopIdx = Math.max(0, (currentTrip?.stops.length ?? 1) - 1);
    const resolved = resolveActionStateUpTo(preset, clampedIdx, maxStopIdx);

    currentStopIdx = resolved.stopIndex;
    if (activeLcdGroupNo !== resolved.lcdGroupNo) {
      activeLcdGroupNo = resolved.lcdGroupNo;
      activeLcdSlideIdx = 0;
    }
    activeLayerIndices = resolved.layerIndices;

    if (shouldPlayAudio) {
      playStepAudio(preset.actions[clampedIdx]?.playAudioId);
    } else {
      stopAudioPlayback();
    }
  }

  function advanceStep(): void {
    if (!currentTrip || !hasPresetActions) return;
    if (currentActionIdx < preset.actions.length - 1) {
      applyStepAt(currentActionIdx + 1, true);
    }
  }

  function retreatStep(): void {
    if (!hasPresetActions) return;
    if (currentActionIdx > -1) {
      applyStepAt(currentActionIdx - 1, false);
    }
  }

  async function fetchLatestReleaseUrls(): Promise<void> {
    try {
      const res = await fetch(
        "https://api.github.com/repos/Ank-red/Machirun/releases/latest",
      );
      if (!res.ok) return;
      const data = await res.json();
      for (const asset of data.assets ?? []) {
        if (asset.name.endsWith("-setup.exe"))
          releaseUrls.windows = asset.browser_download_url;
        if (asset.name.endsWith(".rpm"))
          releaseUrls.rpm = asset.browser_download_url;
        if (asset.name.endsWith(".deb"))
          releaseUrls.deb = asset.browser_download_url;
        if (asset.name.endsWith(".AppImage"))
          releaseUrls.appImage = asset.browser_download_url;
      }
    } catch (err) {
      console.error("Failed to fetch release URLs:", err);
    }
  }

  // --- Effects & Lifecycle ---

  // アクティブなプリセットの音声バイナリが変わったらRust側へ登録
  $effect(() => {
    if (!isTauri) return;
    registerAudioBlobsToRust(audioBlobs);
  });

  // 車載器モード中のLCDスライド自動ループタイマー
  $effect(() => {
    if (!isTauri || currentView !== "driver") return;
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

  // 車載器モード中のLCD状態をRustサーバーへ同期
  $effect(() => {
    if (!isTauri || currentView !== "driver") return;
    const isStandby = hasPresetActions && currentActionIdx === -1;

    syncLcdStateToRust({
      preset: isStandby ? null : preset,
      groupNo: activeLcdGroupNo,
      slideIdx: activeLcdSlideIdx,
      layerIndices: activeLayerIndices,
      imageBlobs: isStandby ? {} : imageBlobs,
      playingAudioFile: isStandby ? "" : currentPlayingAudioFile,
      audioNonce: isStandby ? 0 : audioNonce,
    });
  });

  onMount(() => {
    console.log(import.meta.env.DEV);
    console.table(import.meta.env);

    if (!isTauri) {
      fetchLatestReleaseUrls();
      return;
    }

    const timer = setInterval(() => {
      now = new Date();
    }, 1000);

    let unlisten: (() => void) | null = null;
    listen<string>("global-key", (event) => {
      if (currentView !== "driver") return;
      if (event.payload === "ArrowRight") advanceStep();
      else if (event.payload === "ArrowLeft") retreatStep();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      clearInterval(timer);
      unlisten?.();
    };
  });
</script>

{#if !isTauri && !isDev}
  <!-- Webブラウザで開かれた場合はデスクトップ版のダウンロード案内のみ表示 -->
  <Header title="Machirun Driver" />
  <main class="responsive padding">
    <article class="border round large-padding center-align">
      <h5>Machirun デスクトップ版</h5>
      <p>
        車載器システムおよび停留所エディタはデスクトップ版アプリでご利用いただけます。
      </p>
      <div class="space"></div>
      <nav class="center-align wrap">
        <a class="button fill" href={releaseUrls.windows}>Windows</a>
        <a class="button fill" href={releaseUrls.rpm}>Fedora Linux (rpm)</a>
        <a class="button fill" href={releaseUrls.deb}>Debian GNU/Linux (deb)</a>
        <a class="button fill" href={releaseUrls.appImage}>Linux版 (AppImage)</a
        >
      </nav>
    </article>
  </main>
{:else}
  <!-- デスクトップ版（Tauri）メイン画面 -->
  <Header title="Machirun">
    <Dropdown
      bind:value={currentView}
      options={[
        { value: "driver", label: "車載器" },
        { value: "editor", label: "停留所エディタ" },
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
        bind:value={activePresetId}
        options={loadedPresets.map((p) => ({
          value: p.id,
          label: p.fileName,
        }))}
        onchange={resetOperationState}
      />
    {/if}
    <button
      class="border circle"
      onclick={() => (isMuted = !isMuted)}
      title={isMuted ? "ミュート解除" : "ミュート"}
    >
      <i>{isMuted ? "volume_off" : "volume_up"}</i>
    </button>
    <FileButton
      label="mchrn追加読込"
      icon="folder_open"
      accept=".mchrn,.zip"
      multiple={true}
      onselect={handleLoadPresetFiles}
    />
  </Header>

  <main class="responsive padding">
    {#if currentView === "driver"}
      <article class="border round center-align">
        {#if loadedPresets.length === 0}
          <div class="padding">
            <h5>.mchrn プリセットファイルが読み込まれていません</h5>
            <p class="small-text">
              上部の「mchrn追加読込」ボタンから運行プリセットファイルを選択してください。
            </p>
          </div>
        {:else if currentTrip && currentStop}
          <div class="row center-align">
            <div
              class="small-width bold padding fill round center-align large-text"
            >
              停留所 <br />({currentStopIdx + 1} / {currentTrip.stops.length})
            </div>
            <h1 class="max bold center-align">{currentStop.name}</h1>
            <h3 class="small-width bold padding fill round center-align">
              {now.toLocaleTimeString("ja-JP", { hour12: false })}
            </h3>
          </div>

          {#if hasPresetActions}
            {#if currentActionIdx < 0}
              <div class="row center-align padding">
                <h3 class="amber-text">運行準備中</h3>
              </div>
            {:else if currentActionStep}
              <span class="large-text">
                ステップ ({currentActionIdx + 1} / {preset.actions.length}):
                <b>{currentActionStep.label}</b>
              </span>
            {/if}
          {/if}

          <div class="row center-align">
            {#if currentStop.arrival}
              <article class="max small fill center-align middle-align">
                <div>
                  <h2 class="bold">予定着</h2>
                  <h2 class="bold">{currentStop.arrival}</h2>
                </div>
              </article>
            {/if}
            {#if currentStop.departure}
              <article class="max small fill center-align middle-align">
                <div>
                  <h2 class="bold">予定発</h2>
                  <h2 class="bold">{currentStop.departure}</h2>
                </div>
              </article>
            {/if}
          </div>

          <nav>
            {#if currentActionIdx < 0}
              <button
                class="max extra large-text"
                onclick={advanceStep}
                disabled={hasPresetActions &&
                  currentActionIdx >= preset.actions.length - 1}
              >
                運行開始
              </button>
            {:else}
              <button
                class="extra"
                onclick={retreatStep}
                disabled={hasPresetActions
                  ? currentActionIdx === 0
                  : currentStopIdx === 0}
              >
                ◀ 前へ
              </button>

              <button
                class="max extra large-text"
                onclick={advanceStep}
                disabled={hasPresetActions &&
                  currentActionIdx >= preset.actions.length - 1}
              >
                {preset.actions[currentActionIdx + 1]?.label ?? "終点"} ▶
              </button>
            {/if}
          </nav>
        {:else}
          <p class="empty">本日の運行便はありません</p>
        {/if}
      </article>
    {:else if activeItem}
      <PresetEditor
        bind:preset={activeItem.preset}
        bind:timetableCsv={activeItem.timetableCsv}
        bind:imageBlobs={activeItem.imageBlobs}
        bind:imageUrls={activeItem.imageUrls}
        bind:audioBlobs={activeItem.audioBlobs}
        bind:audioUrls={activeItem.audioUrls}
      />
    {:else}
      <article class="border padding center-align">
        <p>
          編集する mchrn
          プリセットが読み込まれていません。「mchrn追加読込」からファイルを追加してください。
        </p>
      </article>
    {/if}
  </main>
{/if}
