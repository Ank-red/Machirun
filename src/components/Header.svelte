<script lang="ts">
  // --- Imports ---

  import type { Snippet } from "svelte";

  // --- Props ---

  let {
    title = "Machirun",
    children,
  }: {
    title?: string;
    children?: Snippet;
  } = $props();
</script>

<!-- 共通アプリケーションヘッダー -->
<header class="responsive top-margin" data-tauri-drag-region>
  <nav class="toolbar padding" data-tauri-drag-region>
    <span class="large-text bold left-margin title-switch">
      <span>{title}</span>
    </span>

    {#if children}
      {@render children()}
    {/if}
  </nav>
</header>

<style>
  .title-switch {
    align-items: center;
    cursor: pointer;
    display: inline-flex;
    gap: 0.4rem;
    user-select: none;
  }

  .title-switch:hover {
    opacity: 0.8;
  }
</style>
