<script lang="ts" generics="T">
  // --- Props ---
  let {
    value = $bindable(),
    options,
    onchange,
  }: {
    value: T;
    options: { value: T; label: string }[];
    onchange?: (val: T) => void;
  } = $props();

  // --- State & Derived ---
  let selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? String(value),
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
<div>
  <button class="border">
    <span>{selectedLabel}</span>
    <i>arrow_drop_down</i>
  </button>
  <menu>
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
