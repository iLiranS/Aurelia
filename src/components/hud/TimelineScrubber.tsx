import React, { useRef, useState } from "react";
import { usePlaybackStore, cancelCountIn } from "@/stores/usePlaybackStore";
import { playbackClock } from "@/engine/playbackClock";
import { audioSeek } from "@/services/tauriApi";

function formatSec(sec: number): string {
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TimelineScrubber: React.FC = () => {
  const durationSec = usePlaybackStore((s) => s.durationSec);
  const displayTimeSec = usePlaybackStore((s) => s.displayTimeSec);
  const setDisplayTimeSec = usePlaybackStore((s) => s.setDisplayTimeSec);

  const loopEnabled = usePlaybackStore((s) => s.loopEnabled);
  const loopStartSec = usePlaybackStore((s) => s.loopStartSec);
  const loopEndSec = usePlaybackStore((s) => s.loopEndSec);
  const setLoopPoints = usePlaybackStore((s) => s.setLoopPoints);

  const barRef = useRef<HTMLDivElement>(null);
  const isDraggingBarRef = useRef(false);
  const isDraggingARef = useRef(false);
  const isDraggingBRef = useRef(false);

  const [activeDrag, setActiveDrag] = useState<"A" | "B" | null>(null);

  // Seek main track position
  const seekToClientX = (clientX: number) => {
    if (!barRef.current || durationSec <= 0) return;
    cancelCountIn();
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetSec = pct * durationSec;

    setDisplayTimeSec(targetSec);
    playbackClock.seekLocal(targetSec);
    audioSeek(targetSec);
  };

  const handleBarPointerDown = (e: React.PointerEvent) => {
    // If dragging a pin, ignore bar click
    if (isDraggingARef.current || isDraggingBRef.current) return;
    isDraggingBarRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  };

  const handleBarPointerMove = (e: React.PointerEvent) => {
    if (isDraggingBarRef.current) {
      seekToClientX(e.clientX);
    }
  };

  const handleBarPointerUp = (e: React.PointerEvent) => {
    if (!isDraggingBarRef.current) return;
    isDraggingBarRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  // Drag Pin A
  const handlePointerDownA = (e: React.PointerEvent) => {
    e.stopPropagation();
    isDraggingARef.current = true;
    setActiveDrag("A");
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMoveA = (e: React.PointerEvent) => {
    if (!isDraggingARef.current || !barRef.current || durationSec <= 0) return;
    e.stopPropagation();
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let targetSec = pct * durationSec;

    // Clamp A so it does not exceed B if B is set
    const currentEnd = usePlaybackStore.getState().loopEndSec;
    if (currentEnd !== null) {
      targetSec = Math.min(targetSec, Math.max(0, currentEnd - 0.2));
    }

    setLoopPoints(targetSec, currentEnd);
  };

  const handlePointerUpA = (e: React.PointerEvent) => {
    if (!isDraggingARef.current) return;
    e.stopPropagation();
    isDraggingARef.current = false;
    setActiveDrag(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  // Drag Pin B
  const handlePointerDownB = (e: React.PointerEvent) => {
    e.stopPropagation();
    isDraggingBRef.current = true;
    setActiveDrag("B");
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMoveB = (e: React.PointerEvent) => {
    if (!isDraggingBRef.current || !barRef.current || durationSec <= 0) return;
    e.stopPropagation();
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let targetSec = pct * durationSec;

    // Clamp B so it does not precede A if A is set
    const currentStart = usePlaybackStore.getState().loopStartSec;
    if (currentStart !== null) {
      targetSec = Math.max(targetSec, Math.min(durationSec, currentStart + 0.2));
    }

    setLoopPoints(currentStart, targetSec);
  };

  const handlePointerUpB = (e: React.PointerEvent) => {
    if (!isDraggingBRef.current) return;
    e.stopPropagation();
    isDraggingBRef.current = false;
    setActiveDrag(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const progressPct =
    durationSec > 0 ? Math.min(100, (displayTimeSec / durationSec) * 100) : 0;

  // A-B Loop highlight bounds
  let loopStartPct: number | null = null;
  let loopWidthPct: number | null = null;
  if (
    durationSec > 0 &&
    loopStartSec !== null &&
    loopEndSec !== null &&
    loopStartSec !== loopEndSec
  ) {
    const minSec = Math.max(0, Math.min(loopStartSec, loopEndSec));
    const maxSec = Math.min(durationSec, Math.max(loopStartSec, loopEndSec));
    loopStartPct = (minSec / durationSec) * 100;
    loopWidthPct = Math.max(0.5, ((maxSec - minSec) / durationSec) * 100);
  }

  return (
    <div
      ref={barRef}
      onPointerDown={handleBarPointerDown}
      onPointerMove={handleBarPointerMove}
      onPointerUp={handleBarPointerUp}
      className="relative group flex items-center h-6 w-32 sm:w-44 md:w-56 cursor-pointer select-none py-2 touch-none"
    >
      {/* Background Track Bar */}
      <div className="relative w-full h-1.5 rounded-full bg-white/[0.12] overflow-hidden">
        {/* A-B Loop Highlight Region */}
        {loopStartPct !== null && loopWidthPct !== null && (
          <div
            className={`absolute top-0 bottom-0 pointer-events-none transition-opacity ${
              loopEnabled
                ? "bg-primary/35 border-x border-primary/80"
                : "bg-white/10 border-x border-white/20 opacity-50"
            }`}
            style={{
              left: `${loopStartPct}%`,
              width: `${loopWidthPct}%`,
            }}
          />
        )}

        {/* Played Progress Bar */}
        <div
          className="h-full bg-gradient-to-r from-zinc-300 via-zinc-200 to-white rounded-full transition-[width] duration-75"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Scrubber Playhead Thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity pointer-events-none"
        style={{ left: `${progressPct}%` }}
      />

      {/* Draggable Point A Handle */}
      {durationSec > 0 && loopStartSec !== null && (
        <div
          onPointerDown={handlePointerDownA}
          onPointerMove={handlePointerMoveA}
          onPointerUp={handlePointerUpA}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-7 flex items-center justify-center cursor-ew-resize z-30 group/pinA touch-none"
          style={{ left: `${(loopStartSec / durationSec) * 100}%` }}
        >
          <div
            className={`w-3.5 h-3.5 rounded-full font-mono font-bold text-[8px] flex items-center justify-center shadow-lg transition-transform ${
              activeDrag === "A"
                ? "scale-140 bg-primary brightness-110 text-black shadow-primary/50"
                : "bg-primary text-black group-hover/pinA:scale-130"
            }`}
          >
            A
          </div>
          {/* Tooltip badge on hover/drag */}
          <span className="absolute -bottom-4 text-[9px] font-mono font-semibold text-primary bg-black/85 px-1 py-0.2 rounded border border-primary/30 opacity-0 group-hover/pinA:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
            {formatSec(loopStartSec)}
          </span>
        </div>
      )}

      {/* Draggable Point B Handle */}
      {durationSec > 0 && loopEndSec !== null && (
        <div
          onPointerDown={handlePointerDownB}
          onPointerMove={handlePointerMoveB}
          onPointerUp={handlePointerUpB}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-7 flex items-center justify-center cursor-ew-resize z-30 group/pinB touch-none"
          style={{ left: `${(loopEndSec / durationSec) * 100}%` }}
        >
          <div
            className={`w-3.5 h-3.5 rounded-full font-mono font-bold text-[8px] flex items-center justify-center shadow-lg transition-transform ${
              activeDrag === "B"
                ? "scale-140 bg-primary brightness-110 text-black shadow-primary/50"
                : "bg-primary text-black group-hover/pinB:scale-130"
            }`}
          >
            B
          </div>
          {/* Tooltip badge on hover/drag */}
          <span className="absolute -bottom-4 text-[9px] font-mono font-semibold text-primary bg-black/85 px-1 py-0.2 rounded border border-primary/30 opacity-0 group-hover/pinB:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
            {formatSec(loopEndSec)}
          </span>
        </div>
      )}
    </div>
  );
};
