<script lang="ts">
  // --- Imports ---

  import type { CommitEntry } from "../core/types";

  // --- Types ---

  /** 整形後のコミット表示アイテム */
  interface CommitItem {
    hash: string;
    date: string;
    message: string;
  }

  /** カテゴリごとに分類されたコミットグループ */
  interface CategoryGroup {
    key: string;
    label: string;
    icon: string;
    commits: CommitItem[];
  }

  /** リリースバージョン単位のセクション */
  interface ReleaseSection {
    version: string;
    date: string;
    categories: CategoryGroup[];
  }

  // --- Constants ---

  /** アプリケーションバージョン */
  const VERSION = __APP_VERSION__;

  /** アプリケーション説明文 */
  const DESCRIPTION = __APP_DESCRIPTION__;

  /** OBSブラウザソースに設定するローカルサーバーURL */
  const OBS_URL = "http://localhost:14280/";

  /** ビルド時に注入されたGitコミット履歴配列 */
  const RAW_COMMITS: CommitEntry[] = __APP_CHANGELOG__ ?? [];

  /** コミットプレフィックスと表示カテゴリの定義 */
  const CATEGORY_RULES: {
    key: string;
    label: string;
    icon: string;
    prefixes: string[];
  }[] = [
    {
      key: "add",
      label: "追加",
      icon: "add_circle",
      prefixes: ["add", "feat", "feature", "new"],
    },
    {
      key: "change",
      label: "変更・改善",
      icon: "build",
      prefixes: ["change", "update", "improve", "refactor", "perf", "style"],
    },
    {
      key: "fix",
      label: "修正",
      icon: "bug_report",
      prefixes: ["fix", "bugfix", "hotfix"],
    },
    {
      key: "remove",
      label: "削除",
      icon: "delete",
      prefixes: ["remove", "del", "delete", "clean"],
    },
    {
      key: "other",
      label: "その他",
      icon: "commit",
      prefixes: [],
    },
  ];

  // --- State & Derived ---

  /** OBS URLのクリップボードコピー完了フラグ */
  let copied = $state(false);

  /** バージョンごとにグループ化・カテゴリ分類された変更履歴セクション配列 */
  let sections = $derived.by<ReleaseSection[]>(() => {
    const rawSections: {
      version: string;
      date: string;
      commits: CommitEntry[];
    }[] = [];

    let current = {
      version: "最新 / 未リリース",
      date: RAW_COMMITS[0]?.date ?? "",
      commits: [] as CommitEntry[],
    };

    for (const c of RAW_COMMITS) {
      if (c.versionTag) {
        if (current.commits.length > 0) {
          rawSections.push(current);
        }
        current = {
          version: `v${c.versionTag}`,
          date: c.date,
          commits: [],
        };
        const isVersionOnly = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(c.subject.trim());
        const isDevCommit = /^dev(?:\([^)]+\))?\s*[:：]/i.test(
          c.subject.trim(),
        );
        if (!isVersionOnly && !isDevCommit) {
          current.commits.push(c);
        }
      } else {
        const isTempCommit = /^temp$/i.test(c.subject.trim());
        if (!isTempCommit) {
          current.commits.push(c);
        }
      }
    }

    if (current.commits.length > 0) {
      rawSections.push(current);
    }

    return rawSections.map((sec) => ({
      version: sec.version,
      date: sec.date,
      categories: groupCommitsByCategory(sec.commits),
    }));
  });

  // --- Handlers & Methods ---

  /**
   * OBS連携用URLをクリップボードへコピーする
   */
  async function copyObsUrl(): Promise<void> {
    await navigator.clipboard.writeText(OBS_URL);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  /**
   * コミット件名からカテゴリキーとプレフィックスを除いた本文を抽出する
   * @param subject コミット件名
   * @returns カテゴリキーと整形済みメッセージ
   */
  function parseCommitSubject(subject: string): {
    categoryKey: string;
    cleanMessage: string;
  } {
    const match = subject.match(/^([a-zA-Z]+)(?:\([^)]+\))?\s*[:：]\s*(.+)$/);
    if (match) {
      const prefix = match[1].toLowerCase();
      const body = match[2].trim();
      for (const rule of CATEGORY_RULES) {
        if (rule.prefixes.includes(prefix)) {
          return { categoryKey: rule.key, cleanMessage: body };
        }
      }
    }
    return { categoryKey: "other", cleanMessage: subject.trim() };
  }

  /**
   * コミット配列を定義順のカテゴリグループ配列に変換する
   * @param commits コミットエントリ配列
   * @returns カテゴリグループ配列
   */
  function groupCommitsByCategory(commits: CommitEntry[]): CategoryGroup[] {
    const map = new Map<string, CommitItem[]>();

    for (const c of commits) {
      const { categoryKey, cleanMessage } = parseCommitSubject(c.subject);
      const list = map.get(categoryKey) ?? [];
      list.push({ hash: c.hash, date: c.date, message: cleanMessage });
      map.set(categoryKey, list);
    }

    return CATEGORY_RULES.filter((rule) => map.has(rule.key)).map((rule) => ({
      key: rule.key,
      label: rule.label,
      icon: rule.icon,
      commits: map.get(rule.key)!,
    }));
  }
</script>

<!-- ソフトウェア情報・OBS連携・変更履歴画面 -->
<section class="top-margin">
  <article class="border padding">
    <div class="row wrap-row">
      <div class="max">
        <h5 class="no-margin bold">Machirun (まちるん)</h5>
        <p class="small-text no-margin">{DESCRIPTION}</p>
      </div>
      <span class="chip fill bold">v{VERSION}</span>
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
      <code class="padding fill round">{OBS_URL}</code>
      <button type="button" class="border small" onclick={copyObsUrl}>
        <i>{copied ? "check" : "content_copy"}</i>
        <span>{copied ? "コピー完了" : "URLをコピー"}</span>
      </button>
    </div>
  </article>

  <div class="space"></div>

  <article class="border padding">
    <h6><i>history</i> バージョン・変更履歴</h6>
    {#if sections.length === 0}
      <p class="small-text">変更履歴データがありません。</p>
    {:else}
      {#each sections as sec, idx (sec.version)}
        {#if idx > 0}
          <hr class="small-divider" />
        {/if}
        <div class="top-margin">
          <div class="row">
            <span class="chip primary small bold">{sec.version}</span>
            <span class="small-text">{sec.date}</span>
          </div>

          {#each sec.categories as cat (cat.key)}
            <div class="category-block">
              <div class="category-title bold small-text">
                <i class="tiny">{cat.icon}</i>
                <span>{cat.label}</span>
              </div>
              <ul class="changelog-list">
                {#each cat.commits as commit (commit.hash)}
                  <li>
                    <code class="small-text">{commit.hash}</code>
                    <span>{commit.message}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </article>
</section>

<style>
  .small-divider {
    margin: 1rem 0;
    opacity: 0.2;
  }

  .category-block {
    margin-left: 0.5rem;
    margin-top: 0.5rem;
  }

  .category-title {
    align-items: center;
    display: inline-flex;
    gap: 0.3rem;
    margin-bottom: 0.2rem;
    opacity: 0.85;
  }

  .changelog-list {
    margin: 0.2rem 0 0.6rem 1.4rem;
    padding: 0;
  }

  .changelog-list li {
    align-items: baseline;
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
</style>
