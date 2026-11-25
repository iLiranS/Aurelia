import React, { useEffect, useRef } from "react";
import { useThemeStore } from "@/stores/useThemeStore";
import { useViewStore } from "@/stores/useViewStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { playbackClock } from "@/engine/playbackClock";
import { freeplayNotes } from "@/engine/freeplayNotes";
import { getKeyByMidi, getNoteBaseName, resolveNoteHand } from "@/engine/pianoLayout";
import { getCachedMelodyMask } from "@/engine/melodyFilter";
import type { MidiNote } from "@/types/midi";

const IS_SHARP_PC = [false, true, false, true, false, false, true, false, true, false, true, false];

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
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
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

      const { lookaheadSec, noteNaming } = useThemeStore.getState();
      const pixelsPerSec = 82 / Math.max(0.5, lookaheadSec);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;

      let lastFont = "";
      const setFont = (font: string) => {
        if (font !== lastFont) {
          ctx.font = font;
          lastFont = font;
        }
      };

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

        if (barH < 15 || barW < 11) return;

        const pc = ((midi % 12) + 12) % 12;
        const label = getNoteBaseName(midi, noteNaming);
        const isSharp = IS_SHARP_PC[pc];

        const textY =
          barH > 26 ? barBottomPx - 11 : (barTopPx + barBottomPx) * 0.5;

        // Soft fade-in at the very top edge of the waterfall
        const topFade = Math.min(1, Math.max(0, textY / 28));
        if (topFade <= 0.02) return;

        const baseAlpha = (isHandActive ? 0.96 : 0.42) * topFade;
        const strokeAlpha = (isHandActive ? 0.45 : 0.22) * topFade;

        ctx.fillStyle = `rgba(255, 255, 255, ${baseAlpha.toFixed(3)})`;
        ctx.strokeStyle = `rgba(9, 9, 11, ${strokeAlpha.toFixed(3)})`;
        ctx.lineWidth = isSharp ? 2.0 : 2.4;

        if (!isSharp) {
          const fontSize =
            noteNaming === "solfege"
              ? Math.min(10, Math.max(7, Math.floor(barW * (label.length >= 3 ? 0.34 : 0.44))))
              : Math.min(12, Math.max(8.5, Math.floor(barW * 0.56)));
          setFont(`700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`);
          ctx.strokeText(label, barX, textY);
          ctx.fillText(label, barX, textY);
        } else {
          // Syllable/letter + crisp raised superscript # matching the black piano key labels
          const letterSize =
            noteNaming === "solfege"
              ? Math.min(8.5, Math.max(6.5, Math.floor(barW * (label.length >= 3 ? 0.28 : 0.36))))
              : Math.min(10, Math.max(8, Math.floor(barW * 0.54)));
          const sharpSize =
            noteNaming === "solfege"
              ? Math.max(5.5, Math.round(letterSize * 0.72))
              : Math.max(6.5, Math.round(letterSize * 0.74));
          const sharpOffsetY = -letterSize * 0.16;

          setFont(`700 ${letterSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`);
          if (noteNaming === "solfege") {
            const labelW = ctx.measureText(label).width;
            const labelX = barX - sharpSize * 0.28;
            const sharpX = barX + labelW * 0.5 + sharpSize * 0.08;
            ctx.strokeText(label, labelX, textY);
            ctx.fillText(label, labelX, textY);

            setFont(`700 ${sharpSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`);
            ctx.strokeText("#", sharpX, textY + sharpOffsetY);
            ctx.fillText("#", sharpX, textY + sharpOffsetY);
          } else {
            const letterOffsetX = -sharpSize * 0.34;
            const sharpOffsetX = letterSize * 0.42;
            ctx.strokeText(label, barX + letterOffsetX, textY);
            ctx.fillText(label, barX + letterOffsetX, textY);

            setFont(`700 ${sharpSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`);
            ctx.strokeText("#", barX + sharpOffsetX, textY + sharpOffsetY);
            ctx.fillText("#", barX + sharpOffsetX, textY + sharpOffsetY);
          }
        }
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
        melodyOnly,
        trackHands,
        splitPointMidi,
        useSplitPoint,
        transposeSemitones,
      } = usePlaybackStore.getState();

      const notes = activeSong.notes;
      const effectiveMelodyOnly = melodyOnly && rightHandActive && !leftHandActive;
      const melodyMask = effectiveMelodyOnly
        ? getCachedMelodyMask(
            notes,
            rightHandActive,
            leftHandActive,
            trackHands,
            splitPointMidi,
            useSplitPoint,
            transposeSemitones
          )
        : null;
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
        const isNoteFocused =
          isHandActive && (!melodyMask || melodyMask[i] === 1);

        drawNoteLabel(shiftedMidi, visibleBottom, visibleTop, isNoteFocused);
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
