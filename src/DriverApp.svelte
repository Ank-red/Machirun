<script lang="ts">
  import { onMount } from "svelte";
  import { parseOptDiaCsv, getTodayTrips, type BusTrip } from "./lib/timetable";
  import { listen } from "@tauri-apps/api/event";

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
      listen<string>("global-key", (event) => {
        if (event.payload === "ArrowRight") {
          handleMainAction();
        } else if (event.payload === "ArrowLeft") {
          prevStop();
        }
      }).then((fn) => {
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
      if (asset.name.endsWith(".deb")) AppImageUrl = asset.browser_download_url;
    }
  });
</script>

<main class="container">
  <header class="toolbar">
    <span class="brand">Machirun 車載器</span>

    <div class="selectors">
      <select bind:value={route}>
        <option value="鴨飼経由">鴨飼経由</option>
        <option value="鋸倉経由">鋸倉経由</option>
      </select>
      <select bind:value={direction}>
        <option value="下り">下り (往路)</option>
        <option value="上り">上り (復路)</option>
      </select>
      <!-- 1段階・3段階の切り替えトグル -->
      <select bind:value={operationMode}>
        <option value="1-step">1段階式 (一発送り)</option>
        <option value="3-step">3段階式 (開閉音声式)</option>
      </select>
    </div>

    {#if activeTrips.length > 0}
      <select
        bind:value={selectedTripIdx}
        onchange={() => (currentStopIdx = 0)}
      >
        {#each activeTrips as trip, idx}
          <option value={idx}>
            {trip.trainNumber}便 ({trip.operationNumber}) {trip.destination}行
          </option>
        {/each}
      </select>
    {/if}

    <div class="clock">
      {now.toLocaleTimeString("ja-JP", { hour12: false })}
    </div>
  </header>

  {#if currentTrip && currentStop}
    <section class="monitor">
      <div class="stop-header">
        <span class="badge"
          >NEXT ({currentStopIdx + 1} / {currentTrip.stops.length})</span
        >
        <h1 class="stop-name">{currentStop.name}</h1>
        {#if operationMode === "3-step"}
          <span class="step-indicator">
            {#if currentStep === 0}走行中
            {:else if currentStep === 1}停車中
            {:else if currentStep === 2}発車待ち
            {/if}
          </span>
        {/if}
      </div>

      <div class="times">
        {#if currentStop.arrival}
          <div class="time-box">
            <span class="label">予定着</span>
            <span class="value">{currentStop.arrival}</span>
          </div>
        {/if}
        {#if currentStop.departure}
          <div class="time-box">
            <span class="label">予定発</span>
            <span class="value">{currentStop.departure}</span>
          </div>
        {/if}
      </div>

      <div class="controls">
        <button
          class="sub"
          onclick={prevStop}
          disabled={currentStopIdx === 0 && currentStep === 0}>◀ 前へ</button
        >

        <button
          class="primary"
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
      </div>
    </section>
  {:else}
    <p class="empty">本日の運行便はありません</p>
  {/if}

  {#if !isTauri}
    <section class="monitor">
      <p>デスクトップ版のダウンロードはこちら</p>
      <a class="sub" href={winUrl}>Windows</a><br />
      <a class="sub" href={rpmUrl}>Fedora Linux (rpm)</a><br />
      <a class="sub" href={debUrl}>Debian (deb)</a><br />
      <a class="sub" href={AppImageUrl}>Linux版 (AppImage)</a>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0f172a;
    color: #f8fafc;
    font-family: sans-serif;
  }
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 1rem;
  }
  .toolbar {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    background: #1e293b;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    flex-wrap: wrap;
  }
  .brand {
    font-weight: bold;
    color: #38bdf8;
  }
  .selectors {
    display: flex;
    gap: 0.5rem;
  }
  select {
    background: #0f172a;
    color: white;
    border: 1px solid #334155;
    padding: 0.4rem;
    border-radius: 4px;
  }
  .clock {
    font-size: 1.5rem;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    color: #38bdf8;
  }
  .monitor {
    margin-top: 1.5rem;
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 12px;
    text-align: center;
  }
  .badge {
    background: #0284c7;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.9rem;
    font-weight: bold;
  }
  .step-indicator {
    display: block;
    margin-top: 0.5rem;
    font-size: 1rem;
    color: #f59e0b;
    font-weight: bold;
  }
  .stop-name {
    font-size: 3rem;
    margin: 0.5rem 0;
  }
  .times {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin: 1.5rem 0;
  }
  .time-box {
    background: #0f172a;
    padding: 1rem 2rem;
    border-radius: 8px;
  }
  .label {
    display: block;
    font-size: 0.9rem;
    color: #94a3b8;
  }
  .value {
    font-size: 2.5rem;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }
  .controls {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }
  a,
  button {
    display: block;
    text-decoration: none;
    padding: 1rem;
    font-size: 1.25rem;
    font-weight: bold;
    border: none;
    border-radius: 8px;
    background: #334155;
    color: white;
    cursor: pointer;
  }
  a.sub,
  button.sub {
    flex: 1;
  }
  button.primary {
    flex: 3;
    background: #0284c7;
  }
  button.primary:hover {
    background: #0284c7dd;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .empty {
    text-align: center;
    color: #94a3b8;
    margin-top: 3rem;
  }
</style>
