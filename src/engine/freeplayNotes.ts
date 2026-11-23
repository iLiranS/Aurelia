export interface FreeplayNote {
  id: number;
  midi: number;
  hand: 1 | 2;
  velocity: number; // normalized 0..1
  startSec: number; // monotonic seconds (performance.now() / 1000)
  endSec: number | null; // null while held; set on noteOff
}

export type FreeplayNoteListener = (note: FreeplayNote) => void;

export class FreeplayNotesBuffer {
  private active = false;
  private nextId = 1;
  private readonly notes: FreeplayNote[] = [];
  private readonly heldByMidi = new Map<number, FreeplayNote>();
  private readonly completedListeners = new Set<FreeplayNoteListener>();

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.clear();
  }

  isActive(): boolean {
    return this.active;
  }

  onNoteCompleted(listener: FreeplayNoteListener): () => void {
    this.completedListeners.add(listener);
    return () => {
      this.completedListeners.delete(listener);
    };
  }

  noteOn(midi: number, hand: 1 | 2, velocity: number, nowSec?: number): void {
    if (!this.active) return;
    if (midi < 21 || midi > 108) return;

    const now = nowSec ?? performance.now() / 1000;

    // Close any lingering held note on the same pitch before starting a new one
    const existing = this.heldByMidi.get(midi);
    if (existing) {
      this.finalizeNote(existing, now);
      this.heldByMidi.delete(midi);
    }

    const note: FreeplayNote = {
      id: this.nextId++,
      midi,
      hand,
      velocity,
      startSec: now,
      endSec: null,
    };

    this.notes.push(note);
    this.heldByMidi.set(midi, note);
  }

  noteOff(midi: number, nowSec?: number): void {
    const note = this.heldByMidi.get(midi);
    if (!note) return;

    const now = nowSec ?? performance.now() / 1000;
    this.heldByMidi.delete(midi);
    this.finalizeNote(note, now);
  }

  releaseAll(nowSec?: number): void {
    if (this.heldByMidi.size === 0) return;
    const now = nowSec ?? performance.now() / 1000;
    for (const note of this.heldByMidi.values()) {
      this.finalizeNote(note, now);
    }
    this.heldByMidi.clear();
  }

  clear(): void {
    this.notes.length = 0;
    this.heldByMidi.clear();
  }

  prune(cutoffSec: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.endSec === null || note.endSec >= cutoffSec) {
        if (writeIdx !== i) {
          this.notes[writeIdx] = note;
        }
        writeIdx++;
      }
    }
    this.notes.length = writeIdx;
  }

  getNotes(): readonly FreeplayNote[] {
    return this.notes;
  }

  private finalizeNote(note: FreeplayNote, now: number): void {
    note.endSec = Math.max(note.startSec, now);
    if (this.completedListeners.size > 0) {
      for (const listener of this.completedListeners) {
        listener(note);
      }
    }
  }
}

export const freeplayNotes = new FreeplayNotesBuffer();
