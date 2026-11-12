<script lang="ts">
  import VersionHistory from "./VersionHistory.svelte";

  const version = __APP_VERSION__;
  const description = __APP_DESCRIPTION__;
  const obsUrl = "http://localhost:14280/";

  let copied = $state(false);

  async function copyObsUrl(): Promise<void> {
    await navigator.clipboard.writeText(obsUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section class="top-margin">
  <article class="border padding">
    <div class="row wrap-row">
      <div class="max">
        <h5 class="no-margin bold">Machirun (まちるん)</h5>
        <p class="small-text no-margin">{description}</p>
      </div>
      <span class="chip fill bold">v{version}</span>
    </div>

    <div class="space"></div>
    <hr />
    <div class="space"></div>

    <h6><i>tv</i> OBS ブラウザソース連携</h6>
    <p class="small-text">
      OBS Studio
      の「ブラウザ」ソースに以下のURLを指定すると、車内LCD映像と放送音声が自動的に出力されます。
    </p>
    <div class="row">
      <code class="padding fill round">{obsUrl}</code>
      <button class="border small" onclick={copyObsUrl}>
        <i>{copied ? "check" : "content_copy"}</i>
        <span>{copied ? "コピー完了" : "URLをコピー"}</span>
      </button>
    </div>
  </article>

  <div class="space"></div>
  <VersionHistory />
</section>
