import { create } from "zustand";
import type { HandRole, TimeSignatureEvent } from "@/types/midi";
import {
  audioPlay,
  audioSetLiveVolume,
  audioSetSongVolume,
  setAppSetting,
} from "@/services/tauriApi";
import { countInEngine } from "@/engine/countIn";
import { playbackClock } from "@/engine/playbackClock";
import { useLibraryStore } from "@/stores/useLibraryStore";

let songVolumeSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let liveVolumeSaveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveSongVolume(volume: number) {
  if (songVolumeSaveTimeout) clearTimeout(songVolumeSaveTimeout);
  songVolumeSaveTimeout = setTimeout(() => {
    setAppSetting("song_volume_v1", String(volume)).catch(() => {});
  }, 300);
}

function debouncedSaveLiveVolume(volume: number) {
  if (liveVolumeSaveTimeout) clearTimeout(liveVolumeSaveTimeout);
  liveVolumeSaveTimeout = setTimeout(() => {
    setAppSetting("live_volume_v1", String(volume)).catch(() => {});
  }, 300);
}

interface PlaybackState {
  isPlaying: boolean;
  durationSec: number;
  initialBpm: number;
  tempoScale: number;
  transposeSemitones: number;
  songVolume: number;
  liveVolume: number;
  rightHandActive: boolean;
  leftHandActive: boolean;
  trackHands: Record<number, HandRole>;
  splitPointMidi: number;
  useSplitPoint: boolean;
  loopEnabled: boolean;
  loopStartSec: number | null;
  loopEndSec: number | null;
  displayTimeSec: number;
  muteInactiveHandAudio: boolean;
  studyMode: boolean;
  isWaitingForInput: boolean;
  countInBars: 0 | 1 | 2;
  countInBeat: { beat: number; totalRemaining: number; beatsPerBar: number } | null;

  setIsPlaying: (isPlaying: boolean) => void;
  setDurationSec: (durationSec: number) => void;
  setInitialBpm: (bpm: number) => void;
  setTempoScale: (scale: number) => void;
  setTransposeSemitones: (semitones: number) => void;
  setSongVolume: (volume: number) => void;
  hydrateSongVolume: (rawValue: string) => void;
  setLiveVolume: (volume: number) => void;
  hydrateLiveVolume: (rawValue: string) => void;
  setRightHandActive: (active: boolean) => void;
  setLeftHandActive: (active: boolean) => void;
  toggleRightHand: () => void;
  toggleLeftHand: () => void;
  setMuteInactiveHandAudio: (mute: boolean) => void;
  toggleMuteInactiveHandAudio: () => void;
  setStudyMode: (enabled: boolean) => void;
  toggleStudyMode: () => void;
  setIsWaitingForInput: (waiting: boolean) => void;
  setTrackHands: (mapping: Record<number, HandRole>) => void;
  setSplitPointMidi: (splitMidi: number) => void;
  setUseSplitPoint: (useSplit: boolean) => void;
  setLoopEnabled: (enabled: boolean) => void;
  toggleLoop: () => void;
  setLoopPoints: (start: number | null | undefined, end: number | null | undefined) => void;
  setDisplayTimeSec: (timeSec: number) => void;
  setCountInBars: (bars: 0 | 1 | 2) => void;
  hydrateCountInBars: (rawValue: string) => void;
  setCountInBeat: (
    beat: { beat: number; totalRemaining: number; beatsPerBar: number } | null
  ) => void;
  resetPlayback: () => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  isPlaying: false,
  durationSec: 0,
  initialBpm: 120,
  tempoScale: 1.0,
  transposeSemitones: 0,
  songVolume: 1.0,
  liveVolume: 1.0,
  rightHandActive: true,
  leftHandActive: true,
  trackHands: {},
  splitPointMidi: 60,
  useSplitPoint: false,
  loopEnabled: false,
  loopStartSec: null,
  loopEndSec: null,
  displayTimeSec: 0,
  muteInactiveHandAudio: false,
  studyMode: false,
  isWaitingForInput: false,
  countInBars: 0,
  countInBeat: null,

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setDurationSec: (durationSec) => set({ durationSec }),
  setInitialBpm: (initialBpm) => set({ initialBpm }),
  setTempoScale: (tempoScale) => set({ tempoScale }),
  setTransposeSemitones: (semitones) =>
    set({ transposeSemitones: Math.max(-12, Math.min(12, Math.round(semitones))) }),
  setSongVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set({ songVolume: clamped });
    debouncedSaveSongVolume(clamped);
  },
  hydrateSongVolume: (rawValue) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(1, parsed));
    set({ songVolume: clamped });
    audioSetSongVolume(clamped).catch(() => {});
  },
  setLiveVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set({ liveVolume: clamped });
    debouncedSaveLiveVolume(clamped);
  },
  hydrateLiveVolume: (rawValue) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(1, parsed));
    set({ liveVolume: clamped });
    audioSetLiveVolume(clamped).catch(() => {});
  },
  setRightHandActive: (rightHandActive) => set({ rightHandActive }),
  setLeftHandActive: (leftHandActive) => set({ leftHandActive }),
  toggleRightHand: () => set((state) => ({ rightHandActive: !state.rightHandActive })),
  toggleLeftHand: () => set((state) => ({ leftHandActive: !state.leftHandActive })),
  setMuteInactiveHandAudio: (muteInactiveHandAudio) => set({ muteInactiveHandAudio }),
  toggleMuteInactiveHandAudio: () =>
    set((state) => ({ muteInactiveHandAudio: !state.muteInactiveHandAudio })),
  setStudyMode: (studyMode) => set({ studyMode }),
  toggleStudyMode: () => set((state) => ({ studyMode: !state.studyMode })),
  setIsWaitingForInput: (isWaitingForInput) => set({ isWaitingForInput }),
  setTrackHands: (trackHands) => set({ trackHands }),
  setSplitPointMidi: (splitPointMidi) => set({ splitPointMidi }),
  setUseSplitPoint: (useSplitPoint) => set({ useSplitPoint }),
  setLoopEnabled: (loopEnabled) => set({ loopEnabled }),
  toggleLoop: () => set((state) => ({ loopEnabled: !state.loopEnabled })),
  setLoopPoints: (start, end) =>
    set({
      loopStartSec: typeof start === "number" ? start : null,
      loopEndSec: typeof end === "number" ? end : null,
    }),
  setDisplayTimeSec: (displayTimeSec) => set({ displayTimeSec }),
  setCountInBars: (countInBars) => {
    set({ countInBars });
    setAppSetting("count_in_bars_v1", String(countInBars)).catch(() => {});
  },
  hydrateCountInBars: (rawValue) => {
    const parsed = Number(rawValue);
    if (parsed === 0 || parsed === 1 || parsed === 2) {
      set({ countInBars: parsed });
    }
  },
  setCountInBeat: (countInBeat) => set({ countInBeat }),
  resetPlayback: () => {
    countInEngine.cancel();
    set({
      isPlaying: false,
      displayTimeSec: 0,
      loopEnabled: false,
      loopStartSec: null,
      loopEndSec: null,
      transposeSemitones: 0,
      countInBeat: null,
    });
  },
}));

