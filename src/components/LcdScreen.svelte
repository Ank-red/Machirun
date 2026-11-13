<script lang="ts">
  // --- Imports ---

  import type { LayerOperationValue, LayerSlot, LcdSlide } from "../core/types";

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
    activeLayerIndices?: Record<string, LayerOperationValue>;
  } = $props();

  // --- Derived ---

  /** ベース画像のObject URL */
  let baseImageUrl = $derived(
    slide?.baseImageId ? (imageUrls[slide.baseImageId] ?? "") : "",
  );

  /** 表示順序に従って解決されたオーバーレイレイヤー画像のObject URL配列 */
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
  {#each resolvedLayerUrls as url, idx (`${idx}-${url}`)}
    <img src={url} alt="LCD Overlay" class="lcd-layer" />
  {/each}
</div>

<style>
  .lcd-container {
    aspect-ratio: 16 / 9;
    background-color: #000;
    overflow: hidden;
    position: relative;
    user-select: none;
    width: 100%;
  }

  .lcd-layer {
    height: 100%;
    left: 0;
    object-fit: contain;
    pointer-events: none;
    position: absolute;
    top: 0;
    width: 100%;
  }
</style>
