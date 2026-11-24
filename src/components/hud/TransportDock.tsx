import React from "react";
import { Play, Pause } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TimelineScrubber } from "@/components/hud/TimelineScrubber";
import { HandControlsPopover } from "@/components/hud/HandControlsPopover";
import { TempoPopover, LoopButton } from "@/components/hud/TempoLoopPopover";
import { QuickVolumePopover } from "@/components/hud/QuickVolumePopover";
import {
  usePlaybackStore,
  cancelCountIn,
  startPlaybackWithOptionalCountIn,
} from "@/stores/usePlaybackStore";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { playbackClock } from "@/engine/playbackClock";
import { audioPause, audioSeek } from "@/services/tauriApi";

function formatTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TransportDock: React.FC = () => {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);
  const countInBeat = usePlaybackStore((s) => s.countInBeat);
  const durationSec = usePlaybackStore((s) => s.durationSec);
  const displayTimeSec = usePlaybackStore((s) => s.displayTimeSec);
  const setDisplayTimeSec = usePlaybackStore((s) => s.setDisplayTimeSec);
  const tempoScale = usePlaybackStore((s) => s.tempoScale);

  const restartShortcut = useShortcutStore((s) => s.getFormattedBinding("playback.restart"));
  const playPauseShortcut = useShortcutStore((s) => s.getFormattedBinding("playback.toggle"));

  const handlePlayPause = async () => {
    if (countInBeat !== null) {
      cancelCountIn();
      return;
    }
    const next = !isPlaying;
    if (next) {
      await startPlaybackWithOptionalCountIn();
    } else {
      setIsPlaying(false);
      playbackClock.syncFromRust(displayTimeSec, false, tempoScale);
      await audioPause();
    }
  };

  const handleRestart = async () => {
    cancelCountIn();
    setDisplayTimeSec(0);
    playbackClock.seekLocal(0);
    await audioSeek(0);
  };

  return (
    <nav
      aria-label="Playback Controls"
      className="fixed top-2.5 h-10 left-1/2 -translate-x-1/2 z-30 flex items-center select-none pointer-events-auto"
    >
      {/* Floating Smoked Obsidian Glass Dock */}
      <div className="flex items-center gap-2 sm:gap-2.5 px-2.5 py-1 liquid-glass-dock rounded-full">
        {/* Play / Pause */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handlePlayPause}
              className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer shrink-0 focus:outline-none ${
                isPlaying || countInBeat !== null
                  ? "liquid-glass-accent text-primary"
                  : "liquid-glass-dock-btn text-zinc-100 hover:text-white"
              }`}
              aria-label={isPlaying || countInBeat !== null ? "Pause" : "Play"}
            >
              {isPlaying || countInBeat !== null ? (
                <Pause className="w-3 h-3 fill-current text-current" />
              ) : (
                <Play className="w-3 h-3 fill-current text-current ml-0.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>
              {isPlaying || countInBeat !== null
                ? `Pause (${playPauseShortcut})`
                : `Play (${playPauseShortcut})`}
            </span>
          </TooltipContent>
        </Tooltip>

        <span aria-hidden="true" className="h-3.5 w-px bg-white/[0.08] shrink-0" />

        {/* Timecodes (click elapsed time to restart) & Wide Timeline Scrubber */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleRestart}
                className="text-[10px] sm:text-[11px] font-medium text-zinc-300 hover:text-white tabular-nums w-8 text-right font-mono shrink-0 cursor-pointer transition-colors"
                aria-label="Restart from beginning"
              >
                {formatTime(displayTimeSec)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>Click to restart ({restartShortcut})</span>
            </TooltipContent>
          </Tooltip>

          <TimelineScrubber />

          <span className="text-[10px] sm:text-[11px] font-medium text-zinc-500 tabular-nums w-8 font-mono shrink-0">
            {formatTime(durationSec)}
          </span>
        </div>

        <span aria-hidden="true" className="h-3.5 w-px bg-white/[0.08] shrink-0" />

        {/* Practice Hands Popover */}
        <HandControlsPopover />

        <span aria-hidden="true" className="h-3.5 w-px bg-white/[0.08] shrink-0" />

        {/* Tempo & Metronome Popover, A-B Loop, Quick Volume */}
        <div className="flex items-center gap-1 shrink-0">
          <TempoPopover />
          <LoopButton />
          <QuickVolumePopover />
        </div>
      </div>
    </nav>
  );
};
