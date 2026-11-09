<script lang="ts">
  // --- Imports ---
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import type { RoutePreset } from "./lib/preset";
  import { parseOptDiaCsv, getTodayTrips } from "./lib/timetable";
  import { importArchiveMchrn } from "./lib/archive";
  import {
    broadcastLcdState,
    registerAudioBlobsToRust,
  } from "./lib/lcdChannel";
  import Header from "./lib/Header.svelte";
  import Dropdown from "./lib/Dropdown.svelte";
  import FileButton from "./lib/FileButton.svelte";
  import LcdScreen from "./lib/LcdScreen.svelte";
  import PresetEditor from "./lib/PresetEditor.svelte";

  // --- Constants ---
  const isTauri = "__TAURI_INTERNALS__" in window;
  const isLcdMode =
    new URLSearchParams(window.location.search).get("mode") === "lcd";

  // --- State & Derived ---
  let currentView = $state<"driver" | "editor">("driver");

  /**
   * 読み込み済みプリセットのコレクション管理
   */
  interface LoadedPresetItem {
    id: string;
    fileName: string;
    preset: RoutePreset;
    timetableCsv: string;
    imageBlobs: Record<string, Uint8Array>;
    imageUrls: Record<string, string>;
    audioBlobs: Record<string, Uint8Array>;
    audioUrls: Record<string, string>;
  }
  let loadedPresets = $state<LoadedPresetItem[]>([]);
  let activePresetId = $state<string>("");

  /**
   * 現在アクティブなプリセットデータ
   */
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

  // 車載器運行状態
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

  let winUrl = $state("#");
  let rpmUrl = $state("#");
  let debUrl = $state("#");
  let AppImageUrl = $state("#");

  let hasPresetActions = $derived(preset.actions.length > 0);
  let currentActionStep = $derived(preset.actions[currentActionIdx] ?? null);

  // アクティブなmchrn内のダイヤ解析
  let rawTrips = $derived.by(() => {
    if (!timetableCsv) return [];
    try {
      return parseOptDiaCsv(timetableCsv);
    } catch (e) {
      console.error("CSV Parse Error:", e);
      return [];
    }
  });

  let activeTrips = $derived(getTodayTrips(rawTrips, now));
  let currentTrip = $derived(activeTrips[selectedTripIdx] ?? null);
  let currentStop = $derived(currentTrip?.stops[currentStopIdx] ?? null);

  function createDefaultPreset(): RoutePreset {
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

  // --- Handlers & Methods ---

  /**
   * 複数選択対応：.mchrnファイルを読み込んでコレクションに追加する
   * @param files ファイル
   */
  async function handleLoadPresetFiles(files: FileList): Promise<void> {
    for (const file of Array.from(files)) {
      try {
        const loaded = await importArchiveMchrn(file);
        if (!loaded.preset.audioGroups) loaded.preset.audioGroups = {};

        const id = Math.random().toString(36).substring(2, 9);
        const newItem: LoadedPresetItem = {
          id,
          fileName: file.name,
          preset: loaded.preset,
          timetableCsv: loaded.timetableCsv,
          imageBlobs: loaded.imageBlobs,
          imageUrls: loaded.imageUrls,
          audioBlobs: loaded.audioBlobs,
          audioUrls: loaded.audioUrls,
        };

        loadedPresets = [...loadedPresets, newItem];
        if (!activePresetId) {
          activePresetId = id;
        }
        registerAudioBlobsToRust(audioBlobs);
      } catch (err) {
        console.error(`プリセット読込失敗 (${file.name}):`, err);
      }
    }
    selectedTripIdx = 0;
    currentActionIdx = -1;
    currentStopIdx = 0;
  }

  /**
   * 単体音声IDまたは音声グループ（"group:番号"）を順番に連続再生する
   * @param targetId 再生対象のID
   */
  function playAudioSequence(targetId?: string): void {
    if (activeAudioPlayer) {
      activeAudioPlayer.pause();
      activeAudioPlayer = null;
    }
    if (!targetId) return;

    let targetFileName = "";
    const queue: string[] = [];

    if (targetId.startsWith("group:")) {
      const gNo = targetId.slice(6);
      const grp = preset.audioGroups?.[gNo];
      if (grp && grp.audioIds.length > 0) {
        // グループの先頭（または最初の音声）のファイル名を特定
        const firstAudioId = grp.audioIds[0];
        const audioAsset = preset.audios?.[firstAudioId];
        if (audioAsset) targetFileName = audioAsset.fileName;

        for (const id of grp.audioIds) {
          if (audioUrls[id]) queue.push(audioUrls[id]);
        }
      }
    } else {
      const audioAsset = preset.audios?.[targetId];
      if (audioAsset) targetFileName = audioAsset.fileName;
      if (audioUrls[targetId]) queue.push(audioUrls[targetId]);
    }

    // 音声ファイル名をセットしてnonceを進め、即座にRust側へ同期する
    if (targetFileName) {
      const isStandby = hasPresetActions && currentActionIdx === -1;
      currentPlayingAudioFile = targetFileName;
      audioNonce++;
      broadcastLcdState(
        preset,
        activeLcdGroupNo,
        activeLcdSlideIdx,
        activeLayerIndices,
        isStandby ? {} : imageBlobs,
        isStandby ? "" : currentPlayingAudioFile,
        isStandby ? 0 : audioNonce,
      );
    }

    if (queue.length === 0) return;

    let idx = 0;
    const playNext = () => {
      if (idx >= queue.length) return;
      activeAudioPlayer = new Audio(queue[idx]);
      idx++;
      activeAudioPlayer.onended = playNext;
      activeAudioPlayer
        .play()
        .catch((err) => console.error("Audio Play Error:", err));
    };
    playNext();
  }

  /**
   * 先頭から指定インデックスまでのアクションステップを計算・適用する
   * （進むときも戻るときも状態がズレないよう、ステップ0から順に畳み込む）
   * @param targetIdx 適用するアクションステップのインデックス
   * @param shouldPlayAudio 対象ステップの音声を再生するかどうか
   */
  function applyActionStepsUpTo(
    targetIdx: number,
    shouldPlayAudio: boolean,
  ): void {
    if (preset.actions.length === 0) return;

    if (targetIdx < 0) {
      currentActionIdx = -1;
      // 必要であれば初期状態にリセット
      currentStopIdx = 0;
      activeLcdGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
      activeLcdSlideIdx = 0;
      for (const key of Object.keys(preset.layerSlots)) {
        activeLayerIndices[key] = 0;
      }
      if (activeAudioPlayer) {
        activeAudioPlayer.pause();
        activeAudioPlayer = null;
      }
      return;
    }

    const clampedIdx = Math.max(
      0,
      Math.min(targetIdx, preset.actions.length - 1),
    );
    currentActionIdx = clampedIdx;

    let simStopIdx = 0;
    let simGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";
    const simLayers: Record<string, number | "+1" | null> = {};
    for (const key of Object.keys(preset.layerSlots)) {
      simLayers[key] = 0;
    }

    const maxStopIdx = Math.max(0, (currentTrip?.stops.length ?? 1) - 1);

    for (let i = 0; i <= clampedIdx; i++) {
      const step = preset.actions[i];
      if (!step) continue;

      if (step.setStopIndex !== undefined) {
        if (step.setStopIndex === "+1") {
          simStopIdx = Math.min(maxStopIdx, simStopIdx + 1);
        } else {
          simStopIdx = Math.min(maxStopIdx, step.setStopIndex);
        }
      }

      if (step.setLcdGroupNo !== undefined) {
        simGroupNo = String(step.setLcdGroupNo);
      }

      if (step.setLayers) {
        for (const [slotKey, op] of Object.entries(step.setLayers)) {
          if (op === "+1") {
            const cur = simLayers[slotKey];
            simLayers[slotKey] = typeof cur === "number" ? cur + 1 : 0;
          } else if (typeof op === "number") {
            simLayers[slotKey] = op;
          } else if (op === null) {
            simLayers[slotKey] = null;
          }
        }
      }
    }

    currentStopIdx = simStopIdx;
    if (activeLcdGroupNo !== simGroupNo) {
      activeLcdGroupNo = simGroupNo;
      activeLcdSlideIdx = 0;
    }
    activeLayerIndices = simLayers;

    if (shouldPlayAudio) {
      playAudioSequence(preset.actions[clampedIdx]?.playAudioId);
    } else if (activeAudioPlayer) {
      activeAudioPlayer.pause();
      activeAudioPlayer = null;
    }
  }

  /**
   * メイン操作（進行ボタンまたは右矢印キー）実行時のステップ・停留所送り処理
   */
  function handleMainAction(): void {
    if (!currentTrip) return;
    if (hasPresetActions) {
      if (currentActionIdx < preset.actions.length - 1) {
        applyActionStepsUpTo(currentActionIdx + 1, true);
      }
    }
  }

  /**
   * 1つ前のステップまたは停留所へ戻る処理（左矢印キーまたは前へボタン）
   */
  function prevStop(): void {
    if (hasPresetActions) {
      if (currentActionIdx > -1) {
        applyActionStepsUpTo(currentActionIdx - 1, false);
      }
    }
  }
  /**
   * GitHub Releases APIから最新版のインストーラーダウンロードURLを取得する
   */
  async function fetchLatestReleaseUrls(): Promise<void> {
    const res = await fetch(
      "https://api.github.com/repos/Ank-red/Machirun/releases/latest",
    );
    if (!res.ok) return;
    const data = await res.json();
    for (const asset of data.assets) {
      if (asset.name.endsWith("-setup.exe"))
        winUrl = asset.browser_download_url;
      if (asset.name.endsWith(".rpm")) rpmUrl = asset.browser_download_url;
      if (asset.name.endsWith(".deb")) debUrl = asset.browser_download_url;
      if (asset.name.endsWith(".AppImage"))
        AppImageUrl = asset.browser_download_url;
    }
  }

  // --- Lifecycle & Effects ---

  // 車載器モード中のLCDスライド自動ループタイマー
  $effect(() => {
    if (isLcdMode || currentView !== "driver") return;
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

  // 車載器モード中のLCD状態を別ウィンドウ（PassengerApp）へ同期
  $effect(() => {
    if (isLcdMode || currentView !== "driver") return;

    const isStandby = hasPresetActions && currentActionIdx === -1;

    const sendingPreset = isStandby
      ? {
          meta: { name: "Standby" },
          images: {},
          layerSlots: {},
          audioGroups: {},
          lcdGroups: {},
          actions: [],
        }
      : preset;

    broadcastLcdState(
      sendingPreset as any,
      activeLcdGroupNo,
      activeLcdSlideIdx,
      activeLayerIndices,
      isStandby ? {} : imageBlobs,
      isStandby ? "" : currentPlayingAudioFile,
      isStandby ? 0 : audioNonce,
    );
  });

  onMount(() => {
    const timer = setInterval(() => {
      now = new Date();
    }, 1000);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      if (e.code === "ArrowRight") {
        e.preventDefault();
        handleMainAction();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        prevStop();
      }
    };

    let unlisten: (() => void) | null = null;
    if (isTauri) {
      listen<string>("global-key", (event: { payload: string }) => {
        if (event.payload === "ArrowRight") {
          handleMainAction();
        } else if (event.payload === "ArrowLeft") {
          prevStop();
        }
      }).then((fn: (() => void) | null) => {
        unlisten = fn;
      });
    } else {
      window.addEventListener("keydown", handleKeyDown);
      fetchLatestReleaseUrls();
    }

    return () => {
      clearInterval(timer);
      if (unlisten) unlisten();
      window.removeEventListener("keydown", handleKeyDown);
    };
  });
</script>

{#if isLcdMode}
  <!-- OBS・別ウィンドウ用の独立LCDスクリーン -->
  <LcdScreen standalone={true} />
{:else}
  <!-- 上部ナビゲーションヘッダー（タイトルクリックで車載器⇔エディタ切替） -->
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
        onchange={() => {
          if (hasPresetActions) applyActionStepsUpTo(0, false);
          else currentStopIdx = 0;
        }}
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
        onchange={() => {
          selectedTripIdx = 0;
          currentActionIdx = 0;
          currentStopIdx = 0;
        }}
      />
    {/if}
    <!-- <button
      class="border"
      onclick={openObsLcdWindow}
      title="OBS用LCDモニタを開く"
    >
      <i>tv</i>
      <span>OBS LCD</span>
    </button> -->
    <FileButton
      label="mchrn追加読込"
      icon="folder_open"
      accept=".mchrn,.zip"
      multiple={true}
      onselect={handleLoadPresetFiles}
    />
  </Header>

  <!-- メインコンテンツ領域 -->
  <main class="responsive padding">
    {#if currentView === "driver"}
      <!-- 車載器モニターパネル -->
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
                onclick={handleMainAction}
                disabled={hasPresetActions &&
                  currentActionIdx >= preset.actions.length - 1}
              >
                運行開始
              </button>
            {:else if currentActionIdx >= 0}
              <button
                class="extra"
                onclick={prevStop}
                disabled={hasPresetActions
                  ? currentActionIdx === 0
                  : currentStopIdx === 0}
              >
                ◀ 前へ
              </button>

              <button
                class="max extra large-text"
                onclick={handleMainAction}
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

      <!-- Web版向けデスクトップアプリ案内 -->
      {#if !isTauri}
        <section>
          <p>デスクトップ版のダウンロードはこちら</p>
          <a class="button fill" href={winUrl}>Windows</a>
          <a class="button fill" href={rpmUrl}>Fedora Linux (rpm)</a>
          <a class="button fill" href={debUrl}>Debian GNU/Linux (deb)</a>
          <a class="button fill" href={AppImageUrl}>Linux版 (AppImage)</a>
        </section>
      {/if}
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
