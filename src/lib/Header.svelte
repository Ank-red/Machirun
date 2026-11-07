<script lang="ts">
  // --- Imports ---
  import type { Snippet } from "svelte";

  // --- Props ---
  let {
    title = "Machirun 車載器",
    children,
  }: {
    title?: string;
    children?: Snippet;
  } = $props();
</script>

<!-- 共通アプリケーションヘッダー -->
<header class="responsive top-margin" data-tauri-drag-region>
  <nav class="toolbar padding" data-tauri-drag-region>
    <span class="large-text bold left-margin">{title}</span>
    <div class="max" data-tauri-drag-region></div>

    {#if children}
      {@render children()}
    {/if}
  </nav>
</header>
