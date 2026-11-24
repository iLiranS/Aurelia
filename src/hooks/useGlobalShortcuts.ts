import { useEffect } from "react";
import { eventToBinding, type ShortcutActionId } from "@/types/shortcuts";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useRecordingStore } from "@/stores/useRecordingStore";
import { useThemeStore } from "@/stores/useThemeStore";
import { useMidiStore } from "@/stores/useMidiStore";
import { playbackClock } from "@/engine/playbackClock";
import { audioPlay, audioPause, audioSeek, audioSetVolume, audioStopPreview } from "@/services/tauriApi";
import { useViewStore } from "@/stores/useViewStore";
import { showVolumeToast } from "@/components/ui/toast";

const QWERTY_PIANO_CODES = [
  "KeyZ",
  "KeyS",
  "KeyX",
  "KeyD",
  "KeyC",
  "KeyV",
  "KeyG",
  "KeyB",
  "KeyH",
  "KeyN",
  "KeyJ",
  "KeyM",
  "KeyQ",
  "Digit2",
  "KeyW",
  "Digit3",
  "KeyE",
  "KeyR",
  "Digit5",
  "KeyT",
  "Digit6",
  "KeyY",
  "Digit7",
  "KeyU",
  "KeyI",
];

export function useGlobalShortcuts(): void {
  useEffect(() => {
    let scrubRafId: number | null = null;
    let scrubDirection: -1 | 1 | 0 = 0;
    let scrubBinding: string | null = null;
    let scrubStartMs = 0;
    let scrubLastFrameMs = 0;
    let scrubLastAudioSeekMs = 0;
    let scrubCurrentSec = 0;

    const stopScrub = () => {
      if (scrubRafId !== null) {
        cancelAnimationFrame(scrubRafId);
        scrubRafId = null;
      }
      if (scrubDirection !== 0) {
        const finalSec = scrubCurrentSec;
        scrubDirection = 0;
        scrubBinding = null;
        audioSeek(finalSec).catch(() => {});
      }
    };

    const stepScrub = (now: number) => {
      if (scrubDirection === 0) return;
      const state = usePlaybackStore.getState();
      const duration = state.durationSec;
      if (duration <= 0) {
        stopScrub();
        return;
      }

      const dtSec = Math.min(0.05, Math.max(0, (now - scrubLastFrameMs) / 1000));
      scrubLastFrameMs = now;

      // Smoothly ramp speed from fine control on tap to fast travel when held
      const heldSec = (now - scrubStartMs) / 1000;
      const ramp = Math.min(1, heldSec / 1.2);
      const minSpeed = Math.max(6, duration * 0.04);
      const maxSpeed = Math.max(22, duration * 0.16);
      const speed = minSpeed + (maxSpeed - minSpeed) * (ramp * ramp);

      scrubCurrentSec = Math.max(
        0,
        Math.min(duration, scrubCurrentSec + scrubDirection * speed * dtSec)
      );

      state.setDisplayTimeSec(scrubCurrentSec);
      playbackClock.seekLocal(scrubCurrentSec);

      if (now - scrubLastAudioSeekMs >= 55) {
        scrubLastAudioSeekMs = now;
        audioSeek(scrubCurrentSec).catch(() => {});
      }

      scrubRafId = requestAnimationFrame(stepScrub);
    };

    const startScrub = (direction: -1 | 1, binding: string) => {
      if (scrubDirection === direction) return;
      if (scrubDirection !== 0) {
        stopScrub();
      }
      const state = usePlaybackStore.getState();
      if (state.durationSec <= 0) return;

      scrubDirection = direction;
      scrubBinding = binding;
      scrubStartMs = performance.now();
      scrubLastFrameMs = scrubStartMs;
      scrubLastAudioSeekMs = 0;
      scrubCurrentSec = playbackClock.getTime();
      scrubRafId = requestAnimationFrame(stepScrub);
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const shortcutStore = useShortcutStore.getState();

      // Suspension Rule 1: A modal dialog is open (e.g. Shortcut Manager, Settings, Recording Review)
      if (
        shortcutStore.dialogOpen ||
        document.querySelector('[role="dialog"][aria-modal="true"]') !== null
      ) {
        return;
      }

      // Suspension Rule 2: Focus is inside an input, textarea, or contentEditable element
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Suspension Rule 3: QWERTY piano is on and user pressed an unmodified piano note key
      const qwertyPlayEnabled = useThemeStore.getState().qwertyPlayEnabled;
      if (
        qwertyPlayEnabled &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        QWERTY_PIANO_CODES.includes(e.code)
      ) {
        return;
      }

      const binding = eventToBinding(e);
      if (!binding) return;

      const bindings = shortcutStore.bindings;
      let matchedAction: ShortcutActionId | null = null;
      for (const [actionId, b] of Object.entries(bindings)) {
        if (b === binding) {
          matchedAction = actionId as ShortcutActionId;
          break;
        }
      }

      if (!matchedAction) return;

      const viewMode = useViewStore.getState().viewMode;
      const isSongOnlyAction =
        matchedAction.startsWith("playback.") ||
        matchedAction.startsWith("tempo.") ||
        matchedAction.startsWith("loop.") ||
        matchedAction.startsWith("hands.") ||
        matchedAction === "practice.studyMode";

      if (isSongOnlyAction && viewMode !== "song") {
        return;
      }

      if (matchedAction === "view.library" && viewMode === "home") {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const playback = usePlaybackStore.getState();
      const theme = useThemeStore.getState();

      switch (matchedAction) {
        case "playback.toggle": {
          const next = !playback.isPlaying;
          playback.setIsPlaying(next);
          playbackClock.syncFromRust(
            playback.displayTimeSec,
            next,
            playback.tempoScale
          );
          if (next) {
            await audioPlay();
          } else {
            await audioPause();
          }
          break;
        }

        case "playback.restart": {
          playback.setDisplayTimeSec(0);
          playbackClock.seekLocal(0);
          await audioSeek(0);
          break;
        }

        case "playback.seekBack": {
          if (!e.repeat) {
            startScrub(-1, binding);
          }
          break;
        }

        case "playback.seekForward": {
          if (!e.repeat) {
            startScrub(1, binding);
          }
          break;
        }

        case "audio.volumeUp": {
          const nextVol = Math.min(1, Math.round((playback.volume + 0.05) * 100) / 100);
          playback.setVolume(nextVol);
          showVolumeToast(nextVol);
          await audioSetVolume(nextVol).catch(() => {});
          break;
        }

        case "audio.volumeDown": {
          const nextVol = Math.max(0, Math.round((playback.volume - 0.05) * 100) / 100);
          playback.setVolume(nextVol);
          showVolumeToast(nextVol);
          await audioSetVolume(nextVol).catch(() => {});
          break;
        }

        case "tempo.down": {
          const nextScale = Math.max(
            0.25,
            Math.round((playback.tempoScale - 0.05) * 100) / 100
          );
          playback.setTempoScale(nextScale);
          playbackClock.syncFromRust(
            playback.displayTimeSec,
            playback.isPlaying,
            nextScale
          );
          break;
        }

        case "tempo.up": {
          const nextScale = Math.min(
            2.0,
            Math.round((playback.tempoScale + 0.05) * 100) / 100
          );
          playback.setTempoScale(nextScale);
          playbackClock.syncFromRust(
            playback.displayTimeSec,
            playback.isPlaying,
            nextScale
          );
          break;
        }

        case "loop.smart": {
          const now = playbackClock.getTime();
          const isSettingB =
            typeof playback.loopStartSec === "number" &&
            (playback.loopEndSec === null ||
              typeof playback.loopEndSec === "undefined");
          const hasLoop =
            typeof playback.loopStartSec === "number" &&
            typeof playback.loopEndSec === "number";

          if (!hasLoop && !isSettingB) {
            playback.setLoopPoints(now, null);
            playback.setLoopEnabled(false);
          } else if (isSettingB) {
            const start = Math.min(playback.loopStartSec!, now);
            const end = Math.max(playback.loopStartSec!, now);
            playback.setLoopPoints(start, end);
            playback.setLoopEnabled(true);
          } else if (hasLoop) {
            playback.toggleLoop();
          }
          break;
        }

        case "loop.clear": {
          playback.setLoopPoints(null, null);
          playback.setLoopEnabled(false);
          break;
        }

        case "loop.jumpToStart": {
          if (typeof playback.loopStartSec === "number") {
            const targetSec = Math.max(
              0,
              Math.min(playback.durationSec, playback.loopStartSec)
            );
            playback.setDisplayTimeSec(targetSec);
            playbackClock.seekLocal(targetSec);
            await audioSeek(targetSec);
          }
          break;
        }

        case "hands.toggleLeft": {
          playback.toggleLeftHand();
          break;
        }

        case "hands.toggleRight": {
          playback.toggleRightHand();
          break;
        }

        case "practice.studyMode": {
          playback.toggleStudyMode();
          break;
        }

        case "midi.octaveDown": {
          useMidiStore.getState().shiftOctave(-1);
          break;
        }

        case "midi.octaveUp": {
          useMidiStore.getState().shiftOctave(1);
          break;
        }

        case "view.library": {
          if (useRecordingStore.getState().status === "recording") {
            const take = useRecordingStore.getState().stopRecording(false);
            if (take) break;
          }
          const view = useViewStore.getState();
          await audioStopPreview().catch(() => {});
          if (view.viewMode !== "home") {
            if (playback.isPlaying) {
              playback.setIsPlaying(false);
              playbackClock.syncFromRust(
                playback.displayTimeSec,
                false,
                playback.tempoScale
              );
              await audioPause().catch(() => {});
            }
            view.setViewMode("home");
          }
          break;
        }

        case "view.freeplay": {
          const view = useViewStore.getState();
          await audioStopPreview().catch(() => {});
          if (view.viewMode !== "freeplay") {
            view.setViewMode("freeplay");
          } else {
            if (useRecordingStore.getState().status === "recording") {
              const take = useRecordingStore.getState().stopRecording(false);
              if (take) break;
            }
            view.setViewMode("home");
          }
          break;
        }

        case "view.focus": {
          theme.togglePerformanceMode();
          break;
        }

        case "app.shortcuts": {
          shortcutStore.setDialogOpen(true);
          break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (scrubDirection === 0 || !scrubBinding) return;
      const releasedBinding = eventToBinding(e);
      const baseKey = scrubBinding.split("+").pop();
      const releasedBase = releasedBinding?.split("+").pop();
      if (
        releasedBinding === scrubBinding ||
        (baseKey && releasedBase === baseKey)
      ) {
        stopScrub();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopScrub);
    return () => {
      stopScrub();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopScrub);
    };
  }, []);
}
