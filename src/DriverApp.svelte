<script lang="ts">
  import { onMount } from "svelte";
  import { parseOptDiaCsv, getTodayTrips, type BusTrip } from "./lib/timetable";
  import { listen } from "@tauri-apps/api/event";
  import Dropdown from "./lib/Dropdown.svelte";
  import PresetEditor from "./lib/PresetEditor.svelte";

  // CSVファイルを個別に明示インポート（パスのトラブルを防ぐ一番確実な方法）
  import csvKamoKudari from "./data/鴨飼経由_下り.csv?raw";
  import csvKamoNobori from "./data/鴨飼経由_上り.csv?raw";
  import csvNokoKudari from "./data/鋸倉経由_下り.csv?raw";
  import csvNokoNobori from "./data/鋸倉経由_上り.csv?raw";

  let route = $state<string>("鴨飼経由");
  let direction = $state<string>("下り");

  // 運行モードの切り替え ("1-step" または "3-step")
  let operationMode = $state<"1-step" | "3-step">("1-step");
  // 3段階モード時の現在のステップ (0: ドア開け待ち, 1: 案内音声待ち, 2: ドア閉め・次へ待ち)
  let currentStep = $state<number>(0);

  let selectedTripIdx = $state<number>(0);
  let currentStopIdx = $state<number>(0);
  let now = $state<Date>(new Date());

  // 選択肢に応じたCSVテキストを返すマップ
  const csvMap: Record<string, string> = {
    鴨飼経由_下り: csvKamoKudari,
    鴨飼経由_上り: csvKamoNobori,
    鋸倉経由_下り: csvNokoKudari,
    鋸倉経由_上り: csvNokoNobori,
  };

  // 現在選択されているルート・方向のCSVをパース
  let rawTrips = $derived.by(() => {
    const key = `${route}_${direction}`;
    const csvText = csvMap[key];
    if (!csvText) return [];
    try {
      return parseOptDiaCsv(csvText);
    } catch (e) {
      console.error("CSV Parse Error:", e);
      return [];
    }
  });

  // 本日運行する便だけに絞り込む
  let activeTrips = $derived(getTodayTrips(rawTrips, now));
  let currentTrip = $derived(activeTrips[selectedTripIdx] ?? null);
  let currentStop = $derived(currentTrip?.stops[currentStopIdx] ?? null);

  // ルートや方向が変更されたときだけ、便とステップをリセットする
  let previousRouteDir = $state(`${route}_${direction}`);
  $effect(() => {
    const currentRouteDir = `${route}_${direction}`;
    if (previousRouteDir !== currentRouteDir) {
      previousRouteDir = currentRouteDir;
      selectedTripIdx = 0;
      currentStopIdx = 0;
      currentStep = 0;
    }
  });

  // メインボタンが押されたときの処理
  function handleMainAction() {
    if (!currentTrip) return;

    if (operationMode === "1-step") {
      // 1段階式：即座に次の停留所へ
      if (currentStopIdx < currentTrip.stops.length - 1) {
        currentStopIdx++;
      }
    } else {
      // 3段階式：ステップを進める
      if (currentStep === 0) {
        // 1段階目：ドアを開ける（音声トリップ等）
        currentStep = 1;
      } else if (currentStep === 1) {
        // 2段階目：案内を流す
        currentStep = 2;
      } else if (currentStep === 2) {
        // 3段階目：ドアを閉めて次へ
        if (currentStopIdx < currentTrip.stops.length - 1) {
          currentStopIdx++;
        }
        currentStep = 0; // 次の停留所の1段階目に戻る
      }
    }
  }

  function prevStop() {
    if (currentStopIdx > 0) {
      currentStopIdx--;
      currentStep = 0;
    }
  }

  // Tauri環境かどうかを判定する用
  const isTauri = "__TAURI_INTERNALS__" in window;

  // キーボードショートカットの登録
  onMount(() => {
    // 1. 時計のタイマー
    const timer = setInterval(() => {
      now = new Date();
    }, 1000);

    // 2. ブラウザ用の通常ショートカット関数
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        return;
      }
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
      // パススルー方式：SoundPadやVRChatのキー操作を一切邪魔せずに検知
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
    }

    return () => {
      clearInterval(timer);
      if (unlisten) unlisten();
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  // ダウンロードURL
  let rpmUrl = $state("#");
  let debUrl = $state("#");
  let AppImageUrl = $state("#");
  let winUrl = $state("#");

  onMount(async () => {
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
  });
</script>

<header class="responsive top-margin">
  <nav class="toolbar padding">
    <span class="large-text bold left-margin">Machirun 車載器</span>

    <div class="max"></div>

    <!-- 経由地 -->
    <Dropdown
      bind:value={route}
      options={[
        { value: "鴨飼経由", label: "鴨飼経由" },
        { value: "鋸倉経由", label: "鋸倉経由" },
      ]}
    />

    <!-- 上下方向 -->
    <Dropdown
      bind:value={direction}
      options={[
        { value: "下り", label: "下り" },
        { value: "上り", label: "上り" },
      ]}
    />

    <!-- 1段階・3段階の切り替えトグル -->
    <Dropdown
      bind:value={operationMode}
      options={[
        { value: "1-step", label: "1段階式 (一発送り)" },
        { value: "3-step", label: "3段階式 (開閉音声式)" },
      ]}
    />

    {#if activeTrips.length > 0}
      <Dropdown
        bind:value={selectedTripIdx}
        options={activeTrips.map((trip, idx) => ({
          value: idx,
          label: `${trip.trainNumber}便 (${trip.operationNumber}) ${trip.destination}行`,
        }))}
      />
    {/if}
  </nav>
</header>

<main class="responsive padding">
  <article class="border round center-align">
    {#if currentTrip && currentStop}
      <div class="row center-align">
        <div
          class="small-width bold padding fill round center-align large-text"
        >
          停留所 <br />({currentStopIdx + 1} / {currentTrip.stops.length})
        </div>
        <h1 class="max bold center-align">
          {currentStop.name}
        </h1>
        <h3 class="small-width bold padding fill round center-align">
          {now.toLocaleTimeString("ja-JP", { hour12: false })}
        </h3>
      </div>
      {#if operationMode === "3-step"}
        <span class="large-text">
          {#if currentStep === 0}走行中
          {:else if currentStep === 1}停車中
          {:else if currentStep === 2}発車待ち
          {/if}
        </span>
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

      <nav class="">
        <button
          class="extra"
          onclick={prevStop}
          disabled={currentStopIdx === 0 && currentStep === 0}>◀ 前へ</button
        >

        <button
          class="max extra large-text"
          onclick={handleMainAction}
          disabled={currentStopIdx >= currentTrip.stops.length - 1 &&
            currentStep === 2}
        >
          {#if operationMode === "1-step"}
            通過 ▶
          {:else if currentStep === 0}
            到着 ▶
          {:else if currentStep === 1}
            ドア閉め ▶
          {:else}
            発車 ▶
          {/if}
        </button>
      </nav>
    {:else}
      <p class="empty">本日の運行便はありません</p>
    {/if}
  </article>

  {#if !isTauri}
    <section>
      <p>デスクトップ版のダウンロードはこちら</p>
      <a class="button fill" href={winUrl}>Windows</a>
      <a class="button fill" href={rpmUrl}>Fedora Linux (rpm)</a>
      <a class="button fill" href={debUrl}>Debian GNU/Linux (deb)</a>
      <a class="button fill" href={AppImageUrl}>Linux版 (AppImage)</a>
    </section>
  {/if}

  <PresetEditor />
</main>
