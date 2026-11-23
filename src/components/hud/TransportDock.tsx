import React, { useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimelineScrubber } from "@/components/hud/TimelineScrubber";
import { HandControlsPopover } from "@/components/hud/HandControlsPopover";
import { TempoPopover, LoopButton } from "@/components/hud/TempoLoopPopover";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useShortcutStore } from "@/stores/useShortcutStore";
import { useSoundStore } from "@/stores/useSoundStore";
import { playbackClock } from "@/engine/playbackClock";
import {
  audioPlay,
  audioPause,
  audioSeek,
  audioSetVolume,
} from "@/services/tauriApi";

function formatTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TransportDock: React.FC = () => {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);
  const durationSec = usePlaybackStore((s) => s.durationSec);
  const displayTimeSec = usePlaybackStore((s) => s.displayTimeSec);
  const setDisplayTimeSec = usePlaybackStore((s) => s.setDisplayTimeSec);

  const tempoScale = usePlaybackStore((s) => s.tempoScale);

  const volume = usePlaybackStore((s) => s.volume);
  const setVolume = usePlaybackStore((s) => s.setVolume);

  const soundfonts = useSoundStore((s) => s.soundfonts);
  const activeSoundFontPath = useSoundStore((s) => s.activeSoundFontPath);
  const isSwitchingSoundFont = useSoundStore((s) => s.isSwitchingSoundFont);
  const selectSoundFont = useSoundStore((s) => s.selectSoundFont);
  const importSoundFont = useSoundStore((s) => s.importSoundFont);
  const deleteSoundFont = useSoundStore((s) => s.deleteSoundFont);
  const reverbMix = useSoundStore((s) => s.reverbMix);
  const setReverbMix = useSoundStore((s) => s.setReverbMix);
  const touch = useSoundStore((s) => s.touch);
  const setTouch = useSoundStore((s) => s.setTouch);

  const [deleteSfOpen, setDeleteSfOpen] = useState(false);
  const [isDeletingSf, setIsDeletingSf] = useState(false);
  const [deleteSfError, setDeleteSfError] = useState<string | null>(null);

  const activeSoundFont = soundfonts.find((sf) => sf.path === activeSoundFontPath) ?? null;

  const handleOpenDeleteSf = () => {
    if (!activeSoundFont || activeSoundFont.isBundled) return;
    setDeleteSfError(null);
    setDeleteSfOpen(true);
  };

  const handleConfirmDeleteSf = async () => {
    if (!activeSoundFont || activeSoundFont.isBundled) return;
    setIsDeletingSf(true);
    setDeleteSfError(null);
    try {
      await deleteSoundFont(activeSoundFont.path);
      setDeleteSfOpen(false);
    } catch (err) {
      setDeleteSfError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingSf(false);
    }
  };

  const restartShortcut = useShortcutStore((s) => s.getFormattedBinding("playback.restart"));
  const playPauseShortcut = useShortcutStore((s) => s.getFormattedBinding("playback.toggle"));

  const handlePlayPause = async () => {
    const next = !isPlaying;
    setIsPlaying(next);
    playbackClock.syncFromRust(displayTimeSec, next, tempoScale);
    if (next) {
      await audioPlay();
    } else {
      await audioPause();
    }
  };

  const handleRestart = async () => {
    setDisplayTimeSec(0);
    playbackClock.seekLocal(0);
    await audioSeek(0);
  };

  const handleVolumeChange = async (val: number) => {
    setVolume(val);
    await audioSetVolume(val);
  };

  return (
    <>
    <nav
      aria-label="Playback Controls"
      className="fixed top-2.5 left-1/2 -translate-x-1/2 z-30 select-none pointer-events-auto"
    >
      {/* Floating Liquid Glass Dock (Stable width, subtle hairline border, specular top rim) */}
      <div className="flex items-center gap-2 sm:gap-2.5 px-3 py-1.5 liquid-glass-dock rounded-full shadow-2xl">
        {/* Restart & Play / Pause */}
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRestart}
                className="w-6 h-6 rounded-full liquid-glass-btn text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-all cursor-pointer shrink-0"
                aria-label="Restart from beginning"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>Restart ({restartShortcut})</span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handlePlayPause}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-sm shrink-0 ${
                  isPlaying
                    ? "liquid-glass-accent text-primary"
                    : "liquid-glass-btn text-zinc-100 hover:text-white"
                }`}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="w-3 h-3 fill-current text-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current text-current ml-0.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>
                {isPlaying
                  ? `Pause (${playPauseShortcut})`
                  : `Play (${playPauseShortcut})`}
              </span>
            </TooltipContent>
          </Tooltip>
        </div>

        <span aria-hidden="true" className="h-3.5 w-px bg-white/[0.08] shrink-0" />

        {/* Timecodes & Sleek Timeline Scrubber with Draggable A/B Handles */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span className="text-[10px] sm:text-[11px] font-medium text-zinc-300 tabular-nums w-7 sm:w-8 text-right font-mono shrink-0">
            {formatTime(displayTimeSec)}
          </span>

          <TimelineScrubber />

          <span className="text-[10px] sm:text-[11px] font-medium text-zinc-500 tabular-nums w-7 sm:w-8 font-mono shrink-0">
            {formatTime(durationSec)}
          </span>
        </div>

        <span aria-hidden="true" className="h-3.5 w-px bg-white/[0.08] shrink-0" />

        {/* Practice Hands Dropdown Button (Fixed width w-[74px] prevents dock jitter) */}
        <HandControlsPopover />

        <span aria-hidden="true" className="h-3.5 w-px bg-white/[0.08] shrink-0" />

        {/* Secondary: Tempo Popover (Fixed width w-[52px]), 2-Click Interactive Loop Button, Volume */}
        <div className="flex items-center gap-1 shrink-0">
          <TempoPopover />
          <LoopButton />

          {/* Volume Popover */}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    className="w-6 h-6 rounded-lg liquid-glass-btn text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-all cursor-pointer shrink-0"
                    aria-label="Volume Control"
                  >
                    {volume === 0 ? (
                      <VolumeX className="w-3 h-3" />
                    ) : (
                      <Volume2 className="w-3 h-3" />
                    )}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span>Volume ({Math.round(volume * 100)}%)</span>
              </TooltipContent>
            </Tooltip>

            <PopoverContent
              side="bottom"
              align="end"
              className="w-64 p-3 space-y-3 liquid-glass-popover rounded-2xl shadow-2xl"
            >
              {/* Volume Slider Row */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300">Volume</span>
                  <span className="text-xs text-zinc-400 tabular-nums font-mono">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[volume]}
                  onValueChange={([val]) => handleVolumeChange(val)}
                />
              </div>

              <Separator className="bg-white/[0.08]" />

              {/* SoundFont / Piano Voice Picker */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400">
                      Piano Voice
                    </span>
                    {isSwitchingSoundFont && (
                      <Loader2 className="w-3 h-3 text-primary animate-spin" />
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => importSoundFont()}
                        disabled={isSwitchingSoundFont}
                        className="h-5 px-1.5 rounded-md liquid-glass-btn text-[10px] font-medium text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        aria-label="Import .sf2"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>Import .sf2</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <span>Import custom .sf2 SoundFont from disk</span>
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* SoundFont Dropdown Select + Delete Button */}
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={activeSoundFontPath || ""}
                      onChange={(e) => selectSoundFont(e.target.value)}
                      disabled={isSwitchingSoundFont}
                      className="w-full h-8 px-2.5 text-xs rounded-xl bg-black/40 border border-white/[0.08] text-zinc-200 focus:outline-none focus:border-primary/50 cursor-pointer appearance-none truncate pr-7 transition-colors disabled:opacity-50"
                    >
                      {soundfonts.length === 0 ? (
                        <option value="" disabled className="bg-zinc-900 text-zinc-400">
                          Default Piano
                        </option>
                      ) : (
                        soundfonts.map((sf) => (
                          <option
                            key={sf.id}
                            value={sf.path}
                            className="bg-zinc-900 text-zinc-200"
                          >
                            {sf.name} ({sf.sizeMb} MB)
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  {activeSoundFont && !activeSoundFont.isBundled && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleOpenDeleteSf}
                          disabled={isSwitchingSoundFont}
                          className="h-8 w-8 shrink-0 rounded-xl bg-black/40 border border-white/[0.08] text-zinc-400 hover:text-rose-300 hover:border-rose-500/40 hover:bg-rose-500/10 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                          aria-label="Delete imported .sf2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <span>Delete imported .sf2 SoundFont</span>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              <Separator className="bg-white/[0.08]" />

              {/* Studio Sound Controls: Reverb & Touch */}
              <div className="space-y-2">
                {/* Reverb Slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400 text-[11px]">Room Reverb</span>
                    <span className="text-zinc-400 font-mono text-[11px] tabular-nums">
                      {Math.round(reverbMix * 100)}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={0.45}
                    step={0.01}
                    value={[reverbMix]}
                    onValueChange={([val]) => setReverbMix(val)}
                  />
                </div>

                {/* Touch Preset Pills */}
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-zinc-400 text-[11px]">Touch Feel</span>
                  <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
                    {(["soft", "balanced", "strong"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTouch(t)}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded-md cursor-pointer transition-all capitalize liquid-glass-segment ${
                          touch === t
                            ? "liquid-glass-segment-active text-zinc-100"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </nav>

    {/* Delete SoundFont Confirmation Dialog */}
    <Dialog open={deleteSfOpen} onOpenChange={setDeleteSfOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete SoundFont</DialogTitle>
          <DialogDescription>
            Delete{" "}
            <span className="text-zinc-200 font-medium">
              &ldquo;{activeSoundFont?.name}&rdquo;
            </span>{" "}
            ({activeSoundFont?.sizeMb} MB) from disk? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {deleteSfError && (
          <p className="text-xs text-rose-300">{deleteSfError}</p>
        )}
        <DialogFooter>
          <button
            type="button"
            onClick={() => setDeleteSfOpen(false)}
            disabled={isDeletingSf}
            className="h-8 px-3 rounded-xl liquid-glass-btn text-xs text-zinc-300 hover:text-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDeleteSf}
            disabled={isDeletingSf}
            className="h-8 px-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 cursor-pointer disabled:opacity-50"
          >
            {isDeletingSf ? "Deleting…" : "Delete"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
