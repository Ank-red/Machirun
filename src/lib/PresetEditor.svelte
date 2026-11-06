<script lang="ts">
  import type { RoutePreset, LcdSlide } from "./preset";
  import { extractMasterStops } from "./timetable";
  import {
    processImageToAvif,
    exportArchiveMchrn,
    importArchiveZip,
    processAudioToOpus,
  } from "./archive";
  import LcdScreen from "./LcdScreen.svelte";

  let activeTab = $state<"base" | "layers" | "lcd" | "actions">("base");

  // エディタで編集中の状態
  let preset = $state<RoutePreset>({
    meta: { name: "新規プリセット" },
    images: {},
    layerSlots: {
      stop: { name: "停留所名レイヤー", linkedToCsvStop: true, items: {} },
      fare: { name: "運賃表レイヤー", items: {} },
    },
    audios: {},
    lcdGroups: {
      "1": {
        name: "通常走行ループ",
        loop: true,
        slides: [
          { baseImageId: "", durationSec: 8, visibleLayers: ["stop", "fare"] },
        ],
      },
    },
    actions: [],
  });

  let timetableCsv = $state("");
  let masterStops = $derived(
    timetableCsv ? extractMasterStops(timetableCsv) : [],
  );

  let imageBlobs = $state<Record<string, Uint8Array>>({});
  let imageUrls = $state<Record<string, string>>({});
  let audioBlobs = $state<Record<string, Uint8Array>>({});
  let audioUrls = $state<Record<string, string>>({});

  // プレビュー確認用のテスト状態
  let previewGroupNo = $state("1");
  let previewSlideIdx = $state(0);
  let previewLayerIndices = $state<Record<string, number>>({
    stop: 1,
    fare: 1,
  });

  let currentPreviewSlide = $derived<LcdSlide | undefined>(
    preset.lcdGroups[previewGroupNo]?.slides[previewSlideIdx],
  );

  // CSVファイルの読み込み
  async function handleCsvUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    timetableCsv = await file.text();
  }

  // 画像アップロード処理
  let isRegisteringImage = $state(false);
  async function handleImageUpload(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    isRegisteringImage = true;
    try {
      for (const file of fileList) {
        try {
          const res = await processImageToAvif(file);
          preset.images[res.hashId] = res.asset;
          imageBlobs[res.asset.fileName] = res.binary;
          imageUrls[res.hashId] = res.objectUrl;
        } catch (err) {
          console.error(`画像変換エラー (${file.name}):`, err);
        }
      }
    } finally {
      isRegisteringImage = false;
    }
  }

  // 音声アップロード処理
  let isRegisteringAudio = $state(false);
  async function handleAudioUpload(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    isRegisteringAudio = true;
    try {
      for (const file of fileList) {
        try {
          const res = await processAudioToOpus(file);
          preset.images[res.hashId] = res.asset;
          imageBlobs[res.asset.fileName] = res.binary;
          imageUrls[res.hashId] = res.objectUrl;
        } catch (err) {
          console.error(`音声変換エラー (${file.name}):`, err);
        }
      }
    } finally {
      isRegisteringAudio = false;
    }
  }

  // ZIPエクスポート
  function handleExport() {
    const blob = exportArchiveMchrn({
      preset,
      timetableCsv,
      imageBlobs,
      imageUrls,
      audioBlobs,
      audioUrls,
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${preset.meta.name || "preset"}.mchrn`;
    a.click();
  }

  // ZIPインポート
  async function handleImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const loaded = await importArchiveZip(file);
    preset = loaded.preset;
    timetableCsv = loaded.timetableCsv;
    imageBlobs = loaded.imageBlobs;
    imageUrls = loaded.imageUrls;
    audioBlobs = loaded.audioBlobs;
    audioUrls = loaded.audioUrls;
  }
</script>

<section class="top-margin">
  <div class="space"></div>
  <!-- 上部バー：プリセット名とZIP入出力 -->
  <nav class="top-nav">
    <h5 class="max">プリセットエディタ（試験用・未実装です）</h5>
    <button
      class="border"
      onclick={() => document.getElementById("zip-in")?.click()}
    >
      <i>folder_open</i><span>読み込み</span>
    </button>
    <input
      id="zip-in"
      type="file"
      accept=".mchrn,.zip"
      class="hidden"
      onchange={handleImport}
    />

    <button class="primary" onclick={handleExport}>
      <i>save</i><span>保存 (.mchrn)</span>
    </button>
  </nav>

  <div class="grid">
    <!-- 左カラム：編集タブ -->
    <div class="s12 m7">
      <div class="tabs left-align">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_missing_attribute -->
        <a
          class:active={activeTab === "base"}
          onclick={() => (activeTab = "base")}>1. 基本・素材</a
        >
        <a
          class:active={activeTab === "layers"}
          onclick={() => (activeTab = "layers")}>2. レイヤー</a
        >
        <a
          class:active={activeTab === "lcd"}
          onclick={() => (activeTab = "lcd")}>3. LCDグループ</a
        >
        <a
          class:active={activeTab === "actions"}
          onclick={() => (activeTab = "actions")}>4. アクション</a
        >
      </div>

      <!-- タブ1: 基本情報・CSV・画像登録 -->
      {#if activeTab === "base"}
        <article class="border">
          <div class="field label border">
            <input type="text" bind:value={preset.meta.name} />
            <label>プリセット名（路線・方向名）</label>
          </div>

          <h6>ダイヤグラム (timetable.csv)</h6>
          <button
            class="border"
            onclick={() => document.getElementById("csv-in")?.click()}
          >
            <i>upload_file</i><span>CSVを選択</span>
          </button>
          <input
            id="csv-in"
            type="file"
            accept=".csv"
            class="hidden"
            onchange={handleCsvUpload}
          />

          {#if masterStops.length > 0}
            <p>
              検出された停留所 ({masterStops.length}件): {masterStops.join(
                " → ",
              )}
            </p>
          {/if}

          <div class="space"></div>
          <h6>画像アセット登録</h6>
          <button
            class="border"
            disabled={isRegisteringImage}
            onclick={() => document.getElementById("img-in")?.click()}
          >
            <i>image</i><span
              >{isRegisteringImage ? "変換中..." : "画像を追加 (複数可)"}</span
            >
          </button>
          <input
            id="img-in"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            onchange={handleImageUpload}
          />

          <div class="space"></div>
          <h6>音声アセット登録</h6>
          <button
            class="border"
            disabled={isRegisteringAudio}
            onclick={() => document.getElementById("audio-in")?.click()}
          >
            <i>image</i><span
              >{isRegisteringAudio ? "変換中..." : "音声を追加 (複数可)"}</span
            >
          </button>
          <input
            id="audio-in"
            type="file"
            accept="audio/*"
            multiple
            class="hidden"
            onchange={handleAudioUpload}
          />

          <ul>
            {#each Object.entries(preset.audios) as [hashId, asset]}
              <li>
                <code>{asset.fileName}</code> ← {asset.originalName}
              </li>
            {/each}
          </ul>
        </article>
      {/if}

      <!-- タブ2: レイヤースロット設定 -->
      {#if activeTab === "layers"}
        <article class="border">
          {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
            <h6>{slot.name} (キー: <code>{slotKey}</code>)</h6>
            <button
              class="small border"
              onclick={() => {
                const nextNo = Object.keys(slot.items).length + 1;
                slot.items[String(nextNo)] = "";
              }}
            >
              <i>add</i><span>番号を追加</span>
            </button>

            {#each Object.entries(slot.items) as [no, hashId]}
              <div class="row">
                <span>#{no}</span>
                {#if slot.linkedToCsvStop && masterStops[Number(no) - 1]}
                  <span class="chip small">{masterStops[Number(no) - 1]}</span>
                {/if}
                <select class="max" bind:value={slot.items[no]}>
                  <option value="">-- 画像を選択 --</option>
                  {#each Object.entries(preset.images) as [imgId, asset]}
                    <option value={imgId}
                      >{asset.originalName} ({imgId.slice(0, 6)})</option
                    >
                  {/each}
                </select>
              </div>
            {/each}
            <div class="space"></div>
          {/each}
        </article>
      {/if}

      <!-- タブ3: LCDグループのベース画像・表示レイヤー確認 -->
      {#if activeTab === "lcd"}
        <article class="border">
          <h6>グループ #1 の1枚目スライド設定（テスト用）</h6>
          {#if preset.lcdGroups["1"]?.slides[0]}
            {@const slide0 = preset.lcdGroups["1"].slides[0]}
            <div class="field label suffix border">
              <select bind:value={slide0.baseImageId}>
                <option value="">-- ベース画像を選択 --</option>
                {#each Object.entries(preset.images) as [imgId, asset]}
                  <option value={imgId}>{asset.originalName}</option>
                {/each}
              </select>
              <label>ベース画像</label>
              <i>arrow_drop_down</i>
            </div>

            <p>重ねるレイヤー:</p>
            {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
              <label class="checkbox">
                <input
                  type="checkbox"
                  checked={slide0.visibleLayers.includes(slotKey)}
                  onchange={(e) => {
                    if (e.currentTarget.checked) {
                      slide0.visibleLayers = [...slide0.visibleLayers, slotKey];
                    } else {
                      slide0.visibleLayers = slide0.visibleLayers.filter(
                        (k) => k !== slotKey,
                      );
                    }
                  }}
                />
                <span>{slot.name} ({slotKey})</span>
              </label>
            {/each}
          {/if}
        </article>
      {/if}
    </div>

    <!-- 右カラム：常時表示のLCDリアルタイムプレビュー -->
    <div class="s12 m5">
      <article class="border">
        <h6>LCDリアルタイムプレビュー</h6>
        <LcdScreen
          slide={currentPreviewSlide}
          layerSlots={preset.layerSlots}
          {imageUrls}
          activeLayerIndices={previewLayerIndices}
        />

        <div class="space"></div>
        <p>プレビュー用レイヤー番号切り替え:</p>
        {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
          <div class="field label border small">
            <input
              type="number"
              min="1"
              bind:value={previewLayerIndices[slotKey]}
            />
            <label>{slot.name} 番号</label>
          </div>
        {/each}
      </article>
    </div>
  </div>
</section>

<style>
  .hidden {
    display: none;
  }
</style>
