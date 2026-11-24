import React, { useState } from "react";
import {
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sparkles,
  Unplug,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  useMidiStore,
  type KeyboardRangePreset,
} from "@/stores/useMidiStore";
import { midiToNoteName } from "@/engine/pianoLayout";
import { listMidiDevices } from "@/services/tauriApi";

const SIZE_PILLS: Array<{ label: string; preset: KeyboardRangePreset; match: KeyboardRangePreset[] }> = [
  { label: "88", preset: "88", match: ["88"] },
  { label: "61", preset: "61", match: ["61"] },
  { label: "49", preset: "49", match: ["49"] },
  { label: "32", preset: "32-f", match: ["32-f", "32-c"] },
  { label: "25", preset: "25", match: ["25"] },
];

function presetForSuggestedCount(count: number | null | undefined): KeyboardRangePreset | null {
  switch (count) {
    case 88:
      return "88";
    case 61:
      return "61";
    case 49:
      return "49";
    case 37:
      return "37";
    case 32:
      return "32-f";
    case 25:
      return "25";
    default:
      return null;
  }
}

export const MidiDevicePopover: React.FC = () => {
  const devices = useMidiStore((s) => s.devices);
  const connectedDevice = useMidiStore((s) => s.connectedDevice);
  const rangePreset = useMidiStore((s) => s.rangePreset);
  const minMidi = useMidiStore((s) => s.minMidi);
  const keyCount = useMidiStore((s) => s.keyCount);
  const autoOctaveFollow = useMidiStore((s) => s.autoOctaveFollow);
  const dimOutOfRange = useMidiStore((s) => s.dimOutOfRange);
  const skipOutOfRangeInStudy = useMidiStore((s) => s.skipOutOfRangeInStudy);

  const setDevices = useMidiStore((s) => s.setDevices);
  const connectDevice = useMidiStore((s) => s.connectDevice);
  const disconnectDevice = useMidiStore((s) => s.disconnectDevice);
  const setRangePreset = useMidiStore((s) => s.setRangePreset);
  const shiftOctave = useMidiStore((s) => s.shiftOctave);
  const setAutoOctaveFollow = useMidiStore((s) => s.setAutoOctaveFollow);
  const setDimOutOfRange = useMidiStore((s) => s.setDimOutOfRange);
  const setSkipOutOfRangeInStudy = useMidiStore((s) => s.setSkipOutOfRangeInStudy);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const list = await listMidiDevices();
      setDevices(list);
    } finally {
      setIsRefreshing(false);
    }
  };

  const activeDeviceInfo = devices.find((d) => d.name === connectedDevice);
  const suggestedPreset = presetForSuggestedCount(activeDeviceInfo?.suggestedKeyCount);
  const showSuggestionChip =
    Boolean(connectedDevice) &&
    suggestedPreset !== null &&
    activeDeviceInfo?.suggestedKeyCount !== keyCount;

  const maxMidi = Math.min(108, minMidi + keyCount - 1);
  const canShiftDown = minMidi > 21;
  const canShiftUp = maxMidi < 108;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          void handleRefresh();
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className="w-7 h-7 rounded-lg liquid-glass-btn relative flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-all cursor-pointer shadow-sm"
              aria-label="MIDI Keyboard Settings"
            >
              <Cable className="w-3.5 h-3.5" />
              {connectedDevice && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <span>{connectedDevice ? `MIDI: ${connectedDevice}` : "MIDI Keyboard"}</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-72 p-3.5 space-y-3 liquid-glass-popover rounded-2xl shadow-2xl"
      >
        {/* MIDI Input Device */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              MIDI Input
            </span>
            <div className="flex items-center gap-1">
              {connectedDevice && (
                <button
                  onClick={() => disconnectDevice()}
                  className="h-5 px-1.5 rounded-md text-[10px] text-zinc-400 hover:text-red-300 hover:bg-white/5 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Disconnect MIDI Device"
                >
                  <Unplug className="w-2.5 h-2.5" />
                  <span>Disconnect</span>
                </button>
              )}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="w-5 h-5 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh MIDI Devices"
                aria-label="Refresh MIDI Devices"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          <div className="relative">
            <select
              value={connectedDevice ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  connectDevice(val);
                } else {
                  disconnectDevice();
                }
              }}
              className="w-full h-8 pl-2.5 pr-7 rounded-lg bg-zinc-900/80 border border-white/10 text-xs text-zinc-200 appearance-none focus:outline-none focus:border-primary/50 cursor-pointer truncate"
            >
              <option value="">
                {devices.length === 0 ? "No MIDI device detected" : "Select MIDI device…"}
              </option>
              {devices.map((dev) => (
                <option key={dev.name} value={dev.name}>
                  {dev.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {showSuggestionChip && suggestedPreset && (
            <button
              onClick={() => setRangePreset(suggestedPreset)}
              className="w-full h-6 px-2 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/20 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>Detected {activeDeviceInfo?.suggestedKeyCount}-key — Apply?</span>
            </button>
          )}
        </div>

        <Separator className="bg-white/10" />

        {/* Keyboard Size */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Keyboard Size
            </span>
            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
              {keyCount} keys
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1 p-1 rounded-xl liquid-glass-segment">
            {SIZE_PILLS.map((pill) => {
              const isActive = pill.match.includes(rangePreset);
              return (
                <button
                  key={pill.label}
                  onClick={() => {
                    if (!isActive) setRangePreset(pill.preset);
                  }}
                  className={`h-6 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-primary text-zinc-950 font-semibold shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          {(rangePreset === "32-f" || rangePreset === "32-c") && (
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-xs text-zinc-400">Start Key</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg liquid-glass-segment">
                <button
                  onClick={() => setRangePreset("32-f")}
                  className={`px-2 h-5 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                    rangePreset === "32-f"
                      ? "bg-white/15 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  F3
                </button>
                <button
                  onClick={() => setRangePreset("32-c")}
                  className={`px-2 h-5 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                    rangePreset === "32-c"
                      ? "bg-white/15 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  C3
                </button>
              </div>
            </div>
          )}

          {keyCount < 88 && (
            <div className="flex items-center justify-between gap-1.5 pt-0.5">
              <button
                onClick={() => shiftOctave(-1)}
                disabled={!canShiftDown}
                className="h-7 px-2 rounded-lg liquid-glass-btn text-[11px] text-zinc-300 hover:text-white flex items-center gap-0.5 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-3 h-3" />
                <span>-1 Oct</span>
              </button>

              <span className="text-xs font-mono font-medium text-zinc-200 tabular-nums">
                {midiToNoteName(minMidi)} – {midiToNoteName(maxMidi)}
              </span>

              <button
                onClick={() => shiftOctave(1)}
                disabled={!canShiftUp}
                className="h-7 px-2 rounded-lg liquid-glass-btn text-[11px] text-zinc-300 hover:text-white flex items-center gap-0.5 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>+1 Oct</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <Separator className="bg-white/10" />

        {/* Behavior Switches */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-300">Dim Outside Range</span>
            <Switch
              checked={dimOutOfRange}
              onCheckedChange={setDimOutOfRange}
            />
          </div>

          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-zinc-300 cursor-help border-b border-dotted border-zinc-600">
                  Auto-Follow Octave
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[200px] text-[11px]">
                Automatically shifts the active key window when your keyboard&apos;s Octave +/− buttons play notes outside the current range.
              </TooltipContent>
            </Tooltip>
            <Switch
              checked={autoOctaveFollow}
              onCheckedChange={setAutoOctaveFollow}
            />
          </div>

          {keyCount < 88 && (
            <div className="flex items-center justify-between">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-zinc-300 cursor-help border-b border-dotted border-zinc-600">
                    Skip Out-of-Range in Study
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[210px] text-[11px]">
                  Study Mode will auto-play notes outside the active key window instead of waiting on them.
                </TooltipContent>
              </Tooltip>
              <Switch
                checked={skipOutOfRangeInStudy}
                onCheckedChange={setSkipOutOfRangeInStudy}
              />
            </div>
          )}
        </div>

        {/* Pre-Hardware Testing Tip */}
        <p className="text-[10px] text-zinc-500 leading-snug pt-0.5">
          Tip: Alt+Click any key to test auto-octave shift
        </p>
      </PopoverContent>
    </Popover>
  );
};
