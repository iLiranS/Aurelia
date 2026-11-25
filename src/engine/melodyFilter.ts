import { resolveNoteHand } from "@/engine/pianoLayout";
import type { HandRole, MidiNote } from "@/types/midi";

export const MELODY_CHORD_WINDOW_SEC = 0.045;

/**
 * Computes a per-note mask (1 = top melody note in its 45 ms chord window, 0 = dimmed harmony/inactive).
 * Expects `notes` sorted by `startSec` ascending (as produced by the Rust MIDI parser).
 */
export function computeMelodyMask(
  notes: MidiNote[],
  rightHandActive: boolean,
  leftHandActive: boolean,
  trackHands: Record<number, HandRole>,
  splitPointMidi: number,
  useSplitPoint: boolean,
  transposeSemitones: number
): Uint8Array {
  const mask = new Uint8Array(notes.length);
  if (!rightHandActive && !leftHandActive) {
    return mask;
  }

  let i = 0;
  while (i < notes.length) {
    const first = notes[i];
    const firstMidi = first.midi + transposeSemitones;
    if (firstMidi < 21 || firstMidi > 108) {
      i++;
      continue;
    }

    const firstHand = resolveNoteHand(
      first,
      trackHands,
      splitPointMidi,
      useSplitPoint,
      firstMidi
    );
    const firstActive =
      (firstHand === "right" && rightHandActive) ||
      (firstHand === "left" && leftHandActive);

    if (!firstActive) {
      i++;
      continue;
    }

    const groupEndSec = first.startSec + MELODY_CHORD_WINDOW_SEC;
    let maxMidi = firstMidi;
    let j = i + 1;

    while (j < notes.length && notes[j].startSec <= groupEndSec) {
      const candidate = notes[j];
      const candMidi = candidate.midi + transposeSemitones;
      if (candMidi >= 21 && candMidi <= 108) {
        const candHand = resolveNoteHand(
          candidate,
          trackHands,
          splitPointMidi,
          useSplitPoint,
          candMidi
        );
        const candActive =
          (candHand === "right" && rightHandActive) ||
          (candHand === "left" && leftHandActive);
        if (candActive && candMidi > maxMidi) {
          maxMidi = candMidi;
        }
      }
      j++;
    }

    for (let k = i; k < j; k++) {
      const n = notes[k];
      const shifted = n.midi + transposeSemitones;
      if (shifted < 21 || shifted > 108 || shifted !== maxMidi) {
        continue;
      }
      const hand = resolveNoteHand(
        n,
        trackHands,
        splitPointMidi,
        useSplitPoint,
        shifted
      );
      if (
        (hand === "right" && rightHandActive) ||
        (hand === "left" && leftHandActive)
      ) {
        mask[k] = 1;
      }
    }

    i = j;
  }

  return mask;
}

interface MelodyMaskCache {
  notes: MidiNote[];
  rightHandActive: boolean;
  leftHandActive: boolean;
  trackHands: Record<number, HandRole>;
  splitPointMidi: number;
  useSplitPoint: boolean;
  transposeSemitones: number;
  mask: Uint8Array;
}

let cached: MelodyMaskCache | null = null;

/**
 * Returns a cached per-note melody mask shared across renderers with zero per-frame allocation.
 */
export function getCachedMelodyMask(
  notes: MidiNote[],
  rightHandActive: boolean,
  leftHandActive: boolean,
  trackHands: Record<number, HandRole>,
  splitPointMidi: number,
  useSplitPoint: boolean,
  transposeSemitones: number
): Uint8Array {
  if (
    cached &&
    cached.notes === notes &&
    cached.rightHandActive === rightHandActive &&
    cached.leftHandActive === leftHandActive &&
    cached.trackHands === trackHands &&
    cached.splitPointMidi === splitPointMidi &&
    cached.useSplitPoint === useSplitPoint &&
    cached.transposeSemitones === transposeSemitones
  ) {
    return cached.mask;
  }

  const mask = computeMelodyMask(
    notes,
    rightHandActive,
    leftHandActive,
    trackHands,
    splitPointMidi,
    useSplitPoint,
    transposeSemitones
  );

  cached = {
    notes,
    rightHandActive,
    leftHandActive,
    trackHands,
    splitPointMidi,
    useSplitPoint,
    transposeSemitones,
    mask,
  };

  return mask;
}
