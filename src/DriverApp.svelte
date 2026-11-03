<script lang="ts">
  import { onMount } from "svelte";
  import { parseOptDiaCsv, getTodayTrips, type BusTrip } from "./lib/timetable";

  // CSVファイルを個別に明示インポート（パスのトラブルを防ぐ一番確実な方法）
  import csvKamoDaikyu from "./data/鴨飼経由_下り.csv?raw";
  import csvKamoUekyu from "./data/鴨飼経由_上り.csv?raw";

  let route = $state<string>("鴨飼経由");
  let direction = $state<string>("下り");

  let selectedTripIdx = $state<number>(0);
  let currentStopIdx = $state<number>(0);
  let now = $state<Date>(new Date());

  // 選択肢に応じたCSVテキストを返すマップ
  const csvMap: Record<string, string> = {
    鴨飼経由_下り: csvKamoDaikyu,
    鴨飼経由_上り: csvKamoUekyu,
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

  // 便やルートが変わったら選択インデックスをリセット
  $effect(() => {
    // 依存している状態が変わったときにインデックスを保護
    if (selectedTripIdx >= activeTrips.length) {
      selectedTripIdx = 0;
      currentStopIdx = 0;
    }
  });

  onMount(() => {
    const timer = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(timer);
  });

  function nextStop() {
    if (currentTrip && currentStopIdx < currentTrip.stops.length - 1) {
      currentStopIdx++;
    }
  }

  function prevStop() {
    if (currentStopIdx > 0) currentStopIdx--;
  }
</script>

<main class="container">
  <header class="toolbar">
    <span class="brand">Machirun 車載器</span>

    <div class="selectors">
      <select bind:value={route}>
        <option value="鴨飼経由">鴨飼経由</option>
      </select>
      <select bind:value={direction}>
        <option value="下り">下り (往路)</option>
        <option value="上り">上り (復路)</option>
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
        <button onclick={prevStop} disabled={currentStopIdx === 0}
          >◀ 前の停留所</button
        >
        <button
          class="primary"
          onclick={nextStop}
          disabled={currentStopIdx >= currentTrip.stops.length - 1}
        >
          次の停留所へ進む ▶
        </button>
      </div>
    </section>
  {:else}
    <p class="empty">本日の運行便はありません</p>
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
  .stop-name {
    font-size: 3rem;
    margin: 1rem 0;
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
  button {
    flex: 1;
    padding: 1rem;
    font-size: 1.25rem;
    font-weight: bold;
    border: none;
    border-radius: 8px;
    background: #334155;
    color: white;
    cursor: pointer;
  }
  button.primary {
    flex: 2;
    background: #0284c7;
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
