import { defineConfig, loadEnv } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import packageJson from "./package.json" with { type: "json" };
import { resolve } from "node:path";
import { execSync } from "node:child_process";

export interface CommitEntry {
  hash: string;
  date: string;
  subject: string;
  versionTag?: string;
}

function getGitChangelog(): CommitEntry[] {
  try {
    const raw = execSync(
      'git log -n 100 --date=short --pretty=format:"%h|%ad|%s|%D"',
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
        // "Merge" から始まるコミットメッセージやマージログを完全に排除する
        const sub = entry.subject.toLowerCase();
        if (sub.startsWith("merge") || sub.startsWith("Dev:") || sub.includes("merge branch") || sub.includes("merge pull request") || sub.includes("temp")) {
          return false;
        }
        return true;
      });
  } catch {
    return [];
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const changelog = getGitChangelog();

  const define: Record<string, string> = {
    APP_TITLE: env.VITE_APP_TITLE || "Machirun",
    APP_URL: env.VITE_APP_URL || "",
    APP_VERSION: packageJson.version
      ? `${packageJson.version}${mode === "development" ? "-DEV" : ""}`
      : "0.0.0",
    APP_DESCRIPTION: packageJson.description || "",
  };

  return {
    define: {
      __APP_VERSION__: JSON.stringify(define.APP_VERSION),
      __APP_DESCRIPTION__: JSON.stringify(define.APP_DESCRIPTION),
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