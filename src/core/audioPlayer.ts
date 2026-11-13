import { PresetService } from "./preset";
import type { RoutePreset } from "./types";

/**
 * 車載器およびエディタで共通利用する音声シーケンス再生管理クラス
 */
export class AudioPlayerService {
  private currentAudio: HTMLAudioElement | null = null;
  private muted: boolean = false;

  /**
   * 現在進行中の音声再生を即座に停止・破棄する
   */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.onended = null;
      this.currentAudio = null;
    }
  }

  /**
   * ミュート状態を更新し、再生中のAudio要素があれば即座に反映する
   * @param isMuted ミュートにする場合はtrue
   */
  setMuted(isMuted: boolean): void {
    this.muted = isMuted;
    if (this.currentAudio) {
      this.currentAudio.muted = isMuted;
    }
  }

  /**
   * 複数の音声URLを順番に連続再生する
   * @param urls 再生するObject URLの配列
   */
  playUrls(urls: string[]): void {
    this.stop();
    if (urls.length === 0) return;

    let idx = 0;
    const playNext = (): void => {
      if (idx >= urls.length) {
        this.currentAudio = null;
        return;
      }
      const audio = new Audio(urls[idx++]);
      audio.muted = this.muted;
      audio.onended = playNext;
      this.currentAudio = audio;
      audio.play().catch((err) => console.error("Audio Play Error:", err));
    };

    playNext();
  }

  /**
   * プリセット内の音声IDまたは音声グループIDを指定して再生を開始する
   * @param preset 対象のプリセット
   * @param audioUrls 音声ハッシュIDからObject URLへのマップ
   * @param targetId 再生対象の音声IDまたは "group:番号"
   * @returns 解決された先頭音声ファイル名（OBS同期トリガー用）
   */
  playFromPreset(
    preset: RoutePreset,
    audioUrls: Record<string, string>,
    targetId?: string,
  ): string {
    this.stop();
    const { urls, firstFileName } = PresetService.resolveAudioSequence(
      preset,
      audioUrls,
      targetId,
    );
    this.playUrls(urls);
    return firstFileName;
  }
}