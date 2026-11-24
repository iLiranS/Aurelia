export interface CountInOptions {
  bars: 1 | 2;
  beatsPerBar: number;
  effectiveBpm: number;
  volume?: number;
  onBeat: (beatInBar: number, totalRemaining: number, beatsPerBar: number) => void;
  onComplete: () => void;
  onCancel?: () => void;
}

class CountInEngine {
  private ctx: AudioContext | null = null;
  private active = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private activeOscs: OscillatorNode[] = [];
  private currentOnCancel: (() => void) | undefined;

  isActive(): boolean {
    return this.active;
  }

  cancel(): void {
    if (!this.active) return;
    this.active = false;

    for (const id of this.timers) {
      clearTimeout(id);
    }
    this.timers = [];

    for (const osc of this.activeOscs) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Already stopped
      }
    }
    this.activeOscs = [];

    const onCancel = this.currentOnCancel;
    this.currentOnCancel = undefined;
    onCancel?.();
  }

  start(opts: CountInOptions): void {
    if (this.active) {
      this.cancel();
    }
    if (typeof window === "undefined") {
      opts.onComplete();
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      opts.onComplete();
      return;
    }

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    const ctx = this.ctx;
    const beatsPerBar = Math.max(1, Math.min(12, Math.round(opts.beatsPerBar)));
    const totalBeats = opts.bars * beatsPerBar;
    const safeBpm = Math.max(30, Math.min(240, opts.effectiveBpm));
    const beatIntervalSec = 60.0 / safeBpm;
    const volume = opts.volume ?? 0.65;
    const t0 = ctx.currentTime + 0.03;

    this.active = true;
    this.currentOnCancel = opts.onCancel;

    for (let i = 0; i < totalBeats; i++) {
      const clickTime = t0 + i * beatIntervalSec;
      const beatInBar = (i % beatsPerBar) + 1;
      const isAccent = beatInBar === 1;
      const totalRemaining = totalBeats - i;

      this.scheduleClick(ctx, clickTime, isAccent, volume);

      const delayMs = Math.max(0, (clickTime - ctx.currentTime) * 1000);
      const timer = setTimeout(() => {
        if (!this.active) return;
        opts.onBeat(beatInBar, totalRemaining, beatsPerBar);
      }, delayMs);
      this.timers.push(timer);
    }

    const completeDelayMs = Math.max(
      0,
      (t0 + totalBeats * beatIntervalSec - ctx.currentTime) * 1000
    );
    const completeTimer = setTimeout(() => {
      if (!this.active) return;
      this.active = false;
      this.timers = [];
      this.activeOscs = [];
      this.currentOnCancel = undefined;
      opts.onComplete();
    }, completeDelayMs);
    this.timers.push(completeTimer);
  }

  private scheduleClick(
    ctx: AudioContext,
    time: number,
    isAccent: boolean,
    volume: number
  ): void {
    if (volume <= 0.001) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(isAccent ? 1200 : 880, time);

    const peakGain = Math.max(0.0001, volume * (isAccent ? 0.55 : 0.35));
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.028);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + 0.032);
    this.activeOscs.push(osc);
    osc.onended = () => {
      const idx = this.activeOscs.indexOf(osc);
      if (idx >= 0) this.activeOscs.splice(idx, 1);
    };
  }
}

export const countInEngine = new CountInEngine();
