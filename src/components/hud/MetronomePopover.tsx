import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Minus, Plus, Volume2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { metronomeEngine, type BeatsPerBar } from "@/engine/metronome";

const TIME_SIGNATURES: Array<{ beats: BeatsPerBar; label: string }> = [
  { beats: 2, label: "2/4" },
  { beats: 3, label: "3/4" },
  { beats: 4, label: "4/4" },
  { beats: 6, label: "6/8" },
];

interface MetronomePopoverProps {
  bpm: number;
  onBpmChange: (bpm: number) => void;
}

export const MetronomePopover: React.FC<MetronomePopoverProps> = ({
  bpm,
  onBpmChange,
}) => {
  const initialConfig = metronomeEngine.getConfig();
  const [running, setRunning] = useState(() => metronomeEngine.isRunning());
  const [beatsPerBar, setBeatsPerBar] = useState<BeatsPerBar>(initialConfig.beatsPerBar);
  const [volume, setVolume] = useState(initialConfig.volume);
  const [beatPulse, setBeatPulse] = useState<{ active: boolean; isAccent: boolean }>({
    active: false,
    isAccent: false,
  });

  const tapTimestampsRef = useRef<number[]>([]);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubStatus = metronomeEngine.onStatusChange((isOn) => {
      setRunning(isOn);
      if (!isOn) {
        setBeatPulse({ active: false, isAccent: false });
      }
    });

    const unsubBeat = metronomeEngine.onBeat((_beatIndex, isAccent) => {
      setBeatPulse({ active: true, isAccent });
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = setTimeout(() => {
        setBeatPulse((prev) => ({ ...prev, active: false }));
      }, 110);
    });

    return () => {
      unsubStatus();
      unsubBeat();
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, []);

  const updateBpm = (next: number) => {
    const clamped = Math.max(40, Math.min(200, Math.round(next)));
    metronomeEngine.setConfig({ bpm: clamped });
    onBpmChange(clamped);
  };

  const handleTimeSigChange = (beats: BeatsPerBar) => {
    metronomeEngine.setConfig({ beatsPerBar: beats });
    setBeatsPerBar(beats);
  };

  const handleVolumeChange = (nextVol: number) => {
    const clamped = Math.max(0, Math.min(1, nextVol));
    metronomeEngine.setConfig({ volume: clamped });
    setVolume(clamped);
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const prev = tapTimestampsRef.current;
    if (prev.length > 0 && now - prev[prev.length - 1] > 2000) {
      tapTimestampsRef.current = [now];
      return;
    }

    const updated = [...prev, now].slice(-5); // keep up to 5 taps -> 4 intervals
    tapTimestampsRef.current = updated;

    if (updated.length >= 2) {
      let sum = 0;
      for (let i = 1; i < updated.length; i++) {
        sum += updated[i] - updated[i - 1];
      }
      const avgMs = sum / (updated.length - 1);
      if (avgMs > 0) {
        updateBpm(60000 / avgMs);
      }
    }
  };

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => metronomeEngine.toggle()}
            className={`h-6 pl-2 pr-1.5 rounded-l-lg text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              running
                ? "liquid-glass-accent text-primary font-semibold"
                : "text-zinc-300 hover:text-white hover:bg-white/[0.06]"
            }`}
            aria-label={running ? "Stop Metronome" : "Start Metronome"}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-transform duration-75 ${
                running
                  ? beatPulse.active
                    ? beatPulse.isAccent
                      ? "bg-primary scale-150 shadow-[0_0_8px_var(--color-primary)]"
                      : "bg-primary/80 scale-125"
                    : "bg-primary/40"
                  : "bg-zinc-500"
              }`}
            />
            <span className="font-mono tabular-nums">{bpm}</span>
            <span className="text-[10px] text-zinc-400">BPM</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>{running ? "Stop Metronome" : "Start Metronome"}</span>
        </TooltipContent>
      </Tooltip>

      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`h-6 px-1 rounded-r-lg border-l border-white/[0.08] flex items-center justify-center transition-all cursor-pointer ${
                  running
                    ? "liquid-glass-accent text-primary"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
                }`}
                aria-label="Metronome Settings"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>Metronome Settings</span>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="bottom"
          align="center"
          className="w-60 p-3 space-y-3 liquid-glass-popover rounded-xl shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Metronome</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updateBpm(bpm - 1)}
                className="w-5 h-5 rounded-md liquid-glass-btn text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
                aria-label="Decrease BPM"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-12 text-center text-xs font-mono font-bold text-primary tabular-nums">
                {bpm}
              </span>
              <button
                type="button"
                onClick={() => updateBpm(bpm + 1)}
                className="w-5 h-5 rounded-md liquid-glass-btn text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
                aria-label="Increase BPM"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          <Slider
            min={40}
            max={200}
            step={1}
            value={[bpm]}
            onValueChange={([val]) => updateBpm(val)}
          />

          <div className="flex items-center justify-between gap-2">
            <div className="grid grid-cols-4 gap-1 flex-1">
              {TIME_SIGNATURES.map((sig) => (
                <button
                  key={sig.beats}
                  type="button"
                  onClick={() => handleTimeSigChange(sig.beats)}
                  className={`py-1 rounded-lg text-[10px] font-medium font-mono transition-all cursor-pointer ${
                    beatsPerBar === sig.beats
                      ? "liquid-glass-accent text-primary font-semibold"
                      : "liquid-glass-btn text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {sig.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleTapTempo}
              className="px-2.5 py-1 rounded-lg liquid-glass-btn text-[10px] font-medium text-zinc-200 hover:text-white active:scale-95 transition-all cursor-pointer shrink-0"
            >
              Tap
            </button>
          </div>

          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span className="flex items-center gap-1">
                <Volume2 className="w-3 h-3" />
                Click Volume
              </span>
              <span className="font-mono tabular-nums">{Math.round(volume * 100)}%</span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[volume]}
              onValueChange={([val]) => handleVolumeChange(val)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
