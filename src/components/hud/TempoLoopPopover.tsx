import React, { useEffect, useRef, useState } from "react";
import { Gauge, Minus, Plus, Repeat, RotateCcw, Volume2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { playbackClock } from "@/engine/playbackClock";
import { metronomeEngine } from "@/engine/metronome";

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

  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [clickVolume, setClickVolume] = useState(() => metronomeEngine.getConfig().volume);
  const [beatPulse, setBeatPulse] = useState(false);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveBpm = Math.max(40, Math.min(200, Math.round(initialBpm * tempoScale)));

  // Sync metronome engine to effective piece BPM while playing
  useEffect(() => {
    metronomeEngine.setConfig({ bpm: effectiveBpm });
  }, [effectiveBpm]);

  useEffect(() => {
    if (metronomeEnabled && isPlaying) {
      metronomeEngine.setConfig({ bpm: effectiveBpm, volume: clickVolume });
      metronomeEngine.start();
    } else {
      metronomeEngine.stop();
    }
  }, [metronomeEnabled, isPlaying, effectiveBpm, clickVolume]);

  useEffect(() => {
    const unsubBeat = metronomeEngine.onBeat(() => {
      setBeatPulse(true);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = setTimeout(() => setBeatPulse(false), 110);
    });
    return () => {
      unsubBeat();
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      metronomeEngine.stop();
    };
  }, []);

  const handleTempoChange = (val: number) => {
    setTempoScale(val);
    playbackClock.syncFromRust(displayTimeSec, isPlaying, val);
  };

  const handleClickVolumeChange = (val: number) => {
    setClickVolume(val);
    metronomeEngine.setConfig({ volume: val });
  };

  const transposeLabel =
    transposeSemitones > 0
      ? `+${transposeSemitones} st`
      : `${transposeSemitones} st`;



  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={`relative h-6 px-2 text-[10px] font-medium tabular-nums rounded-full flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
                metronomeEnabled
                  ? "liquid-glass-accent text-zinc-100"
                  : "liquid-glass-dock-btn text-zinc-300 hover:text-zinc-100"
              }`}
              aria-label="Adjust Tempo, Metronome, and Transpose"
            >
              {metronomeEnabled ? (
                <span
                  className={`w-1.5 h-1.5 rounded-full transition-transform duration-75 shrink-0 ${
                    beatPulse
                      ? "bg-primary scale-150 shadow-[0_0_6px_var(--theme-color)]"
                      : "bg-primary/60"
                  }`}
                />
              ) : (
                <Gauge className="w-3 h-3 text-zinc-400 shrink-0" />
              )}
              <span className="font-mono tabular-nums shrink-0">
                {Math.round(tempoScale * 100)}%
              </span>
              {transposeSemitones !== 0 && (
                <span className="text-[9px] font-mono font-semibold text-primary shrink-0">
                  {transposeSemitones > 0 ? `+${transposeSemitones}` : transposeSemitones}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>
            Tempo ({Math.round(initialBpm * tempoScale)} BPM)
            {metronomeEnabled ? " · Metronome On" : ""}
            {transposeSemitones !== 0 ? ` · ${transposeLabel}` : ""}
          </span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="center"
        className="w-60 p-3 space-y-3 liquid-glass-popover rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-zinc-200">Tempo</span>
            <p className="text-[10px] text-zinc-400 font-mono">
              {Math.round(initialBpm * tempoScale)} BPM{" "}
              <span className="text-zinc-600">({initialBpm.toFixed(0)} base)</span>
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

        <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
          {[0.5, 0.75, 1.0, 1.25].map((preset) => (
            <button
              key={preset}
              onClick={() => handleTempoChange(preset)}
              className={`py-0.5 rounded-md text-[10px] font-medium font-mono tabular-nums transition-all cursor-pointer liquid-glass-segment ${
                Math.abs(tempoScale - preset) < 0.01
                  ? "liquid-glass-segment-active text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {preset}x
            </button>
          ))}
        </div>


        <Separator className="bg-white/[0.08]" />

        {/* Beat-Synced Metronome Toggle */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Metronome</span>
            <Switch
              checked={metronomeEnabled}
              onCheckedChange={setMetronomeEnabled}
            />
          </div>

          {metronomeEnabled && (
            <div className="space-y-1 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3 h-3" />
                  Click Volume
                </span>
                <span className="font-mono tabular-nums">
                  {Math.round(clickVolume * 100)}%
                </span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={[clickVolume]}
                onValueChange={([val]) => handleClickVolumeChange(val)}
              />
            </div>
          )}
        </div>

        <Separator className="bg-white/[0.08]" />

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

        <Separator className="bg-white/[0.08]" />

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-zinc-200 block">Count-In</span>
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
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
                  className={`h-6 rounded-md text-[10px] font-medium transition-all cursor-pointer liquid-glass-segment ${
                    active
                      ? "liquid-glass-segment-active text-zinc-100"
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

  const isSettingB =
    typeof loopStartSec === "number" &&
    (loopEndSec === null || typeof loopEndSec === "undefined");
  const hasLoop =
    typeof loopStartSec === "number" && typeof loopEndSec === "number";

  const handleClick = () => {
    const now = playbackClock.getTime();

    if (!hasLoop && !isSettingB) {
      setLoopPoints(now, null);
      setLoopEnabled(false);
    } else if (isSettingB) {
      const a = loopStartSec!;
      const b = now;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      setLoopPoints(start, end);
      setLoopEnabled(true);
    } else if (hasLoop) {
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
            className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all cursor-pointer ${
              isSettingB
                ? "liquid-glass-accent text-primary animate-pulse"
                : hasLoop && loopEnabled
                  ? "liquid-glass-accent text-primary"
                  : "liquid-glass-dock-btn text-zinc-400 hover:text-zinc-100"
            }`}
            aria-label="A-B Loop Practice"
          >
            <Repeat className="w-3 h-3" />
          </button>

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
