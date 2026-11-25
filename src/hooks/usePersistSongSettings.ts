import { useEffect, useRef } from "react";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import {
  saveSongSettings,
  audioSetTempo,
  audioSetLoop,
  audioSetHandFilters,
  audioSetStudyMode,
  audioSetTranspose,
} from "@/services/tauriApi";
import { activeNotes } from "@/engine/activeNotes";
import { playbackClock } from "@/engine/playbackClock";
import type { SongSettings } from "@/types/midi";

export function usePersistSongSettings(): void {
  const activeSong = useLibraryStore((s) => s.activeSong);

  const tempoScale = usePlaybackStore((s) => s.tempoScale);
  const transposeSemitones = usePlaybackStore((s) => s.transposeSemitones);
  const countInBars = usePlaybackStore((s) => s.countInBars);
  const loopEnabled = usePlaybackStore((s) => s.loopEnabled);
  const loopStartSec = usePlaybackStore((s) => s.loopStartSec);
  const loopEndSec = usePlaybackStore((s) => s.loopEndSec);
  const rightHandActive = usePlaybackStore((s) => s.rightHandActive);
  const leftHandActive = usePlaybackStore((s) => s.leftHandActive);
  const studyMode = usePlaybackStore((s) => s.studyMode);
  const melodyOnly = usePlaybackStore((s) => s.melodyOnly);
  const muteInactiveHandAudio = usePlaybackStore((s) => s.muteInactiveHandAudio);
  const trackHands = usePlaybackStore((s) => s.trackHands);
  const splitPointMidi = usePlaybackStore((s) => s.splitPointMidi);
  const useSplitPoint = usePlaybackStore((s) => s.useSplitPoint);

  const lastSongHashRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersistRef = useRef(false);

  // When activeSong changes (new song loaded), skip saving the initial loaded state
  useEffect(() => {
    if (activeSong && activeSong.contentHash !== lastSongHashRef.current) {
      lastSongHashRef.current = activeSong.contentHash;
      skipNextPersistRef.current = true;
      activeNotes.clearWaiting();
      playbackClock.setWaiting(false);
      usePlaybackStore.getState().setIsWaitingForInput(false);
    }
  }, [activeSong]);

  // Sync Study Mode & Melody Only state immediately to Rust audio engine
  useEffect(() => {
    if (!activeSong) return;
    const effectiveMelodyOnly = melodyOnly && rightHandActive && !leftHandActive;
    const muteHarmonyAudio = effectiveMelodyOnly && muteInactiveHandAudio;
    audioSetStudyMode(
      studyMode,
      rightHandActive,
      leftHandActive,
      effectiveMelodyOnly,
      muteHarmonyAudio
    );
    if (!studyMode) {
      activeNotes.clearWaiting();
      playbackClock.setWaiting(false);
      usePlaybackStore.getState().setIsWaitingForInput(false);
    }
  }, [activeSong, studyMode, rightHandActive, leftHandActive, melodyOnly, muteInactiveHandAudio]);

  // Handle immediate audio sync and debounced SQLite persistence on user change
  useEffect(() => {
    if (!activeSong) return;

    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    // 1. Immediate sync to Rust audio engine
    const rightAudioEnabled = muteInactiveHandAudio ? rightHandActive : true;
    const leftAudioEnabled = muteInactiveHandAudio ? leftHandActive : true;

    audioSetTempo(tempoScale);
    audioSetTranspose(transposeSemitones);
    audioSetLoop(loopEnabled, loopStartSec, loopEndSec, countInBars > 0);
    audioSetHandFilters(
      rightAudioEnabled,
      leftAudioEnabled,
      trackHands,
      splitPointMidi,
      useSplitPoint
    );

    // 2. Debounced save to SQLite database
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const currentHash = activeSong.contentHash;
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const settings: SongSettings = {
          contentHash: currentHash,
          trackHands,
          splitPointMidi,
          useSplitPoint,
          tempoScale,
          loopEnabled,
          loopStartSec,
          loopEndSec,
          transposeSemitones,
        };
        await saveSongSettings(settings);
      } catch (err) {
        console.error("Failed to persist song settings to SQLite:", err);
      }
    }, 400);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    activeSong,
    tempoScale,
    transposeSemitones,
    countInBars,
    loopEnabled,
    loopStartSec,
    loopEndSec,
    rightHandActive,
    leftHandActive,
    muteInactiveHandAudio,
    trackHands,
    splitPointMidi,
    useSplitPoint,
  ]);
}
