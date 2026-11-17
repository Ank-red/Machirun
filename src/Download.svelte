<script lang="ts">
  // --- Imports ---

  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import type { ReleaseDownloadUrls } from "./core/types";

  // --- Constants ---

  /** アーカイブ構造のツリー図 */
  const ARCHIVE_TREE_SAMPLE = `example_route.mchrn (ZIP Archive)
├── preset.json                  # 路線・レイヤー・進行パターン定義 (UTF-8, Deflate Level 9)
├── timetable.csv                # OptDia互換 運行ダイヤグラム (UTF-8, Deflate Level 9)
├── image/
│   └── <16文字のhashId>.avif    # 透過対応AVIF画像 (無圧縮 Store Level 0)
└── audio/
    └── <16文字のhashId>.opus    # Ogg Opus音声 (無圧縮 Store Level 0)`;

  /** preset.json の構造サンプル */
  const PRESET_JSON_SAMPLE = JSON.stringify(
    {
      meta: { name: "町林駅〜瀬河原線 (下り)" },
      images: {
        a1b2c3d4e5f60001: {
          fileName: "a1b2c3d4e5f60001.avif",
          originalName: "base_normal.png",
        },
      },
      layerSlots: {
        stop: {
          name: "停留所名レイヤー",
          linkedToCsvStop: true,
          defaultItemId: "",
          items: { "0": "a1b2c3d4e5f60002" },
        },
      },
      audios: {
        f1e2d3c4b5a60001: {
          fileName: "f1e2d3c4b5a60001.opus",
          originalName: "announce_01.wav",
        },
      },
      audioGroups: {
        "1": {
          name: "チャイム＋始発案内",
          audioIds: ["f1e2d3c4b5a60000", "f1e2d3c4b5a60001"],
        },
      },
      audioSlots: {
        announce: {
          name: "次停留所放送",
          linkedToCsvStop: true,
          inheritPrevious: false,
          items: { "0": "group:1", "1": "__NONE__" },
        },
      },
      lcdGroups: {
        "1": {
          name: "通常走行ループ",
          loop: true,
          slides: [
            {
              baseImageId: "a1b2c3d4e5f60001",
              durationSec: 8,
              visibleLayers: ["stop", "fare"],
              layerOverrides: {},
            },
          ],
        },
      },
      stopLcdOverrides: {
        "0": { phase_announce: 2 },
      },
      progressionPhases: [
        {
          id: "phase_announce",
          label: "次停留所案内",
          lcdGroupNo: 1,
          playAudioSlots: ["announce"],
          applyAtFirstStop: false,
          applyAtMiddleStops: true,
          applyAtLastStop: true,
        },
      ],
      actions: [],
      interrupts: [
        {
          id: "intr_stop_btn",
          label: "次止まります (降車ボタン)",
          shortcutKey: "Space",
          lcdGroupNo: 2,
          playAudioSlots: [],
          playAudioId: "f1e2d3c4b5a60099",
        },
      ],
    },
    null,
    2,
  );

  // --- State ---

  /** 現在選択されている表示タブ */
  let activeTab = $state<"download" | "spec">("download");

  /** 最新リリースのバージョン名 */
  let latestVersion = $state<string>("");

  /** 各OS向け最新リリースバイナリのダウンロードURL */
  let releaseUrls = $state<ReleaseDownloadUrls>({
    windows: "#",
    rpm: "#",
    deb: "#",
    appImage: "#",
  });

  // --- Handlers & Methods ---

  /**
   * GitHub Releases APIから最新バイナリのダウンロードURLを取得する
   */
  async function fetchLatestReleaseUrls(): Promise<void> {
    try {
      const res = await fetch("https://api.github.com/repos/Ank-red/Machirun/releases/latest");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.tag_name === "string") {
        latestVersion = data.tag_name;
      }
      for (const asset of data.assets ?? []) {
        if (asset.name.endsWith("-setup.exe")) releaseUrls.windows = asset.browser_download_url;
        if (asset.name.endsWith(".rpm")) releaseUrls.rpm = asset.browser_download_url;
        if (asset.name.endsWith(".deb")) releaseUrls.deb = asset.browser_download_url;
        if (asset.name.endsWith(".AppImage")) releaseUrls.appImage = asset.browser_download_url;
      }
    } catch (err) {
      console.error("Failed to fetch release URLs:", err);
    }
  }

  // --- Lifecycle ---

  onMount(() => {
    fetchLatestReleaseUrls();
  });
</script>

