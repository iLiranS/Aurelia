import { create } from "zustand";
import type { HandRole } from "@/types/midi";
import { audioSetVolume, setAppSetting } from "@/services/tauriApi";

let volumeSaveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveVolume(volume: number) {
  if (volumeSaveTimeout) clearTimeout(volumeSaveTimeout);
  volumeSaveTimeout = setTimeout(() => {
    setAppSetting("master_volume_v1", String(volume)).catch(() => {});
  }, 300);
}

interface PlaybackState {
  isPlaying: boolean;
  durationSec: number;
  initialBpm: number;
  tempoScale: number;
  volume: number;
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

  setIsPlaying: (isPlaying: boolean) => void;
  setDurationSec: (durationSec: number) => void;
  setInitialBpm: (bpm: number) => void;
  setTempoScale: (scale: number) => void;
  setVolume: (volume: number) => void;
  hydrateVolume: (rawValue: string) => void;
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
  resetPlayback: () => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  isPlaying: false,
  durationSec: 0,
  initialBpm: 120,
  tempoScale: 1.0,
  volume: 0.85,
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

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setDurationSec: (durationSec) => set({ durationSec }),
  setInitialBpm: (initialBpm) => set({ initialBpm }),
  setTempoScale: (tempoScale) => set({ tempoScale }),
  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set({ volume: clamped });
    debouncedSaveVolume(clamped);
  },
  hydrateVolume: (rawValue) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(1, parsed));
    set({ volume: clamped });
    audioSetVolume(clamped).catch(() => {});
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
  resetPlayback: () =>
    set({
      isPlaying: false,
      displayTimeSec: 0,
      loopEnabled: false,
      loopStartSec: null,
      loopEndSec: null,
    }),
}));
