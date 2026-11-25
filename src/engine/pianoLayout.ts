import type { HandRole, MidiNote } from "@/types/midi";

export interface KeyGeometry {
  midi: number;
  isBlack: boolean;
  whiteIndex: number; // 0..51 for white, -1 for black
  blackIndex: number; // 0..35 for black, -1 for white
  keyIndex: number;   // 0..87 (midi - 21)
  centerX: number;
  width: number;
  pitchClass: number; // 0..11 (0=C)
  octave: number;     // 0..8
  noteName: string;
}

export type NoteNamingSystem = "letter" | "solfege";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const LETTER_BASE = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];

const SOLFEGE_NAMES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const SOLFEGE_NAMES_SHARP = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const SOLFEGE_BASE = ["Do", "Do", "Re", "Re", "Mi", "Fa", "Fa", "Sol", "Sol", "La", "La", "Si"];

const IS_BLACK_PITCH_CLASS = [
  false, // 0: C
  true,  // 1: C#
  false, // 2: D
  true,  // 3: D#
  false, // 4: E
  false, // 5: F
  true,  // 6: F#
  false, // 7: G
  true,  // 8: G#
  false, // 9: A
  true,  // 10: A#
  false, // 11: B
];

function generatePianoKeys(): KeyGeometry[] {
  const keys: KeyGeometry[] = [];
  let currentWhiteIdx = 0;
  let currentBlackIdx = 0;

  for (let midi = 21; midi <= 108; midi++) {
    const pc = midi % 12;
    const isBlack = IS_BLACK_PITCH_CLASS[pc];
    const octave = Math.floor(midi / 12) - 1;
    const noteName = `${NOTE_NAMES[pc]}${octave}`;
    const keyIndex = midi - 21;

    if (!isBlack) {
      const whiteIndex = currentWhiteIdx;
      const centerX = whiteIndex + 0.5;
      const width = 0.94;

      keys.push({
        midi,
        isBlack: false,
        whiteIndex,
        blackIndex: -1,
        keyIndex,
        centerX,
        width,
        pitchClass: pc,
        octave,
        noteName,
      });

      currentWhiteIdx++;
    } else {
      const blackIndex = currentBlackIdx;
      const prevWhiteRight = currentWhiteIdx;
      const width = 0.62;

      // Authentic acoustic piano black key offsets relative to white key borders
      let offset = 0.0;
      switch (pc) {
        case 1: // C#
          offset = -0.04;
          break;
        case 3: // D#
          offset = 0.04;
          break;
        case 6: // F#
          offset = -0.05;
          break;
        case 8: // G#
          offset = 0.0;
          break;
        case 10: // A#
          offset = 0.05;
          break;
      }

      const centerX = prevWhiteRight + offset;

      keys.push({
        midi,
        isBlack: true,
        whiteIndex: -1,
        blackIndex,
        keyIndex,
        centerX,
        width,
        pitchClass: pc,
        octave,
        noteName,
      });

      currentBlackIdx++;
    }
  }

  return keys;
}

export const PIANO_KEYS: KeyGeometry[] = generatePianoKeys();

export const WHITE_KEYS: KeyGeometry[] = PIANO_KEYS.filter((k) => !k.isBlack);
export const BLACK_KEYS: KeyGeometry[] = PIANO_KEYS.filter((k) => k.isBlack);

// Quick lookup by midi (21..108)
export function getKeyByMidi(midi: number): KeyGeometry | undefined {
  if (midi < 21 || midi > 108) return undefined;
  return PIANO_KEYS[midi - 21];
}

export function getNoteBaseName(
  midi: number,
  naming: NoteNamingSystem = "letter"
): string {
  const pc = ((midi % 12) + 12) % 12;
  return naming === "solfege" ? SOLFEGE_BASE[pc] : LETTER_BASE[pc];
}

export function midiToNoteName(
  midi: number,
  naming: NoteNamingSystem = "letter"
): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const names = naming === "solfege" ? SOLFEGE_NAMES : NOTE_NAMES;
  return `${names[pc]}${octave}`;
}

