import { useEffect, useRef } from "react";
import { useThemeStore } from "@/stores/useThemeStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { activeNotes } from "@/engine/activeNotes";
import { audioLiveNoteOn, audioLiveNoteOff, audioLiveAllNotesOff } from "@/services/tauriApi";

// 2-Octave Computer Keyboard Piano Mapping (C3 to C5)
// Lower Octave: C3 to B3 (Z, S, X, D, C, V, G, B, H, N, J, M)
// Upper Octave: C4 to C5 (Q, 2, W, 3, E, R, 5, T, 6, Y, 7, U, I)
const QWERTY_TO_MIDI: Record<string, number> = {
  // Lower Octave (C3 - B3: MIDI 48 - 59)
  KeyZ: 48, // C3
  KeyS: 49, // C#3
  KeyX: 50, // D3
  KeyD: 51, // D#3
  KeyC: 52, // E3
  KeyV: 53, // F3
  KeyG: 54, // F#3
  KeyB: 55, // G3
  KeyH: 56, // G#3
  KeyN: 57, // A3
  KeyJ: 58, // A#3
  KeyM: 59, // B3

  // Upper Octave (C4 - C5: MIDI 60 - 72)
  KeyQ: 60, // C4 (Middle C)
  Digit2: 61, // C#4
  KeyW: 62, // D4
  Digit3: 63, // D#4
  KeyE: 64, // E4
  KeyR: 65, // F4
  Digit5: 66, // F#4
  KeyT: 67, // G4
  Digit6: 68, // G#4
  KeyY: 69, // A4
  Digit7: 70, // A#4
  KeyU: 71, // B4
  KeyI: 72, // C5
};

export function useQwertyPiano(): void {
  const qwertyPlayEnabled = useThemeStore((s) => s.qwertyPlayEnabled);
  const activeKeysRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!qwertyPlayEnabled) {
      // If toggled off while keys are held down, release everything
      if (activeKeysRef.current.size > 0) {
        for (const midi of activeKeysRef.current.values()) {
          activeNotes.clearLiveNote(midi);
        }
        activeKeysRef.current.clear();
        audioLiveAllNotesOff();
      }
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

      // Don't intercept typing in inputs or textareas
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const midi = QWERTY_TO_MIDI[e.code];
      if (midi === undefined) return;

      if (activeKeysRef.current.has(e.code)) return;

      e.preventDefault();
      activeKeysRef.current.set(e.code, midi);

      const splitPointMidi = usePlaybackStore.getState().splitPointMidi;
      const hand: 1 | 2 = midi >= splitPointMidi ? 1 : 2;
      const velocity = 95;

      activeNotes.setLiveNote(midi, hand, velocity / 127);
      audioLiveNoteOn(midi, velocity);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const midi = activeKeysRef.current.get(e.code);
      if (midi === undefined) return;

      e.preventDefault();
      activeKeysRef.current.delete(e.code);

      activeNotes.clearLiveNote(midi);
      audioLiveNoteOff(midi);
    };

    const handleBlur = () => {
      if (activeKeysRef.current.size > 0) {
        for (const midi of activeKeysRef.current.values()) {
          activeNotes.clearLiveNote(midi);
        }
        activeKeysRef.current.clear();
        audioLiveAllNotesOff();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);

      if (activeKeysRef.current.size > 0) {
        for (const midi of activeKeysRef.current.values()) {
          activeNotes.clearLiveNote(midi);
        }
        activeKeysRef.current.clear();
        audioLiveAllNotesOff();
      }
    };
  }, [qwertyPlayEnabled]);
}
