import React, { useRef } from "react";
import { Music, Piano, Volume1, Volume2, VolumeX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useViewStore } from "@/stores/useViewStore";
import { audioSetLiveVolume, audioSetSongVolume } from "@/services/tauriApi";

export const QuickVolumePopover: React.FC = () => {
  const songVolume = usePlaybackStore((s) => s.songVolume);
  const setSongVolume = usePlaybackStore((s) => s.setSongVolume);
  const liveVolume = usePlaybackStore((s) => s.liveVolume);
  const setLiveVolume = usePlaybackStore((s) => s.setLiveVolume);
  const viewMode = useViewStore((s) => s.viewMode);

  const lastSongRef = useRef<number>(songVolume > 0 ? songVolume : 1.0);
  const lastLiveRef = useRef<number>(liveVolume > 0 ? liveVolume : 1.0);

  const handleSongChange = async (val: number) => {
    if (val > 0) lastSongRef.current = val;
    setSongVolume(val);
    await audioSetSongVolume(val).catch(() => {});
  };

  const handleToggleSongMute = async () => {
    if (songVolume > 0) {
      lastSongRef.current = songVolume;
      await handleSongChange(0);
    } else {
      await handleSongChange(lastSongRef.current || 1.0);
    }
  };

  const handleLiveChange = async (val: number) => {
    if (val > 0) lastLiveRef.current = val;
    setLiveVolume(val);
    await audioSetLiveVolume(val).catch(() => {});
  };

  const handleToggleLiveMute = async () => {
    if (liveVolume > 0) {
      lastLiveRef.current = liveVolume;
      await handleLiveChange(0);
    } else {
      await handleLiveChange(lastLiveRef.current || 1.0);
    }
  };

  const effectiveVolume =
    viewMode === "song" ? Math.max(songVolume, liveVolume) : liveVolume;
  const VolumeIcon =
    effectiveVolume === 0 ? VolumeX : effectiveVolume < 0.5 ? Volume1 : Volume2;

  const tooltipText =
    viewMode === "song"
      ? `Volume (Song ${Math.round(songVolume * 100)}% · Keys ${Math.round(liveVolume * 100)}%)`
      : `Keyboard Volume (${Math.round(liveVolume * 100)}%)`;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-6 h-6 rounded-full liquid-glass-dock-btn text-zinc-400 hover:text-zinc-100 flex items-center justify-center cursor-pointer shrink-0"
              aria-label="Volume Control"
            >
              <VolumeIcon className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>{tooltipText}</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-60 p-3 liquid-glass-popover rounded-2xl space-y-2.5"
      >
        {/* Song (MIDI Piece) Volume - shown in Song view */}
        {viewMode === "song" && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                Song
              </span>
              <span className="text-[11px] text-zinc-400 tabular-nums font-mono">
                {Math.round(songVolume * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleToggleSongMute}
                className={`w-6 h-6 rounded-full liquid-glass-dock-btn flex items-center justify-center cursor-pointer shrink-0 ${
                  songVolume === 0
                    ? "text-zinc-500 hover:text-zinc-300"
                    : "text-zinc-300 hover:text-white"
                }`}
                aria-label={songVolume === 0 ? "Unmute Song" : "Mute Song"}
              >
                {songVolume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Music className="w-3.5 h-3.5" />
                )}
              </button>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={[songVolume]}
                onValueChange={([val]) => handleSongChange(val)}
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Live Keyboard Volume (synced with MIDI CC 7 slider) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Keyboard
            </span>
            <span className="text-[11px] text-zinc-400 tabular-nums font-mono">
              {Math.round(liveVolume * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleToggleLiveMute}
              className={`w-6 h-6 rounded-full liquid-glass-dock-btn flex items-center justify-center cursor-pointer shrink-0 ${
                liveVolume === 0
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-300 hover:text-white"
              }`}
              aria-label={liveVolume === 0 ? "Unmute Keyboard" : "Mute Keyboard"}
            >
              {liveVolume === 0 ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Piano className="w-3.5 h-3.5" />
              )}
            </button>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[liveVolume]}
              onValueChange={([val]) => handleLiveChange(val)}
              className="flex-1"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
