import { $ } from "bun";

type VersionMode = "major" | "minor" | "patch" | "pre";
type CommandType = VersionMode | "release";

const arg = process.argv[2] as CommandType;
const VALID_COMMANDS: CommandType[] = ["major", "minor", "patch", "pre", "release"];

if (!VALID_COMMANDS.includes(arg)) {
  console.error("使い方: bun run release.ts <major | minor | patch | pre | release>");
  process.exit(1);
}

if (arg === "release") {
  await runRelease();
} else {
  await runVersionUp(arg);
}

/**
 * 現在のバージョン文字列から次のバージョン文字列を算出する
 * 例:
 * - "1.0.2" + "patch" -> "1.0.3"
 * - "1.0.2" + "pre"   -> "1.0.3-pre.1"
 * - "1.0.3-pre.1" + "pre" -> "1.0.3-pre.2"
 * - "1.0.3-pre.2" + "patch" / "minor" / "major" -> プレリリース識別子を落として確定
 */
function nextVersion(current: string, mode: VersionMode): string {
  const preMatch = current.match(/^(\d+)\.(\d+)\.(\d+)-pre\.(\d+)$/);

  if (preMatch) {
    const major = Number(preMatch[1]);
    const minor = Number(preMatch[2]);
    const patch = Number(preMatch[3]);
    const preNum = Number(preMatch[4]);

    if (mode === "pre") {
      return `${major}.${minor}.${patch}-pre.${preNum + 1}`;
    }
    // すでにプレリリース番号を進めている状態で major / minor / patch を指定した場合は確定版へ
    return `${major}.${minor}.${patch}`;
  }

  const [major, minor, patch] = current.split(".").map(Number);

  if (mode === "pre") {
    return `${major}.${minor + 1}.${patch}-pre.1`;
  }
  if (mode === "major") {
    return `${major + 1}.0.0`;
  }
  if (mode === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

async function runRelease(): Promise<void> {
  const pkg = await Bun.file("package.json").json();
  const version: string = pkg.version;
  const tagName = `v${version}`;

  await $`git tag ${tagName}`;
  await $`git push origin ${tagName}`;

  console.log(`🏷️ タグ ${tagName} を作成してプッシュしました`);
}

async function runVersionUp(mode: VersionMode): Promise<void> {
  const pkgPath = "package.json";
  const pkg = await Bun.file(pkgPath).json();
  const oldVersion: string = pkg.version;
  const newVersion = nextVersion(oldVersion, mode);
  const appTitle: string = `${pkg.appTitle} Driver` || "Machirun Driver";
  const pkgName: string = pkg.name || "machirun";

  console.log(`🚀 バージョンを ${oldVersion} -> ${newVersion} に更新します...`);

  // 1. package.json
  pkg.version = newVersion;
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // 2. src-tauri/tauri.conf.json
  const tauriConfPath = "src-tauri/tauri.conf.json";
  const tauriConf = await Bun.file(tauriConfPath).json();
  tauriConf.version = newVersion;
  tauriConf.productName = appTitle;
  tauriConf.mainBinaryName = pkgName;
  if (Array.isArray(tauriConf.app?.windows) && tauriConf.app.windows[0]) {
    tauriConf.app.windows[0].title = appTitle;
  }
  await Bun.write(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

  // 3. src-tauri/Cargo.toml
  const cargoPath = "src-tauri/Cargo.toml";
  const cargoLockPath = "src-tauri/Cargo.lock";
  let cargoText = await Bun.file(cargoPath).text();

  cargoText = cargoText.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${newVersion}"`);
  if (pkg.description) {
    cargoText = cargoText.replace(/^(description\s*=\s*)[^\r\n]+/m, `$1"${pkg.description}"`);
  }
  const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repoUrl) {
    cargoText = cargoText.replace(/^(repository\s*=\s*)[^\r\n]+/m, `$1"${repoUrl}"`);
  }
  if (pkg.author) {
    const authorStr = typeof pkg.author === "string" ? pkg.author : pkg.author.name;
    cargoText = cargoText.replace(/^(authors\s*=\s*)\[[^\]]*\]/m, `$1["${authorStr}"]`);
  }
  await Bun.write(cargoPath, cargoText);

  // 4. wrangler.toml
  const wranglerPath = "wrangler.toml";
  const hasWrangler = await Bun.file(wranglerPath).exists();
  if (hasWrangler) {
    let wranglerText = await Bun.file(wranglerPath).text();
    wranglerText = wranglerText.replace(/^(name\s*=\s*)"[^"]+"/m, `$1"${pkgName}"`);
    await Bun.write(wranglerPath, wranglerText);
  }

  // 5. Cargo.lock 同期
  await $`cargo update -p app --manifest-path ${cargoPath}`;

  // 6. コミット・プッシュ・コンテキスト更新
  const targets = [pkgPath, tauriConfPath, cargoPath, cargoLockPath];
  if (hasWrangler) targets.push(wranglerPath);

  await $`git add ${targets}`;
  await $`git commit -m ${newVersion}`;
  await $`git push origin HEAD`;
  await $`bun run context`;

  console.log(`✅ バージョン更新完了: ${newVersion}`);
}