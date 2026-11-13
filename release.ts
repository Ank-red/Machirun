import { $ } from "bun";
import { log } from "node:console";

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
  // 1. package.json の読み込みと新バージョンの算出
  const pkgFile = Bun.file("package.json");
  const pkg = await pkgFile.json();
  const oldVersion: string = pkg.version;
  const newVersion = incrementVersion(oldVersion, bumpType);

  console.log(`🚀 バージョンを ${oldVersion} -> ${newVersion} に更新します...`);

  // 2. package.json 更新
  pkg.version = newVersion;
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");

  // 3. src-tauri/tauri.conf.json 更新
  const tauriConfPath = "src-tauri/tauri.conf.json";
  const tauriConf = await Bun.file(tauriConfPath).json();
  tauriConf.version = newVersion;
  await Bun.write(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

  // 4. src-tauri/Cargo.toml の package version 更新
  const cargoPath = "src-tauri/Cargo.toml";
  const cargoText = await Bun.file(cargoPath).text();
  const updatedCargo = cargoText.replace(
    /^(version\s*=\s*)"[^"]+"/m,
    `$1"${newVersion}"`,
  );

  await Bun.write(cargoPath, updatedCargo);

  await $`cargo update -p app --manifest-path ${cargoPath}`;

  // 5. Git コミット・タグ付与・プッシュ
  const tagName = `v${newVersion}`;
  await $`git add package.json ${tauriConfPath} ${cargoPath} ${cargoPath.replace("toml", "lock")}`;
  await $`git commit -m ${newVersion}`;
  await $`git tag ${tagName}`;
  await $`git push origin HEAD`;
  await $`git push origin ${tagName}`;

  console.log(`✅ リリース完了: コミット "${newVersion}" & タグ "${tagName}" をプッシュしました！`);
}

runRelease();