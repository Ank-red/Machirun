import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { IS_TAURI } from "./lcdSync";
import type { AvailableUpdateInfo } from "./types";

/**
 * アプリケーションの自動アップデート確認および適用を担うサービスクラス
 */
export class UpdaterService {
  private static pendingUpdate: Update | null = null;

  /**
   * 最新バージョンの有無を確認する
   * @returns 更新が存在する場合はバージョン情報、なければ null
   */
  static async checkForUpdates(): Promise<AvailableUpdateInfo | null> {
    if (!IS_TAURI) return null;

    try {
      const update = await check();
      this.pendingUpdate = update;
      if (!update) return null;

      return {
        version: update.version,
        body: update.body ?? "",
      };
    } catch (err) {
      console.warn("Update check skipped or failed:", err);
      return null;
    }
  }

  /**
   * 検出済みのアップデートをダウンロード・インストールしてアプリを再起動する
   * @param onProgress ダウンロード進捗コールバック (0〜100)
   */
  static async downloadAndInstall(
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    if (!this.pendingUpdate) {
      await this.checkForUpdates();
    }
    if (!this.pendingUpdate) return;

    let downloaded = 0;
    let total = 0;

    await this.pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total > 0 && onProgress) {
          onProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        }
      } else if (event.event === "Finished") {
        onProgress?.(100);
      }
    });

    await relaunch();
  }
}