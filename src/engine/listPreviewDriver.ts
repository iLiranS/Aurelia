import type { CompactNote } from "@/engine/previewCache";
import { activeNotes } from "@/engine/activeNotes";

export interface ListPreviewSession {
  contentHash: string;
  notes: CompactNote[]; // sorted by startMs ascending: [midi, startMs, durMs, hand]
  startSec: number;
  durationSec: number;
  startedAtPerfMs: number;
}

class ListPreviewManager {
  session: ListPreviewSession | null = null;

  start(contentHash: string, notes: CompactNote[], startSec: number, durationSec: number): void {
    this.session = {
      contentHash,
      notes,
      startSec,
      durationSec,
      startedAtPerfMs: performance.now(),
    };
  }

  stop(onlyIfHash?: string): void {
    if (onlyIfHash && this.session?.contentHash !== onlyIfHash) return;
    this.session = null;
    activeNotes.clearSong();
  }
}

export const listPreviewManager = new ListPreviewManager();
