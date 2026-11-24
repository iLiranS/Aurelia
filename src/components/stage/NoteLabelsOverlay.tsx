import React, { useEffect, useRef } from "react";
import { useThemeStore } from "@/stores/useThemeStore";
import { useViewStore } from "@/stores/useViewStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { playbackClock } from "@/engine/playbackClock";
import { freeplayNotes } from "@/engine/freeplayNotes";
import { getKeyByMidi, getNoteLetter, resolveNoteHand } from "@/engine/pianoLayout";
import type { MidiNote } from "@/types/midi";

function findStartIndex(notes: MidiNote[], targetSec: number): number {
  let low = 0;
  let high = notes.length - 1;
  let result = notes.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (notes[mid].startSec >= targetSec) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

const NoteLabelsCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    let dpr = window.devicePixelRatio || 1;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(canvas);

    let rafId = 0;

    const renderFrame = () => {
      rafId = requestAnimationFrame(renderFrame);

      if (cssW <= 0 || cssH <= 0) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const { lookaheadSec } = useThemeStore.getState();
      const pixelsPerSec = 82 / Math.max(0.5, lookaheadSec);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let lastFontSize = -1;
      let lastIsActive: boolean | null = null;

      const drawNoteLabel = (
        midi: number,
        visibleBottom: number,
        visibleTop: number,
        isHandActive: boolean
      ) => {
        const key = getKeyByMidi(midi);
        if (!key) return;

        const barX = (key.centerX / 52) * cssW;
        const barW = ((key.width * 0.88) / 52) * cssW;
        const barBottomPx = cssH * (1 - (visibleBottom - 18) / 82);
        const barTopPx = cssH * (1 - (visibleTop - 18) / 82);
        const barH = barBottomPx - barTopPx;

        if (barH < 16 || barW < 12) return;

        const fontSize = Math.min(11, Math.max(8, Math.floor(barW * 0.58)));
        if (fontSize !== lastFontSize) {
          ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          lastFontSize = fontSize;
        }

        if (isHandActive !== lastIsActive) {
          ctx.fillStyle = isHandActive
            ? "rgba(9, 9, 11, 0.86)"
            : "rgba(255, 255, 255, 0.45)";
          lastIsActive = isHandActive;
        }

        const textY =
          barH > 26 ? barBottomPx - 10 : (barTopPx + barBottomPx) * 0.5;
        ctx.fillText(getNoteLetter(midi), barX, textY);
      };

      const viewMode = useViewStore.getState().viewMode;
      if (viewMode === "freeplay") {
        const now = performance.now() / 1000;
        const liveNotes = freeplayNotes.getNotes();
        for (let i = 0; i < liveNotes.length; i++) {
          const note = liveNotes[i];
          const bottomY =
            note.endSec === null ? 18 : 18 + (now - note.endSec) * pixelsPerSec;
          const topY = 18 + (now - note.startSec) * pixelsPerSec;
          const visibleBottom = Math.max(18, bottomY);
          const visibleTop = Math.min(100, topY);
          if (visibleTop <= visibleBottom) continue;
          drawNoteLabel(note.midi, visibleBottom, visibleTop, true);
        }
        return;
      }

      if (viewMode !== "song") return;

      const activeSong = useLibraryStore.getState().activeSong;
      if (!activeSong || activeSong.notes.length === 0) return;

      const now = playbackClock.getTime();
      const {
        rightHandActive,
        leftHandActive,
        trackHands,
        splitPointMidi,
        useSplitPoint,
        transposeSemitones,
      } = usePlaybackStore.getState();

      const notes = activeSong.notes;
      const startIndex = findStartIndex(notes, Math.max(0, now - 20));

      for (let i = startIndex; i < notes.length; i++) {
        const note = notes[i];
        if (note.startSec > now + lookaheadSec) {
          break;
        }

        const noteEndSec = note.startSec + note.durationSec;
        if (noteEndSec < now) {
          continue;
        }

        const shiftedMidi = note.midi + transposeSemitones;
        if (shiftedMidi < 21 || shiftedMidi > 108) {
          continue;
        }

        const hand = resolveNoteHand(
          note,
          trackHands,
          splitPointMidi,
          useSplitPoint,
          shiftedMidi
        );
        if (hand === "none") {
          continue;
        }

        const bottomY = 18 + (note.startSec - now) * pixelsPerSec;
        const topY = 18 + (noteEndSec - now) * pixelsPerSec;
        const visibleBottom = Math.max(18, bottomY);
        const visibleTop = Math.min(100, topY);
        if (visibleTop <= visibleBottom) {
          continue;
        }

        const isHandActive =
          (hand === "right" && rightHandActive) ||
          (hand === "left" && leftHandActive);

        drawNoteLabel(shiftedMidi, visibleBottom, visibleTop, isHandActive);
      }
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 right-0 bottom-[18%] w-full h-[82%] pointer-events-none z-[6]"
    />
  );
};

export const NoteLabelsOverlay: React.FC = () => {
  const showNoteLabels = useThemeStore((s) => s.showNoteLabels);
  const viewMode = useViewStore((s) => s.viewMode);

  if (!showNoteLabels || (viewMode !== "song" && viewMode !== "freeplay")) {
    return null;
  }

  return <NoteLabelsCanvas />;
};