function getBeatsPerBarAtTime(
  timeSignatures: TimeSignatureEvent[] | undefined,
  timeSec: number
): number {
  if (!timeSignatures || timeSignatures.length === 0) return 4;
  let active = timeSignatures[0];
  for (let i = 1; i < timeSignatures.length; i++) {
    if (timeSignatures[i].timeSec <= timeSec + 1e-4) {
      active = timeSignatures[i];
    } else {
      break;
    }
  }
  return Math.max(1, active.numerator);
}

export function cancelCountIn(): void {
  if (countInEngine.isActive()) {
    countInEngine.cancel();
  }
  if (usePlaybackStore.getState().countInBeat !== null) {
    usePlaybackStore.getState().setCountInBeat(null);
  }
}

export async function startPlaybackWithOptionalCountIn(
  barsOverride?: 1 | 2
): Promise<void> {
  if (countInEngine.isActive()) {
    cancelCountIn();
    return;
  }

  const state = usePlaybackStore.getState();
  const bars = barsOverride ?? state.countInBars;

  if (bars === 0) {
    state.setIsPlaying(true);
    playbackClock.syncFromRust(state.displayTimeSec, true, state.tempoScale);
    await audioPlay();
    return;
  }

  const activeSong = useLibraryStore.getState().activeSong;
  const currentSec = playbackClock.getTime();
  const beatsPerBar = getBeatsPerBarAtTime(activeSong?.timeSignatures, currentSec);
  const effectiveBpm = Math.max(30, Math.min(240, state.initialBpm * state.tempoScale));

  countInEngine.start({
    bars,
    beatsPerBar,
    effectiveBpm,
    onBeat: (beat, totalRemaining, bpb) => {
      usePlaybackStore.getState().setCountInBeat({
        beat,
        totalRemaining,
        beatsPerBar: bpb,
      });
    },
    onComplete: () => {
      const latest = usePlaybackStore.getState();
      latest.setCountInBeat(null);
      latest.setIsPlaying(true);
      playbackClock.syncFromRust(
        playbackClock.getTime(),
        true,
        latest.tempoScale
      );
      audioPlay().catch(() => {});
    },
    onCancel: () => {
      usePlaybackStore.getState().setCountInBeat(null);
    },
  });
}
