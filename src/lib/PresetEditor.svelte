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
  import Dropdown from "./Dropdown.svelte";

  // --- State & Derived ---
  let activeTab = $state<"base" | "layers" | "lcd" | "actions">("base");
  let newSlotKey = $state("");
  let newSlotName = $state("");
  let isLoopPreviewing = $state(false);

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
    stop: 0,
    fare: 0,
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
   * 新しいレイヤースロットを追加する
   */
  function addLayerSlot(): void {
    const key = newSlotKey.trim();
    const name = newSlotName.trim();
    if (!key || !name || preset.layerSlots[key]) return;

    preset.layerSlots[key] = {
      name,
      linkedToCsvStop: false,
      items: {},
    };
    previewLayerIndices[key] = 0;
    newSlotKey = "";
    newSlotName = "";
  }

  /**
   * 指定したレイヤースロットを削除する
   * @param slotKey 削除するスロットのキー
   */
  function removeLayerSlot(slotKey: string): void {
    delete preset.layerSlots[slotKey];
    delete previewLayerIndices[slotKey];
    for (const group of Object.values(preset.lcdGroups)) {
      for (const slide of group.slides) {
        slide.visibleLayers = slide.visibleLayers.filter((k) => k !== slotKey);
      }
    }
  }

  /**
   * CSVのマスター停留所数に合わせてレイヤー番号枠を一括生成する
   * @param slotKey 対象スロットのキー
   */
  function syncSlotItemsWithCsv(slotKey: string): void {
    const slot = preset.layerSlots[slotKey];
    if (!slot || masterStops.length === 0) return;

    for (let i = 0; i < masterStops.length; i++) {
      const no = String(i);
      if (!(no in slot.items)) {
        slot.items[no] = "";
      }
    }
  }

  /**
   * 新しいLCDグループを追加し、プレビュー対象をそのグループに切り替える
   */
  function addLcdGroup(): void {
    const existingNos = Object.keys(preset.lcdGroups)
      .map(Number)
      .filter((n) => !isNaN(n));
    const nextNo = String(
      (existingNos.length > 0 ? Math.max(...existingNos) : 0) + 1,
    );
    preset.lcdGroups[nextNo] = {
      name: `グループ #${nextNo}`,
      loop: true,
      slides: [{ baseImageId: "", durationSec: 8, visibleLayers: [] }],
    };
    previewGroupNo = nextNo;
    previewSlideIdx = 0;
  }

  /**
   * 指定したLCDグループを削除する
   * @param groupNo 削除対象のグループ番号
   */
  function removeLcdGroup(groupNo: string): void {
    delete preset.lcdGroups[groupNo];
    const remainingKeys = Object.keys(preset.lcdGroups);
    previewGroupNo = remainingKeys[0] ?? "";
    previewSlideIdx = 0;
  }

  /**
   * 選択中のLCDグループに新しいスライドを追加する
   * @param groupNo 対象グループ番号
   */
  function addSlide(groupNo: string): void {
    const group = preset.lcdGroups[groupNo];
    if (!group) return;
    group.slides.push({
      baseImageId: "",
      durationSec: 6,
      visibleLayers: [],
    });
    previewSlideIdx = group.slides.length - 1;
  }

  /**
   * 指定したスライドを削除する
   * @param groupNo 対象グループ番号
   * @param slideIdx 削除するスライドのインデックス
   */
  function removeSlide(groupNo: string, slideIdx: number): void {
    const group = preset.lcdGroups[groupNo];
    if (!group || group.slides.length <= 1) return;
    group.slides.splice(slideIdx, 1);
    if (previewSlideIdx >= group.slides.length) {
      previewSlideIdx = Math.max(0, group.slides.length - 1);
    }
  }

  /**
   * スライド内の特定レイヤーの表示・非表示を切り替える
   * @param slide 対象スライド
   * @param slotKey レイヤースロットのキー
   * @param checked 表示する場合はtrue
   */
  function toggleSlideLayer(
    slide: LcdSlide,
    slotKey: string,
    checked: boolean,
  ): void {
    if (checked) {
      if (!slide.visibleLayers.includes(slotKey)) {
        slide.visibleLayers = [...slide.visibleLayers, slotKey];
      }
    } else {
      slide.visibleLayers = slide.visibleLayers.filter((k) => k !== slotKey);
    }
  }

  /**
   * スライド個別のレイヤー番号上書き（layerOverrides）を設定・解除する
   * @param slide 対象スライド
   * @param slotKey レイヤースロットのキー
   * @param rawValue 入力された番号文字列（空文字の場合は上書き解除）
   */
  function setSlideLayerOverride(
    slide: LcdSlide,
    slotKey: string,
    rawValue: string,
  ): void {
    if (!rawValue) {
      if (slide.layerOverrides) {
        delete slide.layerOverrides[slotKey];
      }
      return;
    }
    if (!slide.layerOverrides) {
      slide.layerOverrides = {};
    }
    slide.layerOverrides[slotKey] = Number(rawValue);
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

  // --- Lifecycle & Effects ---

  $effect(() => {
    if (!isLoopPreviewing) return;
    const group = preset.lcdGroups[previewGroupNo];
    if (!group || group.slides.length <= 1) return;

    const currentSlide = group.slides[previewSlideIdx];
    const durationMs = Math.max(1, currentSlide?.durationSec ?? 5) * 1000;

    const timer = setTimeout(() => {
      const nextIdx = previewSlideIdx + 1;
      if (nextIdx < group.slides.length) {
        previewSlideIdx = nextIdx;
      } else if (group.loop) {
        previewSlideIdx = 0;
      } else {
        isLoopPreviewing = false;
      }
    }, durationMs);

    return () => clearTimeout(timer);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_missing_attribute -->
<!-- svelte-ignore a11y_label_has_associated_control -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
        <!-- 各レイヤースロットの編集 -->
        {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
          <article class="border top-margin">
            <div class="row">
              <h6 class="max">
                {slot.name} <small>(ID: <code>{slotKey}</code>)</small>
              </h6>
              <label class="checkbox">
                <input type="checkbox" bind:checked={slot.linkedToCsvStop} />
                <span>CSV停留所と連動</span>
              </label>
              <button
                class="small transparent circle"
                onclick={() => removeLayerSlot(slotKey)}
              >
                <i>delete</i>
              </button>
            </div>

            <div class="row">
              <button
                class="small border"
                onclick={() => {
                  const nums = Object.keys(slot.items)
                    .map(Number)
                    .filter((n) => !isNaN(n));
                  const nextNo = nums.length > 0 ? Math.max(...nums) + 1 : 0;
                  slot.items[String(nextNo)] = "";
                }}
              >
                <i>add</i>
                <span>番号を追加</span>
              </button>
              {#if slot.linkedToCsvStop && masterStops.length > 0}
                <button
                  class="small border"
                  onclick={() => syncSlotItemsWithCsv(slotKey)}
                >
                  <i>sync</i>
                  <span>CSV停留所数 ({masterStops.length}件) の枠を作成</span>
                </button>
              {/if}
            </div>

            <div class="space"></div>

            {#each Object.entries(slot.items) as [no]}
              <div class="row">
                <span class="bold">#{no}</span>
                {#if slot.linkedToCsvStop && masterStops[Number(no)]}
                  <span class="chip small">{masterStops[Number(no)]}</span>
                {/if}
                <div class="field border max no-margin">
                  <Dropdown
                    bind:value={slot.items[no]}
                    options={[
                      { value: "", label: "-- 画像を選択 --" },
                      ...Object.entries(preset.images).map((img) => ({
                        value: img[0],
                        label: `${img[1].originalName} (${img[0].slice(0, 6)})`,
                      })),
                    ]}
                  />
                  <i>arrow_drop_down</i>
                </div>
                <button
                  class="small transparent circle"
                  onclick={() => delete slot.items[no]}
                >
                  <i>close</i>
                </button>
              </div>
            {/each}
          </article>
        {/each}
        <!-- 新規スロット追加フォーム -->
        <article class="border">
          <h6>新規レイヤースロットの追加</h6>
          <div>
            <div class="field label border max">
              <input type="text" bind:value={newSlotKey} />
              <label>スロットID (英数字)</label>
            </div>
            <div class="field label border max">
              <input type="text" bind:value={newSlotName} />
              <label>表示名</label>
            </div>
            <div class="space"></div>
            <button class="primary" onclick={addLayerSlot}>
              <i>add</i>
              <span>スロット追加</span>
            </button>
          </div>
        </article>
      {/if}

      <!-- タブ3: LCDグループのベース画像・表示レイヤー設定 -->
      {#if activeTab === "lcd"}
        <article class="border">
          <div class="row">
            <div class="field label suffix border max no-margin">
              <select
                bind:value={previewGroupNo}
                onchange={() => (previewSlideIdx = 0)}
              >
                {#each Object.entries(preset.lcdGroups) as [gNo, grp]}
                  <option value={gNo}>#{gNo}: {grp.name}</option>
                {/each}
              </select>
              <label>編集するLCDグループ</label>
              <i>arrow_drop_down</i>
            </div>

            <button class="primary" onclick={addLcdGroup}>
              <i>add</i>
              <span>新規グループ</span>
            </button>

            {#if Object.keys(preset.lcdGroups).length > 1}
              <button
                class="border error-text"
                onclick={() => removeLcdGroup(previewGroupNo)}
              >
                <i>delete</i>
              </button>
            {/if}
          </div>

          {#if preset.lcdGroups[previewGroupNo]}
            {@const currentGroup = preset.lcdGroups[previewGroupNo]}
            <div class="space"></div>
            <div>
              <div class="field label border max no-margin">
                <input type="text" bind:value={currentGroup.name} />
                <label>グループ名</label>
              </div>
              <div class="space"></div>
              <label class="checkbox">
                <input type="checkbox" bind:checked={currentGroup.loop} />
                <span>スライドをループ再生する</span>
              </label>
              <button class="border" onclick={() => addSlide(previewGroupNo)}>
                <i>add_photo_alternate</i>
                <span>スライド追加</span>
              </button>
            </div>
          {/if}
        </article>

        <!-- 選択中グループ内のスライド一覧 -->
        {#if preset.lcdGroups[previewGroupNo]}
          {@const currentGroup = preset.lcdGroups[previewGroupNo]}
          {#each currentGroup.slides as slide, sIdx}
            <article
              class="border top-margin"
              class:fill={previewSlideIdx === sIdx}
              onclick={() => (previewSlideIdx = sIdx)}
            >
              <div class="row">
                <h6 class="max">
                  スライド #{sIdx + 1}
                  {#if previewSlideIdx === sIdx}
                    <span class="chip small primary">プレビュー中</span>
                  {/if}
                </h6>
                <div class="field label border small no-margin">
                  <input type="number" min="1" bind:value={slide.durationSec} />
                  <label>表示秒数</label>
                </div>
                {#if currentGroup.slides.length > 1}
                  <button
                    class="small transparent circle"
                    onclick={(e) => {
                      e.stopPropagation();
                      removeSlide(previewGroupNo, sIdx);
                    }}
                  >
                    <i>delete</i>
                  </button>
                {/if}
              </div>

              <div class="field label suffix border">
                <select bind:value={slide.baseImageId}>
                  <option value="">-- ベース画像を選択 --</option>
                  {#each Object.entries(preset.images) as [imgId, asset]}
                    <option value={imgId}>
                      {asset.originalName} ({imgId.slice(0, 6)})
                    </option>
                  {/each}
                </select>
                <label>ベース画像</label>
                <i>arrow_drop_down</i>
              </div>

              <p class="bold">重ねるレイヤー（チェック順＝下から重ねる順）:</p>
              {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
                {@const isVisible = slide.visibleLayers.includes(slotKey)}
                <div class="row">
                  <label class="checkbox max">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onchange={(e) =>
                        toggleSlideLayer(
                          slide,
                          slotKey,
                          e.currentTarget.checked,
                        )}
                    />
                    <span>{slot.name} (<code>{slotKey}</code>)</span>
                  </label>

                  {#if isVisible}
                    <div class="field label border small no-margin">
                      <input
                        type="number"
                        min="0"
                        placeholder="連動"
                        value={slide.layerOverrides?.[slotKey] ?? ""}
                        oninput={(e) =>
                          setSlideLayerOverride(
                            slide,
                            slotKey,
                            e.currentTarget.value,
                          )}
                      />
                      <label>番号固定(任意)</label>
                    </div>
                  {/if}
                </div>
              {/each}
            </article>
          {/each}
        {/if}
      {/if}
    </div>

    <!-- 右カラム：常時表示のLCDリアルタイムプレビュー -->
    <div class="s12 m5">
      <article class="border">
        <div class="row">
          <h6 class="max">LCDリアルタイムプレビュー</h6>
          <button
            class="small"
            class:primary={isLoopPreviewing}
            class:border={!isLoopPreviewing}
            onclick={() => (isLoopPreviewing = !isLoopPreviewing)}
          >
            <i>{isLoopPreviewing ? "stop" : "play_arrow"}</i>
            <span>{isLoopPreviewing ? "ループ停止" : "ループ再生テスト"}</span>
          </button>
        </div>

        <LcdScreen
          slide={currentPreviewSlide}
          layerSlots={preset.layerSlots}
          {imageUrls}
          activeLayerIndices={previewLayerIndices}
        />

        {#if preset.lcdGroups[previewGroupNo]}
          {@const grp = preset.lcdGroups[previewGroupNo]}
          <div class="row center-align top-margin">
            {#each grp.slides as _, idx}
              <button
                class="small circle"
                class:fill={previewSlideIdx === idx}
                class:border={previewSlideIdx !== idx}
                onclick={() => (previewSlideIdx = idx)}
              >
                {idx + 1}
              </button>
            {/each}
          </div>
        {/if}

        <div class="space"></div>
        <p>プレビュー用レイヤー番号切り替え:</p>
        {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
          <div class="field label border small">
            <input
              type="number"
              min="0"
              bind:value={previewLayerIndices[slotKey]}
            />
            <label>{slot.name} 番号</label>
          </div>
        {/each}
      </article>
    </div>
  </div>
</section>
