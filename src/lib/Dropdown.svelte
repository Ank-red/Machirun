<script lang="ts" generics="T">
  let {
    value = $bindable(),
    options,
    onchange,
  }: {
    value: T;
    options: { value: T; label: string }[];
    onchange?: (val: T) => void;
  } = $props();

  // 現在選択されている項目の表示名を取得
  let selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? String(value),
  );

  function selectItem(val: T) {
    value = val;
    onchange?.(val);
    // 選択後にフォーカスを外してBeerCSSのメニューを閉じる
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }
</script>

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
