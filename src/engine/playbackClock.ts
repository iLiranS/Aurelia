class PlaybackClock {
  private anchorSongSec: number = 0;
  private anchorPerfMs: number = 0;
  private isPlaying: boolean = false;
  private isWaiting: boolean = false;
  private isScrubbing: boolean = false;
  private tempoScale: number = 1.0;

  constructor() {
    this.anchorPerfMs = performance.now();
  }

  syncFromRust(songSec: number, isPlaying: boolean, tempoScale: number): void {
    if (this.isScrubbing) return;
    this.anchorSongSec = songSec;
    this.anchorPerfMs = performance.now();
    this.isPlaying = isPlaying;
    this.tempoScale = tempoScale;
  }

  setScrubbing(scrubbing: boolean): void {
    this.isScrubbing = scrubbing;
    this.anchorPerfMs = performance.now();
  }

  getIsScrubbing(): boolean {
    return this.isScrubbing;
  }

  setWaiting(waiting: boolean, songSec?: number): void {
    if (typeof songSec === "number") {
      this.anchorSongSec = songSec;
    }
    this.isWaiting = waiting;
    this.anchorPerfMs = performance.now();
  }

  seekLocal(songSec: number): void {
    this.anchorSongSec = songSec;
    this.anchorPerfMs = performance.now();
  }

  getTime(): number {
    if (!this.isPlaying || this.isWaiting || this.isScrubbing) {
      return this.anchorSongSec;
    }
    const elapsedSec = (performance.now() - this.anchorPerfMs) / 1000;
    return this.anchorSongSec + elapsedSec * this.tempoScale;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getTempoScale(): number {
    return this.tempoScale;
  }
}

export const playbackClock = new PlaybackClock();
