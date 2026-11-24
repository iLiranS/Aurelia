import React, { useRef } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { audioSetVolume } from "@/services/tauriApi";

export const QuickVolumePopover: React.FC = () => {
  const volume = usePlaybackStore((s) => s.volume);
  const setVolume = usePlaybackStore((s) => s.setVolume);
  const lastNonZeroRef = useRef<number>(volume > 0 ? volume : 0.8);

  const handleVolumeChange = async (val: number) => {
    if (val > 0) {
      lastNonZeroRef.current = val;
    }
    setVolume(val);
    await audioSetVolume(val).catch(() => {});
  };

  const handleToggleMute = async () => {
    if (volume > 0) {
      lastNonZeroRef.current = volume;
      await handleVolumeChange(0);
    } else {
      await handleVolumeChange(lastNonZeroRef.current || 0.8);
    }
  };

  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

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
          <span>Volume ({Math.round(volume * 100)}%)</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-48 p-2.5 liquid-glass-popover rounded-2xl"
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleToggleMute}
            className="w-6 h-6 rounded-full liquid-glass-dock-btn text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
          >
            <VolumeIcon className="w-3.5 h-3.5" />
          </button>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[volume]}
            onValueChange={([val]) => handleVolumeChange(val)}
            className="flex-1"
          />
          <span className="text-[11px] text-zinc-400 tabular-nums font-mono w-8 text-right shrink-0">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
};
