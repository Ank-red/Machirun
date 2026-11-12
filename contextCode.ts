import { $ } from "bun";
import path from "node:path";

const OUTPUT_FILE = "context.md";

const EXT_LANG_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".js": "javascript",
  ".svelte": "svelte",
  ".rs": "rust",
  ".toml": "toml",
  ".json": "json",
  ".html": "html",
  ".css": "css",
};

const EXTRA_IGNORE = [
  ".vscode/",
  ".github/",
  "src-tauri/icons/",
  "src-tauri/capabilities/",
  "bun.lockb",
  "bun.lock",
  "package-lock.json",
  "Cargo.lock",
  "bundle-code.ts",
  "release.ts",
  OUTPUT_FILE,
];

async function getTargetFiles(): Promise<string[]> {
  const gitOutput = await $`git ls-files --cached --others --exclude-standard`.text();

  return gitOutput
    .split("\n")
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((filePath) => {
      if (!filePath) return false;

      const ext = path.extname(filePath);
      if (!(ext in EXT_LANG_MAP)) return false;

      const isExtraIgnored = EXTRA_IGNORE.some(
        (pattern) => filePath.startsWith(pattern) || filePath === pattern
      );
      return !isExtraIgnored;
    })
    .sort();
}

async function generateMarkdown() {
  const matchedFiles = await getTargetFiles();
  let output = `# ※以前のコード差分は無視して、以下の最新コードを前提にしてください\n\n`;
  let count = 0;

  for (const relPath of matchedFiles) {
    const file = Bun.file(relPath);
    if (!(await file.exists())) continue;

    const ext = path.extname(relPath);
    const lang = EXT_LANG_MAP[ext] ?? "";
    const content = await file.text();

    const fence = content.includes("```") ? "````" : "```";
    output += `## ${relPath}\n\n${fence}${lang}\n${content.trimEnd()}\n${fence}\n\n`;
    count++;
  }

  await Bun.write(OUTPUT_FILE, output);
  console.log(`✅ ${count} 個のファイルを ${OUTPUT_FILE} に出力したよ！`);
}

generateMarkdown();