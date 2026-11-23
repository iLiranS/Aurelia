import React from "react";
import { useFrame } from "@react-three/fiber";
import { useViewStore } from "@/stores/useViewStore";
import { listPreviewManager } from "@/engine/listPreviewDriver";
import { activeNotes } from "@/engine/activeNotes";
import type { CompactNote } from "@/engine/previewCache";

function findStartIdx(notes: CompactNote[], minMs: number): number {
  let low = 0;
  let high = notes.length - 1;
  let result = 0;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (notes[mid][1] >= minMs) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

export const ListPreviewDriver: React.FC = () => {
  useFrame(() => {
    const viewMode = useViewStore.getState().viewMode;
    if (viewMode !== "home") return;

    const session = listPreviewManager.session;
    activeNotes.clearSong();

    if (!session) return;

    const nowSec = session.startSec + (performance.now() - session.startedAtPerfMs) / 1000;
    if (nowSec >= session.durationSec) {
      listPreviewManager.stop(session.contentHash);
      return;
    }

    const nowMs = nowSec * 1000;
    // Look back up to 8000ms for long sustained notes
    const startIdx = findStartIdx(session.notes, nowMs - 8000);

    for (let i = startIdx; i < session.notes.length; i++) {
      const [midi, startMs, durMs, hand] = session.notes[i];
      if (startMs > nowMs) {
        break;
      }
      if (startMs <= nowMs && startMs + durMs >= nowMs) {
        const keyIdx = midi - 21;
        if (keyIdx >= 0 && keyIdx < 88) {
          activeNotes.songHand[keyIdx] = hand === 2 ? 2 : 1;
          activeNotes.songVelocity[keyIdx] = 0.8;
        }
      }
    }
  });

  return null;
};
