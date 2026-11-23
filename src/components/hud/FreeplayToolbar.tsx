import React, { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MetronomePopover } from "@/components/hud/MetronomePopover";
import { metronomeEngine } from "@/engine/metronome";
import { useMidiStore } from "@/stores/useMidiStore";
import { useRecordingStore } from "@/stores/useRecordingStore";

function formatTimer(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const FreeplayToolbar: React.FC = () => {
  const [bpm, setBpm] = useState(() => metronomeEngine.getConfig().bpm);

  const status = useRecordingStore((s) => s.status);
  const elapsedSec = useRecordingStore((s) => s.elapsedSec);
  const noteCount = useRecordingStore((s) => s.noteCount);
  const isNearLimit = useRecordingStore((s) => s.isNearLimit);
  const startRecording = useRecordingStore((s) => s.startRecording);
  const stopRecording = useRecordingStore((s) => s.stopRecording);

  const sustainDown = useMidiStore((s) => s.sustainDown);

  useEffect(() => {
    return () => {
      metronomeEngine.stop();
    };
  }, []);

  const isRecording = status === "recording";

  return (
    <div className="h-8 px-1.5 rounded-xl liquid-glass-dock flex items-center gap-1.5 shadow-lg">
      {/* Record / Stop Control */}
      {!isRecording ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => startRecording(bpm)}
              className="h-6 px-2.5 rounded-lg text-[11px] font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              aria-label="Start Recording"
            >
              <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
              <span>Rec</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>Record Free Play take</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <div
          className={`h-6 pl-2 pr-1 rounded-lg flex items-center gap-2 border transition-colors ${
            isNearLimit
              ? "bg-amber-500/15 border-amber-400/35 text-amber-200"
              : "bg-rose-500/15 border-rose-500/30 text-rose-100"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full animate-pulse ${
              isNearLimit ? "bg-amber-400" : "bg-rose-500"
            }`}
          />
          <span className="text-[11px] font-mono tabular-nums font-semibold">
            {formatTimer(elapsedSec)}
          </span>
          <span className="text-[10px] text-zinc-300/80 font-mono tabular-nums">
            {noteCount} {noteCount === 1 ? "note" : "notes"}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="h-5 px-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                aria-label="Stop Recording"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span>{isNearLimit ? "Approaching recording limit — Stop & Review" : "Stop Recording"}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Vertical Hairline Divider */}
      <div className="w-px h-4 bg-white/[0.1]" />

      {/* Metronome */}
      <MetronomePopover bpm={bpm} onBpmChange={setBpm} />

      {/* Sustain Pedal Indicator */}
      <div className="w-px h-4 bg-white/[0.1]" />
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`h-6 px-2 rounded-lg text-[10px] font-mono font-medium flex items-center transition-all ${
              sustainDown
                ? "liquid-glass-accent text-primary shadow-[0_0_10px_rgba(var(--theme-color-rgb),0.25)]"
                : "text-zinc-500"
            }`}
          >
            Ped
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>Sustain Pedal ({sustainDown ? "Down" : "Up"})</span>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
