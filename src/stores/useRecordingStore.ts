import { create } from "zustand";
import { freeplayNotes } from "@/engine/freeplayNotes";
import { useMidiStore } from "@/stores/useMidiStore";

export const MAX_RECORDING_SEC = 1800; // 30 min safety cap
export const MAX_RECORDED_NOTES = 25_000;
const NEAR_LIMIT_RATIO = 0.9; // 27 min or 22,500 notes

export interface RecordedNoteEvent {
  midi: number;
  hand: 1 | 2;
  velocity: number; // 0..1
  startSec: number; // normalized relative to first note (0.0)
  endSec: number;
}

export interface RecordedSustainEvent {
  timeSec: number;
  value: number; // 0..127
}

export interface FinishedTake {
  notes: RecordedNoteEvent[];
  sustainEvents: RecordedSustainEvent[];
  durationSec: number;
  bpm: number;
  defaultTitle: string; // e.g. "Freeplay 2026-11-23 20-45"
  stoppedByLimit: boolean;
}

export type RecordingStatus = "idle" | "recording" | "review";

interface RecordingState {
  status: RecordingStatus;
  startedAtSec: number | null;
  noteCount: number;
  elapsedSec: number;
  isNearLimit: boolean;
  finishedTake: FinishedTake | null;

  startRecording: (bpm: number) => void;
  stopRecording: (stoppedByLimit?: boolean) => FinishedTake | null;
  discardTake: () => void;
  clearReview: () => void;
}

// Mutable buffers kept outside Zustand state to avoid re-renders on every note/pedal event
let rawNotes: RecordedNoteEvent[] = [];
let rawSustainEvents: RecordedSustainEvent[] = [];
let recordingBpm = 120;
let unsubNote: (() => void) | null = null;
let unsubSustain: (() => void) | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let isStopping = false;

function formatDefaultTitle(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `Freeplay ${yyyy}-${mm}-${dd} ${hh}-${min}`;
}

function cleanupListenersAndTimer(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  if (unsubNote) {
    unsubNote();
    unsubNote = null;
  }
  if (unsubSustain) {
    unsubSustain();
    unsubSustain = null;
  }
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: "idle",
  startedAtSec: null,
  noteCount: 0,
  elapsedSec: 0,
  isNearLimit: false,
  finishedTake: null,

  startRecording: (bpm) => {
    if (get().status === "recording") return;
    cleanupListenersAndTimer();

    rawNotes = [];
    rawSustainEvents = [];
    recordingBpm = Number.isFinite(bpm) ? Math.max(40, Math.min(240, bpm)) : 120;

    const nowSec = performance.now() / 1000;

    if (useMidiStore.getState().sustainDown) {
      rawSustainEvents.push({ timeSec: nowSec, value: 127 });
    }

    unsubNote = freeplayNotes.onNoteCompleted((note) => {
      if (note.endSec === null) return;
      if (rawNotes.length >= MAX_RECORDED_NOTES) return;

      rawNotes.push({
        midi: note.midi,
        hand: note.hand,
        velocity: note.velocity,
        startSec: note.startSec,
        endSec: note.endSec,
      });

      const nextCount = rawNotes.length;
      const started = get().startedAtSec ?? nowSec;
      const elapsed = Math.max(0, performance.now() / 1000 - started);
      const nearLimit =
        nextCount >= MAX_RECORDED_NOTES * NEAR_LIMIT_RATIO ||
        elapsed >= MAX_RECORDING_SEC * NEAR_LIMIT_RATIO;

      set({
        noteCount: nextCount,
        isNearLimit: nearLimit,
      });

      if (nextCount >= MAX_RECORDED_NOTES) {
        get().stopRecording(true);
      }
    });

    unsubSustain = freeplayNotes.onSustain((ev) => {
      rawSustainEvents.push({
        timeSec: ev.timeSec,
        value: ev.value,
      });
    });

    timerId = setInterval(() => {
      const state = get();
      if (state.status !== "recording" || state.startedAtSec === null) return;

      const elapsed = Math.max(0, performance.now() / 1000 - state.startedAtSec);
      const nearLimit =
        state.noteCount >= MAX_RECORDED_NOTES * NEAR_LIMIT_RATIO ||
        elapsed >= MAX_RECORDING_SEC * NEAR_LIMIT_RATIO;

      set({
        elapsedSec: elapsed,
        isNearLimit: nearLimit,
      });

      if (elapsed >= MAX_RECORDING_SEC) {
        get().stopRecording(true);
      }
    }, 250);

    set({
      status: "recording",
      startedAtSec: nowSec,
      noteCount: 0,
      elapsedSec: 0,
      isNearLimit: false,
      finishedTake: null,
    });
  },

  stopRecording: (stoppedByLimit = false) => {
    if (isStopping || get().status !== "recording") return null;
    isStopping = true;

    try {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }

      // Finalize any currently held keys so listeners receive their end timestamps
      freeplayNotes.releaseAll();

      cleanupListenersAndTimer();

      if (rawNotes.length === 0) {
        rawSustainEvents = [];
        set({
          status: "idle",
          startedAtSec: null,
          noteCount: 0,
          elapsedSec: 0,
          isNearLimit: false,
          finishedTake: null,
        });
        return null;
      }

      let originSec = rawNotes[0].startSec;
      for (let i = 1; i < rawNotes.length; i++) {
        if (rawNotes[i].startSec < originSec) {
          originSec = rawNotes[i].startSec;
        }
      }

      let maxEndSec = 0;
      const notes: RecordedNoteEvent[] = rawNotes.map((n) => {
        const startSec = Math.max(0, n.startSec - originSec);
        const endSec = Math.max(startSec, n.endSec - originSec);
        if (endSec > maxEndSec) {
          maxEndSec = endSec;
        }
        return {
          midi: n.midi,
          hand: n.hand,
          velocity: n.velocity,
          startSec,
          endSec,
        };
      });

      const sustainEvents: RecordedSustainEvent[] = rawSustainEvents.map((ev) => {
        const timeSec = Math.max(0, ev.timeSec - originSec);
        if (timeSec > maxEndSec) {
          maxEndSec = timeSec;
        }
        return {
          timeSec,
          value: ev.value,
        };
      });

      const take: FinishedTake = {
        notes,
        sustainEvents,
        durationSec: Math.max(0.1, maxEndSec),
        bpm: recordingBpm,
        defaultTitle: formatDefaultTitle(),
        stoppedByLimit,
      };

      rawNotes = [];
      rawSustainEvents = [];

      set({
        status: "review",
        startedAtSec: null,
        isNearLimit: false,
        finishedTake: take,
      });

      return take;
    } finally {
      isStopping = false;
    }
  },

  discardTake: () => {
    cleanupListenersAndTimer();
    rawNotes = [];
    rawSustainEvents = [];
    set({
      status: "idle",
      startedAtSec: null,
      noteCount: 0,
      elapsedSec: 0,
      isNearLimit: false,
      finishedTake: null,
    });
  },

  clearReview: () => {
    set({
      status: "idle",
      startedAtSec: null,
      noteCount: 0,
      elapsedSec: 0,
      isNearLimit: false,
      finishedTake: null,
    });
  },
}));
