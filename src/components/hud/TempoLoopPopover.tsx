import React from "react";
import { Gauge, Minus, Plus, Repeat, RotateCcw, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { playbackClock } from "@/engine/playbackClock";

function formatSec(sec: number | null): string {
  if (sec === null) return "--:--";
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TempoPopover: React.FC = () => {
  const initialBpm = usePlaybackStore((s) => s.initialBpm);
  const tempoScale = usePlaybackStore((s) => s.tempoScale);
  const setTempoScale = usePlaybackStore((s) => s.setTempoScale);
  const transposeSemitones = usePlaybackStore((s) => s.transposeSemitones);
  const setTransposeSemitones = usePlaybackStore((s) => s.setTransposeSemitones);
  const countInBars = usePlaybackStore((s) => s.countInBars);
  const setCountInBars = usePlaybackStore((s) => s.setCountInBars);
  const displayTimeSec = usePlaybackStore((s) => s.displayTimeSec);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  const handleTempoChange = (val: number) => {
    setTempoScale(val);
    playbackClock.syncFromRust(displayTimeSec, isPlaying, val);
  };

  const effectiveBpm = Math.round(initialBpm * tempoScale);
  const transposeLabel =
    transposeSemitones > 0
      ? `+${transposeSemitones} st`
      : `${transposeSemitones} st`;

  const tempoDownShortcut = useShortcutStore((s) => s.getFormattedBinding("tempo.down"));
  const tempoUpShortcut = useShortcutStore((s) => s.getFormattedBinding("tempo.up"));

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className="relative h-6 px-1.5 w-[52px] text-[10px] font-medium tabular-nums text-zinc-300 hover:text-zinc-100 liquid-glass-btn rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer shadow-sm shrink-0"
              aria-label="Adjust Tempo and Transpose"
            >
              <Gauge className="w-3 h-3 text-zinc-400 shrink-0" />
              <span className=" text-right font-mono tabular-nums shrink-0">
                {Math.round(tempoScale * 100)}%
              </span>
              {transposeSemitones !== 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary absolute top-0.5 right-0.5" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>
            Tempo ({effectiveBpm} BPM)
            {transposeSemitones !== 0 ? ` · ${transposeLabel}` : ""}
          </span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="center"
        className="w-56 p-3 space-y-3 liquid-glass-popover rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-zinc-200">Tempo</span>
            <p className="text-[10px] text-zinc-400 font-mono">
              {effectiveBpm} BPM <span className="text-zinc-600">({initialBpm.toFixed(2)} base)</span>
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-primary tabular-nums">
            {Math.round(tempoScale * 100)}%
          </span>
        </div>

        <Slider
          min={0.25}
          max={2.0}
          step={0.05}
          value={[tempoScale]}
          onValueChange={([val]) => handleTempoChange(val)}
        />

        <div className="grid grid-cols-4 gap-1 pt-0.5">
          {[0.5, 0.75, 1.0, 1.25].map((preset) => (
            <button
              key={preset}
              onClick={() => handleTempoChange(preset)}
              className={`py-0.5 rounded-lg text-[10px] font-medium font-mono tabular-nums transition-all cursor-pointer ${Math.abs(tempoScale - preset) < 0.01
                ? "liquid-glass-accent text-primary font-semibold"
                : "liquid-glass-btn text-zinc-400 hover:text-zinc-200"
                }`}
            >
              {preset}x
            </button>
          ))}
        </div>

        <p className="text-[9px] text-zinc-500 text-center font-mono">
          Shortcut: <kbd className="text-zinc-400">{tempoDownShortcut}</kbd> /{" "}
          <kbd className="text-zinc-400">{tempoUpShortcut}</kbd> (±5%)
        </p>

        <Separator className="bg-white/10" />

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-200">Transpose</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTransposeSemitones(transposeSemitones - 1)}
              disabled={transposeSemitones <= -12}
              className="w-6 h-6 rounded-lg liquid-glass-btn flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              title="Transpose down 1 semitone"
              aria-label="Transpose down 1 semitone"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={() => setTransposeSemitones(0)}
              disabled={transposeSemitones === 0}
              className={`min-w-[46px] h-6 px-1.5 rounded-lg text-[11px] font-mono font-semibold tabular-nums flex items-center justify-center gap-1 transition-colors ${
                transposeSemitones !== 0
                  ? "liquid-glass-accent text-primary cursor-pointer"
                  : "liquid-glass-segment text-zinc-400 cursor-default"
              }`}
              title={transposeSemitones !== 0 ? "Reset transpose to 0 st" : undefined}
            >
              <span>{transposeLabel}</span>
              {transposeSemitones !== 0 && <RotateCcw className="w-2.5 h-2.5 opacity-80" />}
            </button>
            <button
              onClick={() => setTransposeSemitones(transposeSemitones + 1)}
              disabled={transposeSemitones >= 12}
              className="w-6 h-6 rounded-lg liquid-glass-btn flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              title="Transpose up 1 semitone"
              aria-label="Transpose up 1 semitone"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        <Separator className="bg-white/10" />

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-zinc-200 block">Count-In</span>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl liquid-glass-segment">
            {([
              { value: 0, label: "Off" },
              { value: 1, label: "1 Bar" },
              { value: 2, label: "2 Bars" },
            ] as const).map((opt) => {
              const active = countInBars === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setCountInBars(opt.value)}
                  className={`h-6 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                    active
                      ? "bg-primary text-zinc-950 font-semibold shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const LoopButton: React.FC = () => {
  const loopEnabled = usePlaybackStore((s) => s.loopEnabled);
  const toggleLoop = usePlaybackStore((s) => s.toggleLoop);
  const setLoopEnabled = usePlaybackStore((s) => s.setLoopEnabled);
  const loopStartSec = usePlaybackStore((s) => s.loopStartSec);
  const loopEndSec = usePlaybackStore((s) => s.loopEndSec);
  const setLoopPoints = usePlaybackStore((s) => s.setLoopPoints);

  // Exact boolean flags:
  // isSettingB is ONLY true if loopStartSec is an actual number and loopEndSec is null/undefined
  const isSettingB =
    typeof loopStartSec === "number" &&
    (loopEndSec === null || typeof loopEndSec === "undefined");
  // hasLoop is ONLY true if BOTH are valid numbers
  const hasLoop =
    typeof loopStartSec === "number" && typeof loopEndSec === "number";

  const handleClick = () => {
    const now = playbackClock.getTime();

    if (!hasLoop && !isSettingB) {
      // 1st click: Set Point A, start waiting for Point B
      setLoopPoints(now, null);
      setLoopEnabled(false);
    } else if (isSettingB) {
      // 2nd click: Set Point B and engage loop
      const a = loopStartSec!;
      const b = now;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      setLoopPoints(start, end);
      setLoopEnabled(true);
    } else if (hasLoop) {
      // 3rd click+: Toggle loop on/off
      toggleLoop();
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoopPoints(null, null);
    setLoopEnabled(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setLoopPoints(null, null);
    setLoopEnabled(false);
  };

  const loopSmartShortcut = useShortcutStore((s) => s.getFormattedBinding("loop.smart"));
  const loopClearShortcut = useShortcutStore((s) => s.getFormattedBinding("loop.clear"));

  const tooltipText = isSettingB
    ? `Point A set (${formatSec(loopStartSec)}). Click or press ${loopSmartShortcut} to set Point B (${loopClearShortcut} to cancel)`
    : hasLoop
      ? `A–B Loop ${loopEnabled ? "Active" : "Paused"} (${formatSec(loopStartSec)} → ${formatSec(loopEndSec)}). Click or press ${loopSmartShortcut} to toggle, ${loopClearShortcut} to clear`
      : `A–B Loop: Click or press ${loopSmartShortcut} to set Point A`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative flex items-center shrink-0 group/loop">
          <button
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-sm ${isSettingB
              ? "bg-amber-400/25 border border-amber-400/60 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.4)] animate-pulse"
              : hasLoop && loopEnabled
                ? "liquid-glass-accent text-primary"
                : "liquid-glass-btn text-zinc-400 hover:text-zinc-200"
              }`}
            aria-label="A-B Loop Practice"
          >
            <Repeat className="w-3 h-3" />
          </button>

          {/* Quick Clear 'X' on hover when loop points are set */}
          {(isSettingB || hasLoop) && (
            <button
              onClick={handleClear}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-zinc-900 border border-white/20 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 flex items-center justify-center opacity-0 group-hover/loop:opacity-100 transition-opacity cursor-pointer shadow-md z-10"
              aria-label="Clear Loop"
            >
              <X className="w-2 h-2" />
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span>{tooltipText}</span>
      </TooltipContent>
    </Tooltip>
  );
};
