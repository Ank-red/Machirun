<script lang="ts">
  // --- Imports ---

  import type { ActionStep, BusTrip, StopSchedule } from "../core/types";

  // --- Props ---

  let {
    hasLoadedPresets,
    currentTrip,
    currentStop,
    currentStopIdx,
    currentActionIdx,
    actions,
    now,
    onadvance,
    onretreat,
  }: {
    hasLoadedPresets: boolean;
    currentTrip: BusTrip | null;
    currentStop: StopSchedule | null;
    currentStopIdx: number;
    currentActionIdx: number;
    actions: ActionStep[];
    now: Date;
    onadvance: () => void;
    onretreat: () => void;
  } = $props();

  // --- Derived ---

  /** プリセットにアクションステップが定義されているかどうか */
  let hasPresetActions = $derived(actions.length > 0);

  /** 現在実行中のアクションステップ */
  let currentActionStep = $derived(actions[currentActionIdx] ?? null);
</script>

<!-- 車載器メイン運行画面 -->
<article class="border round center-align">
  {#if !hasLoadedPresets}
    <div class="padding">
      <h5>.mchrn プリセットファイルが読み込まれていません</h5>
      <p class="small-text">
        上部の「mchrn追加読込」ボタンから運行プリセットファイルを選択してください。
      </p>
    </div>
  {:else if currentTrip && currentStop}
    <div class="row center-align">
      <div class="small-width bold padding fill round center-align large-text">
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
          ステップ ({currentActionIdx + 1} / {actions.length}):
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
          type="button"
          class="max extra large-text"
          onclick={onadvance}
          disabled={hasPresetActions && currentActionIdx >= actions.length - 1}
        >
          運行開始
        </button>
      {:else}
        <button
          type="button"
          class="extra"
          onclick={onretreat}
          disabled={hasPresetActions
            ? currentActionIdx === 0
            : currentStopIdx === 0}
        >
          ◀ 前へ
        </button>

        <button
          type="button"
          class="max extra large-text"
          onclick={onadvance}
          disabled={hasPresetActions && currentActionIdx >= actions.length - 1}
        >
          {actions[currentActionIdx + 1]?.label ?? "終点"} ▶
        </button>
      {/if}
    </nav>
  {:else}
    <p class="empty">本日の運行便はありません</p>
  {/if}
</article>
