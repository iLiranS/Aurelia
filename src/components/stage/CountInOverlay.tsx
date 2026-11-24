import React from "react";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useViewStore } from "@/stores/useViewStore";

export const CountInOverlay: React.FC = () => {
  const viewMode = useViewStore((s) => s.viewMode);
  const countInBeat = usePlaybackStore((s) => s.countInBeat);

  if (viewMode !== "song" || !countInBeat) {
    return null;
  }

  const { beat, totalRemaining, beatsPerBar } = countInBeat;
  const isAccent = beat === 1;

  return (
    <div className="absolute inset-x-0 top-[26%] flex justify-center pointer-events-none z-20 select-none">
      <div
        key={`${beat}-${totalRemaining}`}
        className="px-6 py-4 rounded-2xl liquid-glass-popover border border-white/15 shadow-2xl flex flex-col items-center gap-2.5 animate-in zoom-in-95 duration-100"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
          Count-In
        </span>
        <span
          className={`text-5xl font-bold font-mono tabular-nums leading-none ${
            isAccent ? "text-primary" : "text-zinc-100"
          }`}
        >
          {beat}
        </span>
        <div className="flex items-center gap-1.5 pt-0.5">
          {Array.from({ length: beatsPerBar }).map((_, idx) => {
            const dotBeat = idx + 1;
            const isCurrent = dotBeat === beat;
            const isPast = dotBeat < beat;
            return (
              <span
                key={idx}
                className={`rounded-full transition-all duration-100 ${
                  isCurrent
                    ? isAccent
                      ? "w-2.5 h-2.5 bg-primary shadow-[0_0_8px_rgba(245,194,107,0.6)]"
                      : "w-2.5 h-2.5 bg-zinc-100"
                    : isPast
                      ? "w-1.5 h-1.5 bg-zinc-500"
                      : "w-1.5 h-1.5 bg-zinc-700"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
