import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { IS_TAURI } from "./lcdSync";
import type { AvailableUpdateInfo, UpdateChannel } from "./types";

/** 選択中のアップデートチャンネルを保持する localStorage キー */
const CHANNEL_STORAGE_KEY = "machirun_update_channel";

/** 安定版チャンネル用の固定エンドポイント */
const STABLE_ENDPOINT =
  "https://github.com/Ank-red/Machirun/releases/latest/download/latest.json";

/** GitHub Releases 一覧API（インサイダー版エンドポイント解決用） */
const GITHUB_RELEASES_API =
  "https://api.github.com/repos/Ank-red/Machirun/releases?per_page=10";

/**
 * アプリケーションの自動アップデート確認および適用を担うサービスクラス
 */
export class UpdaterService {
  /** 直近の確認で解決されたアップデート対象エンドポイント */
  private static pendingEndpoint: string | null = null;

  /**
   * 現在のアップデートチャンネルを取得する（未設定時は実行中バージョンから自動判定）
   * @returns 選択中のアップデートチャンネル
   */
  static getChannel(): UpdateChannel {
    const saved = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (saved === "stable" || saved === "insider") {
      return saved;
    }
    return __APP_VERSION__.includes("-pre") ? "insider" : "stable";
  }

  /**
   * アップデートチャンネルを保存し、キャッシュ済みの更新対象をリセットする
   * @param channel 設定するチャンネル
   */
  static setChannel(channel: UpdateChannel): void {
    localStorage.setItem(CHANNEL_STORAGE_KEY, channel);
    this.pendingEndpoint = null;
  }

  /**
   * 指定チャンネルに対応する latest.json のURLを解決する
   * @param channel 対象のチャンネル
   * @returns エンドポイントURL（取得失敗時は null）
   */
  private static async resolveEndpoint(
    channel: UpdateChannel,
  ): Promise<string | null> {
    if (channel === "stable") {
      return STABLE_ENDPOINT;
    }

    const res = await fetch(GITHUB_RELEASES_API);
    if (!res.ok) return null;

    const releases = (await res.json()) as {
      draft?: boolean;
      assets?: { name?: string; browser_download_url?: string }[];
    }[];

    for (const rel of releases) {
      if (rel.draft) continue;
      const latestAsset = rel.assets?.find((a) => a.name === "latest.json");
      if (latestAsset?.browser_download_url) {
        return latestAsset.browser_download_url;
      }
    }

    return null;
  }

  /**
   * 最新バージョンの有無を確認する
   * @param channel 確認対象チャンネル（省略時は保存済みの設定を使用）
   * @returns 更新が存在する場合はバージョン情報、なければ null
   */
  static async checkForUpdates(
    channel: UpdateChannel = this.getChannel(),
  ): Promise<AvailableUpdateInfo | null> {
    if (!IS_TAURI) return null;

    try {
      const endpoint = await this.resolveEndpoint(channel);
      if (!endpoint) return null;

      const result = await invoke<AvailableUpdateInfo | null>(
        "check_update_with_endpoint",
        { endpoint },
      );

      this.pendingEndpoint = result ? endpoint : null;
      return result;
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
    if (!this.pendingEndpoint) {
      await this.checkForUpdates();
    }
    if (!this.pendingEndpoint) return;

    const unlisten = await listen<number>("update-progress", (event) => {
      onProgress?.(event.payload);
    });

    try {
      await invoke("install_update_with_endpoint", {
        endpoint: this.pendingEndpoint,
      });
    } finally {
      unlisten();
    }

    await relaunch();
  }
}