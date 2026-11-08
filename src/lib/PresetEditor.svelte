<script lang="ts">
  // --- Imports ---
  import type { RoutePreset, LcdSlide, ActionStep } from "./preset";
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

  let activePreviewStepIdx = $state<number | null>(null);
  let previewAudioPlayer: HTMLAudioElement | null = null;

  let imageOptions = $derived([
    { value: "", label: "-- 画像を選択 --" },
    ...Object.entries(preset.images).map(([id, asset]) => ({
      value: id,
      label: `${asset.originalName} (${id.slice(0, 6)})`,
    })),
  ]);

  let lcdGroupOptions = $derived(
    Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
      value: gNo,
      label: `#${gNo}: ${grp.name}`,
    })),
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
   * 全アクションステップの stepNo を 1 からの連番に振り直す
   */
  function renumberActionSteps(): void {
    preset.actions.forEach((step, idx) => {
      step.stepNo = idx + 1;
    });
  }

  /**
   * 新しいアクションステップを末尾に追加する
   */
  function addActionStep(): void {
    const isFirst = preset.actions.length === 0;
    const defaultGroupNo = Number(Object.keys(preset.lcdGroups)[0] ?? 1);

    preset.actions.push({
      stepNo: preset.actions.length + 1,
      label: isFirst ? "始発待機" : "次停留所案内",
      setStopIndex: isFirst ? 0 : undefined,
      setLcdGroupNo: isFirst ? defaultGroupNo : undefined,
      setLayers: isFirst ? { stop: 0, fare: 0 } : { stop: "+1" },
      playAudioId: undefined,
    });
  }

  /**
   * 指定したアクションステップを複製して直後に挿入する
   * @param idx 複製元のインデックス
   */
  function duplicateActionStep(idx: number): void {
    const source = preset.actions[idx];
    if (!source) return;
    const clone: ActionStep = JSON.parse(JSON.stringify(source));
    preset.actions.splice(idx + 1, 0, clone);
    renumberActionSteps();
  }

  /**
   * アクションステップの順序を上下に入れ替える
   * @param idx 移動元のインデックス
   * @param direction -1 で上へ、1 で下へ移動
   */
  function moveActionStep(idx: number, direction: -1 | 1): void {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= preset.actions.length) return;
    const temp = preset.actions[idx];
    preset.actions[idx] = preset.actions[targetIdx];
    preset.actions[targetIdx] = temp;
    renumberActionSteps();
  }

  /**
   * 指定したアクションステップを削除する
   * @param idx 削除対象のインデックス
   */
  function removeActionStep(idx: number): void {
    preset.actions.splice(idx, 1);
    renumberActionSteps();
  }

  /**
   * レイヤー制御（setLayers）の選択値を更新する
   * @param step 対象ステップ
   * @param slotKey レイヤースロットのキー
   * @param val 選択された操作値（undefinedの場合はキーを削除）
   */
  function updateStepLayerValue(
    step: ActionStep,
    slotKey: string,
    val: number | "+1" | null | undefined,
  ): void {
    if (!step.setLayers) {
      step.setLayers = {};
    }
    if (val === undefined) {
      delete step.setLayers[slotKey];
    } else {
      step.setLayers[slotKey] = val;
    }
  }

  /**
   * 先頭から指定インデックスまでのステップを順番にシミュレートし、
   * 右カラムのLCDプレビュー状態と音声再生に反映する
   * @param targetIdx テスト実行するステップのインデックス
   */
  function simulateStepAt(targetIdx: number): void {
    activePreviewStepIdx = targetIdx;

    const simulatedLayers: Record<string, number> = {};
    for (const key of Object.keys(preset.layerSlots)) {
      simulatedLayers[key] = 0;
    }
    let simulatedGroupNo = Object.keys(preset.lcdGroups)[0] ?? "1";

    for (let i = 0; i <= targetIdx; i++) {
      const step = preset.actions[i];
      if (!step) continue;

      if (step.setLcdGroupNo !== undefined) {
        simulatedGroupNo = String(step.setLcdGroupNo);
      }

      if (step.setLayers) {
        for (const [slotKey, op] of Object.entries(step.setLayers)) {
          if (op === "+1") {
            simulatedLayers[slotKey] = (simulatedLayers[slotKey] ?? 0) + 1;
          } else if (typeof op === "number") {
            simulatedLayers[slotKey] = op;
          } else if (op === null) {
            simulatedLayers[slotKey] = -1;
          }
        }
      }
    }

    previewGroupNo = simulatedGroupNo;
    previewSlideIdx = 0;
    previewLayerIndices = simulatedLayers;

    // 対象ステップに音声が設定されていれば再生
    const targetStep = preset.actions[targetIdx];
    if (previewAudioPlayer) {
      previewAudioPlayer.pause();
      previewAudioPlayer = null;
    }
    if (targetStep?.playAudioId && audioUrls[targetStep.playAudioId]) {
      previewAudioPlayer = new Audio(audioUrls[targetStep.playAudioId]);
      previewAudioPlayer
        .play()
        .catch((err) => console.error("Audio Play Error:", err));
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
        <article class="border padding">
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
        {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
          <article class="border padding top-margin">
            <div class="row wrap-row">
              <h6 class="max no-margin">
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

            <div class="row wrap-row top-margin">
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
              <div class="row item-row">
                <span class="bold">#{no}</span>
                {#if slot.linkedToCsvStop && masterStops[Number(no)]}
                  <span class="chip small stop-chip">
                    {masterStops[Number(no)]}
                  </span>
                {/if}
                <Dropdown
                  full={true}
                  bind:value={slot.items[no]}
                  options={imageOptions}
                />
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
        <article class="border padding top-margin">
          <h6>新規レイヤースロットの追加</h6>
          <div class="field label border">
            <input type="text" bind:value={newSlotKey} />
            <label>スロットID (英数字)</label>
          </div>
          <div class="field label border">
            <input type="text" bind:value={newSlotName} />
            <label>表示名</label>
          </div>
          <div class="space"></div>
          <button class="primary" onclick={addLayerSlot}>
            <i>add</i>
            <span>スロット追加</span>
          </button>
        </article>
      {/if}

      <!-- タブ3: LCDグループのベース画像・表示レイヤー設定 -->
      {#if activeTab === "lcd"}
        <article class="border padding">
          <div class="row wrap-row">
            <Dropdown
              full={true}
              label="編集するLCDグループ"
              bind:value={previewGroupNo}
              options={lcdGroupOptions}
              onchange={() => (previewSlideIdx = 0)}
            />
            <button class="primary" onclick={addLcdGroup}>
              <i>add</i>
              <span>新規</span>
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
            <div class="field label border no-margin">
              <input type="text" bind:value={currentGroup.name} />
              <label>グループ名</label>
            </div>
            <div class="row wrap-row top-margin">
              <label class="checkbox max">
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
              class="border padding top-margin"
              class:fill={previewSlideIdx === sIdx}
              onclick={() => (previewSlideIdx = sIdx)}
            >
              <div class="row wrap-row">
                <h6 class="max no-margin">
                  スライド #{sIdx + 1}
                  {#if previewSlideIdx === sIdx}
                    <span class="chip small primary">プレビュー中</span>
                  {/if}
                </h6>
                <div class="field label border small no-margin number-box">
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

              <div class="space"></div>
              <Dropdown
                full={true}
                label="ベース画像"
                bind:value={slide.baseImageId}
                options={imageOptions}
              />

              <div class="space"></div>
              <p class="bold no-margin">
                重ねるレイヤー（チェック順＝下から重ねる順）:
              </p>
              {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
                {@const isVisible = slide.visibleLayers.includes(slotKey)}
                <div class="row wrap-row">
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
                    <div class="field label border small no-margin number-box">
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
                      <label>番号固定</label>
                    </div>
                  {/if}
                </div>
              {/each}
            </article>
          {/each}
        {/if}
      {/if}

      <!-- タブ4: アクションステップ設定 -->
      {#if activeTab === "actions"}
        <article class="border padding">
          <div class="row wrap-row">
            <h6 class="max no-margin">
              アクションステップ一覧 ({preset.actions.length}件)
            </h6>
            <button class="primary" onclick={addActionStep}>
              <i>add</i>
              <span>ステップ追加</span>
            </button>
          </div>
        </article>

        {#each preset.actions as step, idx}
          <article
            class="border padding top-margin"
            class:fill={activePreviewStepIdx === idx}
          >
            <!-- 上段：番号と操作ボタン群 -->
            <div class="row wrap-row">
              <span class="chip small bold">#{step.stepNo}</span>
              <div class="max"></div>
              <button class="small border" onclick={() => simulateStepAt(idx)}>
                <i>play_circle</i>
                <span>テスト</span>
              </button>
              <button
                class="small transparent circle"
                disabled={idx === 0}
                onclick={() => moveActionStep(idx, -1)}
              >
                <i>arrow_upward</i>
              </button>
              <button
                class="small transparent circle"
                disabled={idx === preset.actions.length - 1}
                onclick={() => moveActionStep(idx, 1)}
              >
                <i>arrow_downward</i>
              </button>
              <button
                class="small transparent circle"
                onclick={() => duplicateActionStep(idx)}
              >
                <i>content_copy</i>
              </button>
              <button
                class="small transparent circle error-text"
                onclick={() => removeActionStep(idx)}
              >
                <i>delete</i>
              </button>
            </div>

            <!-- 中段：ステップ表示名 -->
            <div class="field label border top-margin no-bottom-margin">
              <input type="text" bind:value={step.label} />
              <label>ステップ表示名（例: 次停留所案内 / 停車中）</label>
            </div>

            <!-- 下段1：ダイヤ停留所・LCDグループ・音声の切り替え -->
            <div class="grid top-margin">
              <div class="s12 m6">
                <Dropdown
                  full={true}
                  label="車載器ダイヤ停留所"
                  bind:value={step.setStopIndex}
                  options={[
                    { value: undefined, label: "変更なし" },
                    { value: "+1", label: "次の停留所へ (+1)" },
                    ...masterStops.map((stopName, sIdx) => ({
                      value: sIdx,
                      label: `#${sIdx}: ${stopName}`,
                    })),
                  ]}
                />
              </div>

              <div class="s12 m6">
                <Dropdown
                  full={true}
                  label="LCDグループ切替"
                  bind:value={step.setLcdGroupNo}
                  options={[
                    { value: undefined, label: "変更なし" },
                    ...Object.entries(preset.lcdGroups).map(([gNo, grp]) => ({
                      value: Number(gNo),
                      label: `#${gNo}: ${grp.name}`,
                    })),
                  ]}
                />
              </div>

              <div class="s12">
                <Dropdown
                  full={true}
                  label="再生する音声"
                  bind:value={step.playAudioId}
                  options={[
                    { value: undefined, label: "再生しない" },
                    ...Object.entries(preset.audios).map(([audId, asset]) => ({
                      value: audId,
                      label: `${asset.originalName} (${audId.slice(0, 6)})`,
                    })),
                  ]}
                />
              </div>
            </div>

            <!-- 下段2：各レイヤースロットの番号更新 -->
            <div class="space"></div>
            <p class="bold no-margin">レイヤー番号の更新:</p>
            <div class="grid">
              {#each Object.entries(preset.layerSlots) as [slotKey, slot]}
                <div class="s12 m6">
                  <Dropdown
                    full={true}
                    label={`${slot.name} (${slotKey})`}
                    value={step.setLayers?.[slotKey]}
                    onchange={(val) => updateStepLayerValue(step, slotKey, val)}
                    options={[
                      { value: undefined, label: "変更なし (維持)" },
                      { value: "+1", label: "次の番号へ (+1)" },
                      { value: null, label: "非表示にする" },
                      ...Object.keys(slot.items).map((itemNo) => ({
                        value: Number(itemNo),
                        label:
                          slot.linkedToCsvStop && masterStops[Number(itemNo)]
                            ? `#${itemNo} (${masterStops[Number(itemNo)]})`
                            : `#${itemNo} に指定`,
                      })),
                    ]}
                  />
                </div>
              {/each}
            </div>
          </article>
        {/each}
      {/if}
    </div>

    <!-- 右カラム：常時表示のLCDリアルタイムプレビュー -->
    <div class="s12 m5">
      <article class="border padding">
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

        <div class="space"></div>

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

<style>
  /* グリッド要素の横幅突き抜け防止 */
  .grid > * {
    min-width: 0;
  }

  /* 折り返し可能な横並び行 */
  .wrap-row {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* レイヤー番号行の整列 */
  .item-row {
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    min-width: 0;
  }

  .stop-chip {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .number-box {
    width: 6.5rem;
  }

  /* 長いファイル名リストの折り返し */
  ul {
    word-break: break-all;
  }
</style>
