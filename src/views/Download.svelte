<script lang="ts">
  // --- Imports ---

  import { onMount } from "svelte";
  import Header from "../components/Header.svelte";
  import type { ReleaseDownloadUrls } from "../core/types";

  // --- State ---

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
      const res = await fetch(
        "https://api.github.com/repos/Ank-red/Machirun/releases/latest",
      );
      if (!res.ok) return;
      const data = await res.json();
      for (const asset of data.assets ?? []) {
        if (asset.name.endsWith("-setup.exe"))
          releaseUrls.windows = asset.browser_download_url;
        if (asset.name.endsWith(".rpm"))
          releaseUrls.rpm = asset.browser_download_url;
        if (asset.name.endsWith(".deb"))
          releaseUrls.deb = asset.browser_download_url;
        if (asset.name.endsWith(".AppImage"))
          releaseUrls.appImage = asset.browser_download_url;
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

<!-- Webブラウザアクセス時のデスクトップ版ダウンロード案内画面 -->
<Header title="Machirun Driver" />
<main class="responsive padding">
  <article class="border round large-padding center-align">
    <h5>Machirun デスクトップ版</h5>
    <p>
      車載器システムおよび停留所エディタはデスクトップ版アプリでご利用いただけます。
    </p>
    <div class="space"></div>
    <nav class="center-align wrap">
      <a class="button fill" href={releaseUrls.windows}>Windows</a>
      <a class="button fill" href={releaseUrls.rpm}>Fedora Linux (rpm)</a>
      <a class="button fill" href={releaseUrls.deb}>Debian GNU/Linux (deb)</a>
      <a class="button fill" href={releaseUrls.appImage}>Linux版 (AppImage)</a>
    </nav>
  </article>
</main>
