<script lang="ts">
  // --- Imports ---
  import type { RoutePreset, LcdSlide } from "./preset";
  import { extractMasterStops } from "./timetable";
  import {
    processImageToAvif,
    processAudioToOpus,
    exportArchiveMchrn,
    importArchiveZip,
  } from "./archive";
  import LcdScreen from "./LcdScreen.svelte";
  import FileButton from "./FileButton.svelte";

  // --- State & Derived ---
  let activeTab = $state<"base" | "layers" | "lcd" | "actions">("base");

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

  let isRegisteringImage = $state(false);
  let isRegisteringAudio = $state(false);

  let previewGroupNo = $state("1");
  let previewSlideIdx = $state(0);
  let previewLayerIndices = $state<Record<string, number>>({
    stop: 1,
    fare: 1,
  });

  let currentPreviewSlide = $derived<LcdSlide | undefined>(
    preset.lcdGroups[previewGroupNo]?.slides[previewSlideIdx],
  );

  // --- Handlers & Methods ---

  /**
   * 選択されたダイヤグラムCSVファイルをテキストとして読み込む
   * @param files 選択されたFileList
   */
  async function handleCsvUpload(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    timetableCsv = await file.text();
  }

  /**
   * 選択された画像ファイルをAVIFへ一括変換し、プリセットに登録する
   * @param files 選択されたFileList
   */
  async function handleImageUpload(files: FileList): Promise<void> {
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

  /**
   * 選択された音声ファイルをOpusへ一括変換し、プリセットに登録する
   * @param files 選択されたFileList
   */
  async function handleAudioUpload(files: FileList): Promise<void> {
    const fileList = Array.from(files);
    isRegisteringAudio = true;
    try {
      for (const file of fileList) {
        try {
          const res = await processAudioToOpus(file);
          preset.audios[res.hashId] = res.asset;
          audioBlobs[res.asset.fileName] = res.binary;
          audioUrls[res.hashId] = res.objectUrl;
        } catch (err) {
          console.error(`音声変換エラー (${file.name}):`, err);
        }
      }
    } finally {
      isRegisteringAudio = false;
    }
  }

  /**
   * 現在編集中のプリセット一式を .mchrn アーカイブとしてダウンロード保存する
   */
  function handleExport(): void {
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

  /**
   * 既存の .mchrn / .zip アーカイブファイルを読み込み、エディタの状態を復元する
   * @param files 選択されたFileList
   */
  async function handleImport(files: FileList): Promise<void> {
    const file = files[0];
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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_missing_attribute -->
<!-- svelte-ignore a11y_label_has_associated_control -->
<section class="top-margin">
  <div class="space"></div>

  <!-- 上部バー：タイトルとアーカイブ入出力 -->
  <nav class="top-nav">
    <h5 class="max">プリセットエディタ（試験用・未実装です）</h5>
    <FileButton
      label="読み込み"
      icon="folder_open"
      accept=".mchrn,.zip"
      onselect={handleImport}
    />
    <button class="primary" onclick={handleExport}>
      <i>save</i>
      <span>保存 (.mchrn)</span>
    </button>
  </nav>

  <div class="grid">
    <!-- 左カラム：編集タブ -->
    <div class="s12 m7">
      <div class="tabs left-align">
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

      <!-- タブ1: 基本情報・CSV・画像・音声登録 -->
      {#if activeTab === "base"}
        <article class="border">
          <div class="field label border">
            <input type="text" bind:value={preset.meta.name} />
            <label>プリセット名（路線・方向名）</label>
          </div>

          <h6>ダイヤグラム (timetable.csv)</h6>
          <FileButton
            label="CSVを選択"
            icon="upload_file"
            accept=".csv"
            onselect={handleCsvUpload}
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
          <FileButton
            label={isRegisteringImage ? "変換中..." : "画像を追加 (複数可)"}
            icon="image"
            accept="image/*"
            multiple={true}
            disabled={isRegisteringImage}
            onselect={handleImageUpload}
          />
          <ul>
            {#each Object.entries(preset.images) as [, asset]}
              <li>
                <code>{asset.fileName}</code> ← {asset.originalName}
              </li>
            {/each}
          </ul>

          <div class="space"></div>
          <h6>音声アセット登録</h6>
          <FileButton
            label={isRegisteringAudio ? "変換中..." : "音声を追加 (複数可)"}
            icon="audio_file"
            accept="audio/*"
            multiple={true}
            disabled={isRegisteringAudio}
            onselect={handleAudioUpload}
          />
          <ul>
            {#each Object.entries(preset.audios) as [, asset]}
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
              <i>add</i>
              <span>番号を追加</span>
            </button>

            {#each Object.entries(slot.items) as [no]}
              <div class="row">
                <span>#{no}</span>
                {#if slot.linkedToCsvStop && masterStops[Number(no) - 1]}
                  <span class="chip small">{masterStops[Number(no) - 1]}</span>
                {/if}
                <select class="max" bind:value={slot.items[no]}>
                  <option value="">-- 画像を選択 --</option>
                  {#each Object.entries(preset.images) as [imgId, asset]}
                    <option value={imgId}>
                      {asset.originalName} ({imgId.slice(0, 6)})
                    </option>
                  {/each}
                </select>
              </div>
            {/each}
            <div class="space"></div>
          {/each}
        </article>
      {/if}

      <!-- タブ3: LCDグループのベース画像・表示レイヤー設定 -->
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
