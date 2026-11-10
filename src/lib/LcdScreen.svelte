<script lang="ts">
  // --- Imports ---
  import type { LcdSlide, LayerSlot } from "./preset";

  // --- Props ---
  let {
    slide,
    layerSlots = {},
    imageUrls = {},
    activeLayerIndices = {},
  }: {
    slide?: LcdSlide;
    layerSlots?: Record<string, LayerSlot>;
    imageUrls?: Record<string, string>;
    activeLayerIndices?: Record<string, number | "+1" | null>;
  } = $props();

  // --- State & Derived ---
  let baseImageUrl = $derived(
    slide?.baseImageId ? (imageUrls[slide.baseImageId] ?? "") : "",
  );

  let resolvedLayerUrls = $derived(
    (slide?.visibleLayers ?? [])
      .map((slotKey) => {
        const slot = layerSlots[slotKey];
        if (!slot) return null;

        const itemIdx =
          slide?.layerOverrides?.[slotKey] ?? activeLayerIndices[slotKey];
        if (itemIdx === null || itemIdx === undefined || itemIdx === "+1") {
          return null;
        }

        const hashId = slot.items[String(itemIdx)];
        return hashId ? (imageUrls[hashId] ?? null) : null;
      })
      .filter((url): url is string => Boolean(url)),
  );
</script>

<!-- 車内LCD 16:9 レイヤー合成スクリーン -->
<div class="lcd-container">
  {#if baseImageUrl}
    <img src={baseImageUrl} alt="LCD Base" class="lcd-layer" />
  {/if}
  {#each resolvedLayerUrls as url}
    <img src={url} alt="LCD Overlay" class="lcd-layer" />
  {/each}
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

  .lcd-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
</style>
