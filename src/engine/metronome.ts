export type BeatsPerBar = 2 | 3 | 4 | 6;

export interface MetronomeConfig {
  bpm: number;
  beatsPerBar: BeatsPerBar;
  volume: number; // 0..1
}

export type BeatListener = (beatIndex: number, isAccent: boolean) => void;
export type StatusListener = (running: boolean) => void;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private running = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private currentBeat = 0;
  private pendingUiTimers = new Set<ReturnType<typeof setTimeout>>();

  private config: MetronomeConfig = {
    bpm: 100,
    beatsPerBar: 4,
    volume: 0.55,
  };

  private readonly beatListeners = new Set<BeatListener>();
  private readonly statusListeners = new Set<StatusListener>();

  getConfig(): MetronomeConfig {
    return { ...this.config };
  }

  isRunning(): boolean {
    return this.running;
  }

  setConfig(partial: Partial<MetronomeConfig>): void {
    if (partial.bpm !== undefined && Number.isFinite(partial.bpm)) {
      this.config.bpm = Math.max(40, Math.min(200, Math.round(partial.bpm)));
    }
    if (partial.beatsPerBar !== undefined) {
      this.config.beatsPerBar = partial.beatsPerBar;
      if (this.currentBeat >= this.config.beatsPerBar) {
        this.currentBeat = 0;
      }
    }
    if (partial.volume !== undefined && Number.isFinite(partial.volume)) {
      this.config.volume = Math.max(0, Math.min(1, partial.volume));
    }
  }

  onBeat(listener: BeatListener): () => void {
    this.beatListeners.add(listener);
    return () => {
      this.beatListeners.delete(listener);
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) return;
    if (typeof window === "undefined") return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }

    this.running = true;
    this.currentBeat = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.03;

    this.schedulerTick();
    this.timerId = setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);

    for (const listener of this.statusListeners) {
      listener(true);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    for (const id of this.pendingUiTimers) {
      clearTimeout(id);
    }
    this.pendingUiTimers.clear();

    for (const listener of this.statusListeners) {
      listener(false);
    }
  }

  toggle(): boolean {
    if (this.running) {
      this.stop();
    } else {
      this.start();
    }
    return this.running;
  }

  private schedulerTick(): void {
    if (!this.running || !this.ctx) return;

    const ctx = this.ctx;
    while (this.nextBeatTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const isAccent = this.currentBeat === 0;
      const beatSnap = this.currentBeat;
      const scheduledTime = this.nextBeatTime;

      this.scheduleClick(ctx, scheduledTime, isAccent);

      const delayMs = Math.max(0, (scheduledTime - ctx.currentTime) * 1000);
      const uiTimer = setTimeout(() => {
        this.pendingUiTimers.delete(uiTimer);
        if (!this.running) return;
        this.emitBeat(beatSnap, isAccent);
      }, delayMs);
      this.pendingUiTimers.add(uiTimer);

      this.nextBeatTime += 60.0 / this.config.bpm;
      this.currentBeat = (this.currentBeat + 1) % this.config.beatsPerBar;
    }
  }

  private scheduleClick(ctx: AudioContext, time: number, isAccent: boolean): void {
    if (this.config.volume <= 0.001) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(isAccent ? 1200 : 880, time);

    const peakGain = Math.max(0.0001, this.config.volume * (isAccent ? 0.55 : 0.35));
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.028);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + 0.032);
  }

  private emitBeat(beatIndex: number, isAccent: boolean): void {
    for (const listener of this.beatListeners) {
      listener(beatIndex, isAccent);
    }
  }
}

export const metronomeEngine = new MetronomeEngine();
