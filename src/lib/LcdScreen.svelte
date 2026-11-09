<script lang="ts">
  // --- Imports ---
  import { onMount } from "svelte";
  import type { RoutePreset, LcdSlide, LayerSlot } from "./preset";
  import {
    lcdChannel,
    requestLcdSync,
    type LcdSyncMessage,
  } from "./lcdChannel";

  // --- Props ---
  let {
    slide,
    layerSlots = {},
    imageUrls = {},
    activeLayerIndices = {},
    standalone = false,
  }: {
    slide?: LcdSlide;
    layerSlots?: Record<string, LayerSlot>;
    imageUrls?: Record<string, string>;
    activeLayerIndices?: Record<string, number | "+1" | null>;
    standalone?: boolean;
  } = $props();

  // --- State & Derived ---
  let syncedPreset = $state<RoutePreset | null>(null);
  let syncedGroupNo = $state<string>("1");
  let syncedSlideIdx = $state<number>(0);
  let syncedLayerIndices = $state<Record<string, number | "+1" | null>>({});
  let syncedImageBlobs = $state<Record<string, Uint8Array>>({});
  let syncedImageUrls = $state<Record<string, string>>({});

  let effectiveSlide = $derived<LcdSlide | undefined>(
    standalone
      ? syncedPreset?.lcdGroups?.[syncedGroupNo]?.slides?.[syncedSlideIdx]
      : slide,
  );

  let effectiveLayerSlots = $derived<Record<string, LayerSlot>>(
    standalone ? (syncedPreset?.layerSlots ?? {}) : layerSlots,
  );

  let effectiveImageUrls = $derived<Record<string, string>>(
    standalone ? syncedImageUrls : imageUrls,
  );

  let effectiveLayerIndices = $derived<Record<string, number | "+1" | null>>(
    standalone ? syncedLayerIndices : activeLayerIndices,
  );

  let baseImageUrl = $derived(
    effectiveSlide?.baseImageId
      ? (effectiveImageUrls[effectiveSlide.baseImageId] ?? "")
      : "",
  );

  let resolvedLayerUrls = $derived(
    (effectiveSlide?.visibleLayers ?? [])
      .map((slotKey) => {
        const slot = effectiveLayerSlots[slotKey];
        if (!slot) return null;

        const itemIdx =
          effectiveSlide?.layerOverrides?.[slotKey] ??
          effectiveLayerIndices[slotKey];
        if (itemIdx === null || itemIdx === undefined || itemIdx === "+1") {
          return null;
        }

        const hashId = slot.items[String(itemIdx)];
        return hashId ? (effectiveImageUrls[hashId] ?? null) : null;
      })
      .filter((url): url is string => Boolean(url)),
  );

  // --- Handlers & Methods ---

  /**
   * 受信した画像バイナリとプリセット情報から描画用のObject URLを再構築する
   */
  function rebuildSyncedImageUrls(): void {
    if (!syncedPreset) return;
    for (const url of Object.values(syncedImageUrls)) {
      URL.revokeObjectURL(url);
    }
    const nextUrls: Record<string, string> = {};
    for (const [hashId, asset] of Object.entries(syncedPreset.images ?? {})) {
      const bytes = syncedImageBlobs[asset.fileName];
      if (bytes) {
        const blob = new Blob([bytes as BlobPart], { type: "image/avif" });
        nextUrls[hashId] = URL.createObjectURL(blob);
      }
    }
    syncedImageUrls = nextUrls;
  }

  // --- Lifecycle & Effects ---

  onMount(() => {
    if (!standalone) return;

    const handleMessage = (event: MessageEvent<LcdSyncMessage>) => {
      const data = event.data;
      if (data.type === "sync-state") {
        syncedPreset = data.preset;
        syncedGroupNo = data.groupNo;
        syncedSlideIdx = data.slideIdx;
        syncedLayerIndices = data.layerIndices;
        rebuildSyncedImageUrls();
      } else if (data.type === "sync-assets") {
        syncedImageBlobs = data.imageBlobs;
        rebuildSyncedImageUrls();
      }
    };

    lcdChannel.addEventListener("message", handleMessage);
    requestLcdSync();

    return () => {
      lcdChannel.removeEventListener("message", handleMessage);
      for (const url of Object.values(syncedImageUrls)) {
        URL.revokeObjectURL(url);
      }
    };
  });
</script>

<!-- 車内LCD 16:9 レイヤー合成スクリーン -->
<div class="lcd-container" class:standalone>
  {#if baseImageUrl}
    <img src={baseImageUrl} alt="LCD Base" class="lcd-layer" />
  {/if}
  {#each resolvedLayerUrls as url}
    <img src={url} alt="LCD Overlay" class="lcd-layer" />
  {/each}
  {#if standalone && !baseImageUrl && resolvedLayerUrls.length === 0}
    <div class="lcd-waiting">
      <h5>Machirun LCD 待機中...</h5>
      <p class="small-text">
        車載器またはプリセットエディタで画像を設定・選択してください
      </p>
    </div>
  {/if}
</div>

<style>
  .lcd-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background-color: #000000;
    overflow: hidden;
    user-select: none;
  }

  .lcd-container.standalone {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    max-width: calc(100vh * 16 / 9);
    max-height: calc(100vw * 9 / 16);
    margin: auto;
    z-index: 9999;
  }

  .lcd-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .lcd-waiting {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    opacity: 0.7;
  }
</style>