export function getNoteLetter(
  midi: number,
  naming: NoteNamingSystem = "letter"
): string {
  const pc = ((midi % 12) + 12) % 12;
  const names = naming === "solfege" ? SOLFEGE_NAMES_SHARP : NOTE_NAMES_SHARP;
  return names[pc];
}

export function getKeyDisplayLabel(
  midi: number,
  naming: NoteNamingSystem = "letter"
): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return pc === 0
    ? `${getNoteBaseName(midi, naming)}${octave}`
    : getNoteLetter(midi, naming);
}

export function getKeySplitX(midi: number): number {
  const key = getKeyByMidi(midi);
  if (!key) return 23.0; // fallback to C4
  return key.isBlack ? key.centerX - key.width / 2 : key.whiteIndex;
}

export function getKeyLeftEdgeX(midi: number): number {
  const key = getKeyByMidi(midi);
  if (!key) return 0;
  return key.isBlack ? key.centerX - key.width / 2 : key.whiteIndex;
}

export function getKeyRightEdgeX(midi: number): number {
  const key = getKeyByMidi(midi);
  if (!key) return 52;
  return key.isBlack ? key.centerX + key.width / 2 : key.whiteIndex + 1;
}

/**
 * Compute world-X bounds for the active keyboard range [minMidi, maxMidi].
 * When a boundary falls on a white key adjacent to an out-of-range black key,
 * clamp inward to the black key's inner edge so the veil and bracket do not
 * bisect the out-of-range black key.
 */
export function getRangeBoundsX(
  minMidi: number,
  maxMidi: number
): { leftX: number; rightX: number } {
  let leftX = getKeyLeftEdgeX(minMidi);
  if (minMidi > 21) {
    const prevKey = getKeyByMidi(minMidi - 1);
    if (prevKey?.isBlack) {
      leftX = Math.max(leftX, prevKey.centerX + prevKey.width / 2);
    }
  }

  let rightX = getKeyRightEdgeX(maxMidi);
  if (maxMidi < 108) {
    const nextKey = getKeyByMidi(maxMidi + 1);
    if (nextKey?.isBlack) {
      rightX = Math.min(rightX, nextKey.centerX - nextKey.width / 2);
    }
  }

  return { leftX, rightX };
}

/**
 * Exact math hit-testing from normalized orthographic stage coordinates.
 * Stage dimensions: worldX in [0..52], relY in [0..1] where 0 is the hit-line (top of keys)
 * and 1 is the bottom of the keyboard. Black keys occupy the top 61% (relY <= 0.61).
 */
export function hitTestPianoKey(worldX: number, relY: number): KeyGeometry | null {
  if (worldX < 0 || worldX > 52 || relY < 0 || relY > 1) {
    return null;
  }

  // Black keys span top 61% (relY <= 0.61). Always check black keys first!
  if (relY <= 0.61) {
    for (let i = 0; i < BLACK_KEYS.length; i++) {
      const k = BLACK_KEYS[i];
      if (Math.abs(worldX - k.centerX) <= 0.34) {
        return k;
      }
    }
  }

  // Fallback to white keys across the full key height
  for (let i = 0; i < WHITE_KEYS.length; i++) {
    const k = WHITE_KEYS[i];
    if (Math.abs(worldX - k.centerX) <= 0.50) {
      return k;
    }
  }

  return null;
}

// Hand resolution logic
export function resolveNoteHand(
  note: MidiNote,
  trackHands: Record<number, HandRole>,
  splitPointMidi: number,
  useSplitPoint: boolean,
  effectiveMidi: number = note.midi
): "right" | "left" | "none" {
  if (useSplitPoint) {
    return effectiveMidi >= splitPointMidi ? "right" : "left";
  }

  const assigned = trackHands[note.trackIndex];
  if (assigned === "right") return "right";
  if (assigned === "left") return "left";
  if (assigned === "none") return "none";
  if (assigned === "both") {
    return effectiveMidi >= splitPointMidi ? "right" : "left";
  }

  return note.defaultHand === "left" ? "left" : "right";
}
