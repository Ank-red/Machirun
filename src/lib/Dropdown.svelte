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
  let selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? String(value ?? ""),
  );

  // --- Handlers & Methods ---
  /**
   * ドロップダウン項目を選択し、メニューのフォーカスを解除して閉じる
   * @param val 選択された項目の値
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
<div class="dropdown-container" class:full-width={full}>
  {#if label}
    <span class="dropdown-label">{label}</span>
  {/if}
  <button type="button" class="border dropdown-button">
    <span class="dropdown-text">{selectedLabel}</span>
    <i>arrow_drop_down</i>
  </button>
  <menu class="dropdown-menu">
    {#each options as opt}
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
    min-width: 0;
    max-width: 100%;
  }

  .dropdown-container.full-width {
    display: flex;
    width: 100%;
    flex: 1 1 0%;
  }

  .dropdown-label {
    font-size: 0.75rem;
    opacity: 0.85;
    margin-bottom: 0.2rem;
    padding-left: 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    margin: 0;
  }

  .dropdown-text {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dropdown-menu {
    max-height: 16rem;
    overflow-y: auto;
    z-index: 100;
  }
</style>