<Header title="Machirun" />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_missing_attribute -->
<main class="responsive padding">
  <div class="tabs left-align">
    <a class:active={activeTab === "download"} onclick={() => (activeTab = "download")}>
      <i>download</i>
      <span>デスクトップ版ダウンロード</span>
    </a>
    <a class:active={activeTab === "spec"} onclick={() => (activeTab = "spec")}>
      <i>description</i>
      <span>mchrn 形式仕様書 (v1.0)</span>
    </a>
  </div>

  {#if activeTab === "download"}
    <article class="border round large-padding center-align top-margin">
      <h5>
        Machirun Driver デスクトップ版
        {#if latestVersion}
          <span class="chip small primary bold">{latestVersion}</span>
        {/if}
      </h5>
      <p>
        車載器システム・停留所エディタおよび OBS
        ブラウザソース配信機能は、デスクトップ版アプリケーションでご利用いただけます。
      </p>
      <div class="space"></div>
      <nav class="center-align wrap">
        <a class="button border" href={releaseUrls.windows}>
          <i>desktop_windows</i>
          <span>Windows (Installer)</span>
        </a>
        <a class="button border" href={releaseUrls.appImage}>
          <i>terminal</i>
          <span>Linux (AppImage)</span>
        </a>
        <a class="button border" href={releaseUrls.deb}>
          <i>terminal</i>
          <span>Debian / Ubuntu (.deb)</span>
        </a>
        <a class="button border" href={releaseUrls.rpm}>
          <i>terminal</i>
          <span>Fedora / RHEL (.rpm)</span>
        </a>
      </nav>
    </article>
  {:else if activeTab === "spec"}
    <!-- 1. 概要・コンテナ構造 -->
    <article class="border round padding top-margin">
      <div class="row">
        <h5 class="max no-margin bold">Machirun プリセット形式 (.mchrn) 仕様書</h5>
        <span class="chip fill bold">Format v1.0</span>
      </div>
      <p class="small-text">
        <code>.mchrn</code> は、Machirun の路線プリセット・運行ダイヤ・LCD画像・放送音声を単一ファイルで配布・共有するための標準コンテナ形式です。
      </p>

      <h6><i>folder_zip</i> 1. コンテナ構造 (ZIP アーカイブ)</h6>
      <p class="small-text">
        ファイルの実体は標準的な ZIP アーカイブです。テキストデータ（JSON / CSV）には Deflate 圧縮（Level
        9）を適用し、既に高圧縮されているメディアファイル（AVIF / Opus）は無圧縮（Store / Level
        0）で格納することで、高速な読み込みと省サイズを両立しています。
      </p>
      <pre class="code-block"><code>{ARCHIVE_TREE_SAMPLE}</code></pre>
    </article>

    <!-- 2. メディアアセット仕様 -->
    <article class="border round padding top-margin">
      <h6><i>perm_media</i> 2. メディアアセット仕様</h6>
      <div class="table-scroll">
        <table class="border spec-table">
          <thead>
            <tr>
              <th>種別</th>
              <th>格納パス</th>
              <th>フォーマット・コーデック</th>
              <th>仕様詳細</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="bold">画像 (LCD)</td>
              <td><code>image/&lt;hashId&gt;.avif</code></td>
              <td>AVIF (<code>image/avif</code>)</td>
              <td>16:9 推奨。アルファチャンネル（透過）維持。エディタ登録時に自動変換（Quality: 80）。</td>
            </tr>
            <tr>
              <td class="bold">音声 (放送)</td>
              <td><code>audio/&lt;hashId&gt;.opus</code></td>
              <td>Ogg Opus (<code>audio/ogg; codecs=opus</code>)</td>
              <td>モノラルまたはステレオ（1〜2ch）。エディタ登録時に自動変換（VBR Quality: 5）。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="small-text no-margin top-margin">
        ※ <code>&lt;hashId&gt;</code> は UUID v4 からハイフンを除いた先頭16文字のランダム英数字（例:
        <code>a1b2c3d4e5f60001</code>）です。元のファイル名は <code>preset.json</code> 側の <code>originalName</code> フィールドに保持されます。
      </p>
    </article>

    <!-- 3. preset.json スキーマ定義 -->
    <article class="border round padding top-margin">
      <h6><i>data_object</i> 3. preset.json スキーマ定義</h6>
      <p class="small-text">
        文字コードは UTF-8
        です。画像や音声の割り当てには、直前の停留所の設定を引き継ぐ継承機能や、特殊な予約語が利用できます。
      </p>

      <div class="table-scroll">
        <table class="border spec-table">
          <thead>
            <tr>
              <th>キー名</th>
              <th>型</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>meta.name</code></td>
              <td><code>string</code></td>
              <td>プリセットの表示名（路線名・方向など）。</td>
            </tr>
            <tr>
              <td><code>images</code> / <code>audios</code></td>
              <td><code>Record&lt;hashId, Asset&gt;</code></td>
              <td
                >ハッシュIDをキーとし、アーカイブ内の <code>fileName</code> と表示用の <code>originalName</code> を紐づける辞書。</td
              >
            </tr>
            <tr>
              <td><code>audioGroups</code></td>
              <td><code>Record&lt;groupNo, Group&gt;</code></td>
              <td
                >複数の音声ID（<code>audioIds</code>）を順番に連続再生するグループ定義。参照時は
                <code>"group:&lt;groupNo&gt;"</code> と記述します。</td
              >
            </tr>
            <tr>
              <td><code>layerSlots</code></td>
              <td><code>Record&lt;slotKey, LayerSlot&gt;</code></td>
              <td>
                ベース画像の上に重ねる透過画像レイヤー枠。<code>items</code> のキーは停留所インデックス文字列（<code
                  >"0"</code
                >〜）。未指定（空文字）の停留所は、直前の停留所の画像を自動継承します。
              </td>
            </tr>
            <tr>
              <td><code>audioSlots</code></td>
              <td><code>Record&lt;slotKey, AudioSlot&gt;</code></td>
              <td>
                進行フェーズごとに再生する音声枠。<code>inheritPrevious: true</code>
                の場合、未指定の停留所は直前の設定を継承し、明示的に無音化する場合は予約語 <code>"__NONE__"</code> を設定します。
              </td>
            </tr>
            <tr>
              <td><code>lcdGroups</code></td>
              <td><code>Record&lt;groupNo, LcdGroup&gt;</code></td>
              <td>
                車内LCDの表示ループ単位。各スライド（<code>slides</code>）にベース画像、表示秒数（<code
                  >durationSec</code
                >）、重ねるレイヤー順（<code>visibleLayers</code>）を定義します。
              </td>
            </tr>
            <tr>
              <td><code>progressionPhases</code></td>
              <td><code>ProgressionPhase[]</code></td>
              <td>
                1停留所あたりの基本進行パターン（案内・到着・発車など）。始発（<code>applyAtFirstStop</code
                >）・途中（<code>applyAtMiddleStops</code>）・終点（<code>applyAtLastStop</code
                >）ごとの適用有無を制御します。
              </td>
            </tr>
            <tr>
              <td><code>stopLcdOverrides</code></td>
              <td><code>Record&lt;stopIdx, Map&gt;</code></td>
              <td>特定の停留所インデックス・特定のフェーズIDでのみ、切り替えるLCDグループ番号を上書きするマップ。</td>
            </tr>
            <tr>
              <td><code>actions</code></td>
              <td><code>ActionStep[]</code></td>
              <td>
                基本進行パターンとは別に差し込む例外ステップ配列。<code>insertAfterStopIdx</code>（<code>-1</code>
                で始発前、<code>0</code>〜で該当停留所の全フェーズ完了後）の位置に挿入されます。
              </td>
            </tr>
            <tr>
              <td><code>interrupts</code></td>
              <td><code>InterruptAction[]</code></td>
              <td
                >降車ボタン（「次止まります」）など、進行ステップとは独立したショートカットキーによる割り込み動作定義。</td
              >
            </tr>
          </tbody>
        </table>
      </div>

      <p class="bold small-text top-margin">preset.json 記述例:</p>
      <pre class="code-block"><code>{PRESET_JSON_SAMPLE}</code></pre>
    </article>

    <!-- 4. timetable.csv 仕様 -->
    <article class="border round padding top-margin">
      <h6><i>schedule</i> 4. timetable.csv (運行ダイヤグラム) 仕様</h6>
      <p class="small-text">
        OptDia 形式互換のカンマ区切り CSV（UTF-8）です。1列目に項目名または停留所名、2列目に着発区分（<code>着</code> /
        <code>発</code>）、3列目以降に各便のデータを記述します。
      </p>
      <ul class="spec-list small-text">
        <li>
          <b>ヘッダーメタ行</b>: <code>列車番号</code>, <code>運転日</code>, <code>運用番号</code>, <code>両数</code>,
          <code>種別・愛称</code>, <code>号数</code>, <code>行き先</code> を認識します。
        </li>
        <li>
          <b>マスター停留所抽出</b>: メタ行およびフッター行（<code>連続する列車</code>,
          <code>備考</code
          >）を除いた1列目の停留所名を上から順に走査し、連続重複を除いたリストを路線のマスター停留所（インデックス
          <code>0</code>〜<code>N</code>）として構築します。
        </li>
        <li>
          <b>運行日判定（列車番号の百の位規則）</b>: 午前4時未満は前日営業日として扱います。
          <ul>
            <li><b>300 / 400番台</b>: 当日が土休日の場合のみ運行</li>
            <li><b>500 / 600番台</b>: 翌日が土休日の場合のみ運行（休前日便）</li>
            <li><b>その他 (100 / 200番台など)</b>: 毎日運行</li>
          </ul>
        </li>
      </ul>
    </article>
  {/if}
</main>

<style>
  .code-block {
    background-color: rgb(0 0 0 / 25%);
    border-radius: 0.5rem;
    font-size: 0.8rem;
    line-height: 1.45;
    margin: 0.5rem 0 0;
    overflow-x: auto;
    padding: 1rem;
  }

  .spec-list {
    line-height: 1.6;
    margin: 0.5rem 0 0 1.25rem;
    padding: 0;
  }

  .spec-table {
    min-width: 40rem;
    width: 100%;
  }

  .table-scroll {
    overflow-x: auto;
    width: 100%;
  }
</style>
