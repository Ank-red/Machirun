<script lang="ts" generics="T">
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

  let containerEl: HTMLDivElement;
  let openUpward = $state(false);

  let selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? String(value ?? ""),
  );

  function updateDirection(): void {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // 下側の余白が260px未満かつ上側に余裕がある場合は上方向に開く
    openUpward = spaceBelow < 260 && rect.top > spaceBelow;
  }

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
      {#each options as opt}
        <span class="dropdown-ghost" aria-hidden="true">{opt.label}</span>
      {/each}
    </span>
    <i>arrow_drop_down</i>
  </button>
  <menu class="dropdown-menu" class:open-up={openUpward}>
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
    position: relative;
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
    visibility: hidden;
    height: 0;
    pointer-events: none;
    user-select: none;
  }

  .dropdown-menu {
    max-height: 16rem;
    overflow-y: auto;
    z-index: 100;
  }

  .dropdown-menu.open-up {
    top: auto !important;
    bottom: calc(100% + 0.25rem) !important;
    transform: none !important;
  }
</style>
