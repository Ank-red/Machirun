import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import packageJson from "./package.json" with { type: "json" };
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

export interface CommitEntry {
  hash: string;
  date: string;
  subject: string;
  versionTag?: string;
}

function getGitChangelog(): CommitEntry[] {
  try {
    const raw = execFileSync(
      "git",
      [
        "log",
        "--no-merges",
        "-n",
        "100",
        "--date=short",
        "--pretty=format:%h|%ad|%s|%D",
      ],
      { encoding: "utf-8" },
    );
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, subject, refs] = line.split("|");
        const tagMatch = refs?.match(/tag:\s*(?:app-v|v)?([0-9]+\.[0-9]+\.[0-9]+)/);
        const isVersionCommit = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(subject.trim());
        return {
          hash,
          date,
          subject,
          versionTag: tagMatch?.[1] ?? (isVersionCommit ? subject.trim() : undefined),
        };
      })
      .filter((entry) => {
        const isDevCommit = /^dev(?:\([^)]+\))?\s*[:：]/i.test(entry.subject.trim());
        // タグが付いていない Dev: コミットはここで完全に除外
        if (isDevCommit && !entry.versionTag) {
          return false;
        }
        return true;
      });
  } catch {
    return [];
  }
}

export default defineConfig(() => {
  const changelog = getGitChangelog();

  const define: Record<string, string> = {
    APP_TITLE: packageJson.appTitle || "UnknownAppName",
    APP_VERSION: packageJson.version || "UnknownVersion",
    APP_HOMEPAGE: packageJson.homepage || "",
    APP_DESCRIPTION: packageJson.description || "",
    APP_AUTHOR_NAME: packageJson.author?.name || "UnknownAuthor",
    APP_AUTHOR_URL: packageJson.author?.url || "UnknownAuthor",
    APP_REPOSITORY_URL: packageJson.repository?.url || "",
  };

  return {
    define: {
      __APP_TITLE__: JSON.stringify(define.APP_TITLE),
      __APP_VERSION__: JSON.stringify(define.APP_VERSION),
      __APP_HOMEPAGE__: JSON.stringify(define.APP_HOMEPAGE),
      __APP_DESCRIPTION__: JSON.stringify(define.APP_DESCRIPTION),
      __APP_AUTHOR_NAME__: JSON.stringify(define.APP_AUTHOR_NAME),
      __APP_AUTHOR_URL__: JSON.stringify(define.APP_AUTHOR_URL),
      __APP_REPOSITORY_URL__: JSON.stringify(define.APP_REPOSITORY_URL),
      __APP_CHANGELOG__: JSON.stringify(changelog),
    },
    optimizeDeps: {
      exclude: ["@jsquash/avif", "wasm-media-encoders"],
    },
    plugins: [
      {
        name: "html-transform",
        transformIndexHtml: {
          order: "pre",
          handler: (html: string): string =>
            html.replace(/\{(.*?)\}/g, (match, key) => define[key] ?? match),
        },
      },
      svelte(),
    ],
    build: {
      emptyOutDir: true,
      rollupOptions: {
        input: {
          driver: resolve(import.meta.dirname, "driver.html"),
          passenger: resolve(import.meta.dirname, "index.html"),
        },
        output: {
          entryFileNames: "assets/[name].[hash].js",
          chunkFileNames: "assets/[name].[hash].js",
          assetFileNames: "assets/[name].[hash].[ext]",
        },
      },
    },
  };
});