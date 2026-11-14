import { $ } from "bun";

type BumpType = "major" | "minor" | "patch";

const bumpType = process.argv[2] as BumpType;
if (!["major", "minor", "patch"].includes(bumpType)) {
  console.error("使い方: bun run release.ts <major | minor | patch>");
  process.exit(1);
}

function incrementVersion(version: string, type: BumpType): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function runRelease() {
  const pkgFile = Bun.file("package.json");
  const pkg = await pkgFile.json();
  const oldVersion: string = pkg.version;
  const newVersion = incrementVersion(oldVersion, bumpType);

  console.log(`🚀 バージョンを ${oldVersion} -> ${newVersion} に更新します...`);

  // 1. package.json のバージョン更新
  pkg.version = newVersion;
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");

  // 2. tauri.conf.json のバージョン更新
  const tauriConfPath = "src-tauri/tauri.conf.json";
  const tauriConf = await Bun.file(tauriConfPath).json();
  tauriConf.version = newVersion;
  await Bun.write(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

  // 3. Cargo.toml (バージョン、説明、リポジトリ、作者を package.json に準拠して同期)
  const cargoPath = "src-tauri/Cargo.toml";
  const cargoLockPath = "src-tauri/Cargo.lock";
  let cargoText = await Bun.file(cargoPath).text();

  // バージョン更新
  cargoText = cargoText.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${newVersion}"`);
  // 説明文の同期
  if (pkg.description) {
    cargoText = cargoText.replace(/^(description\s*=\s*)[^\r\n]+/m, `$1"${pkg.description}"`);
  }
  // リポジトリの同期
  const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repoUrl) {
    cargoText = cargoText.replace(/^(repository\s*=\s*)[^\r\n]+/m, `$1"${repoUrl}"`);
  }
  // 作者の同期
  if (pkg.author) {
    const authorStr = typeof pkg.author === "string" ? pkg.author : pkg.author.name;
    cargoText = cargoText.replace(/^(authors\s*=\s*)\[[^\]]*\]/m, `$1["${authorStr}"]`);
  }
  await Bun.write(cargoPath, cargoText);

  // 4. Cargo.lock の即時同期
  await $`cargo update -p app --manifest-path ${cargoPath}`;

  // 5. Git コミット・タグ付与・プッシュ
  const tagName = `v${newVersion}`;
  await $`git add package.json ${tauriConfPath} ${cargoPath} ${cargoLockPath}`;
  await $`git commit -m ${newVersion}`;
  await $`git tag ${tagName}`;
  await $`git push origin HEAD`;
  await $`git push origin ${tagName}`;
  await $`bun run context`;

  console.log(`✅ リリース完了: v${newVersion} の更新とプッシュが完了しました！`);
}

runRelease();