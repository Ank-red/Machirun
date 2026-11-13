<script lang="ts" generics="T">
  // --- Props ---

  let {
    value = $bindable(),
    options,
    label,
    full = false,
    onchange,
  }: {
    value: T;
    options: { value: T; label: string }[];
    label?: string;
    full?: boolean;
    onchange?: (val: T) => void;
  } = $props();

  // --- State & Derived ---

  /** ドロップダウン外枠のDOM参照 */
  let containerEl: HTMLDivElement;

  /** メニューを上方向に開くかどうかの状態 */
  let openUpward = $state(false);

  /** 現在選択されている項目の表示ラベル */
  let selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? String(value ?? ""),
  );

  // --- Handlers & Methods ---

  /**
   * 画面下部の余白を計算し、メニューの展開方向（上下）を更新する
   */
  function updateDirection(): void {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    openUpward = spaceBelow < 260 && rect.top > spaceBelow;
  }

  /**
   * 項目を選択し、バインド値とコールバックを更新してフォーカスを外す
   * @param val 選択された値
   */
  function selectItem(val: T): void {
    value = val;
    onchange?.(val);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }
</script>

<!-- BeerCSS メニュードロップダウン -->
<div bind:this={containerEl} class="dropdown-container" class:full-width={full}>
  {#if label}
    <span class="dropdown-label">{label}</span>
  {/if}
  <button
    type="button"
    class="border dropdown-button"
    onmouseenter={updateDirection}
    onfocus={updateDirection}
  >
    <span class="dropdown-sizer">
      <span class="dropdown-text">{selectedLabel}</span>
      {#each options as opt (opt.label)}
        <span class="dropdown-ghost" aria-hidden="true">{opt.label}</span>
      {/each}
    </span>
    <i>arrow_drop_down</i>
  </button>
  <menu class="dropdown-menu" class:open-up={openUpward}>
    {#each options as opt (opt.label)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li
        class:active={opt.value === value}
        onclick={() => selectItem(opt.value)}
      >
        {opt.label}
      </li>
    {/each}
  </menu>
</div>

<style>
  .dropdown-container {
    display: inline-flex;
    flex-direction: column;
    max-width: 100%;
    min-width: 0;
    position: relative;
  }

  .dropdown-container.full-width {
    display: flex;
    flex: 1 1 0%;
    width: 100%;
  }

  .dropdown-label {
    font-size: 0.75rem;
    margin-bottom: 0.2rem;
    opacity: 0.85;
    overflow: hidden;
    padding-left: 0.25rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-button {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin: 0;
    max-width: 100%;
    min-width: 0;
    width: 100%;
  }

  .dropdown-sizer {
    display: inline-grid;
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .dropdown-text,
  .dropdown-ghost {
    grid-area: 1 / 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-ghost {
    height: 0;
    pointer-events: none;
    user-select: none;
    visibility: hidden;
  }

  .dropdown-menu {
    max-height: 16rem;
    overflow-y: auto;
    z-index: 100;
  }

  .dropdown-menu.open-up {
    bottom: calc(100% + 0.25rem) !important;
    top: auto !important;
    transform: none !important;
  }
</style>
