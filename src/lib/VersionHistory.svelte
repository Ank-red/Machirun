<script lang="ts">
  interface CommitItem {
    hash: string;
    date: string;
    message: string;
  }

  interface CategoryGroup {
    key: string;
    label: string;
    icon: string;
    commits: CommitItem[];
  }

  interface ReleaseSection {
    version: string;
    date: string;
    categories: CategoryGroup[];
  }

  // プレフィックスと表示カテゴリの定義（上から順に表示される）
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

  const rawCommits = __APP_CHANGELOG__ ?? [];

  /**
   * コミット件名からカテゴリキーと、プレフィックスを除いた本文を抽出する
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
   */
  function groupCommitsByCategory(
    commits: { hash: string; date: string; subject: string }[],
  ): CategoryGroup[] {
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

  let sections = $derived.by<ReleaseSection[]>(() => {
    const rawSections: {
      version: string;
      date: string;
      commits: { hash: string; date: string; subject: string }[];
    }[] = [];

    let current = {
      version: "最新 / 未リリース",
      date: rawCommits[0]?.date ?? "",
      commits: [] as { hash: string; date: string; subject: string }[],
    };

    for (const c of rawCommits) {
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
</script>

<article class="border padding">
  <h6><i>history</i> バージョン・変更履歴</h6>
  {#if sections.length === 0}
    <p class="small-text">変更履歴データがありません。</p>
  {:else}
    {#each sections as sec, idx}
      {#if idx > 0}
        <hr class="small-divider" />
      {/if}
      <div class="top-margin">
        <div class="row">
          <span class="chip primary small bold">{sec.version}</span>
          <span class="small-text">{sec.date}</span>
        </div>

        {#each sec.categories as cat}
          <div class="category-block">
            <div class="category-title bold small-text">
              <i class="tiny">{cat.icon}</i>
              <span>{cat.label}</span>
            </div>
            <ul class="changelog-list">
              {#each cat.commits as commit}
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

<style>
  .small-divider {
    opacity: 0.2;
    margin: 1rem 0;
  }

  .category-block {
    margin-top: 0.5rem;
    margin-left: 0.5rem;
  }

  .category-title {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    opacity: 0.85;
    margin-bottom: 0.2rem;
  }

  .changelog-list {
    margin: 0.2rem 0 0.6rem 1.4rem;
    padding: 0;
  }

  .changelog-list li {
    margin-bottom: 0.25rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
</style>
