import React from "react";
import { ChevronDown, Split, Music2, Volume2, VolumeX, GraduationCap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useThemeStore } from "@/stores/useThemeStore";
import { midiToNoteName } from "@/engine/pianoLayout";
import type { HandRole } from "@/types/midi";

export const HandControlsPopover: React.FC = () => {
  const activeSong = useLibraryStore((s) => s.activeSong);

  const rightHandActive = usePlaybackStore((s) => s.rightHandActive);
  const leftHandActive = usePlaybackStore((s) => s.leftHandActive);
  const setRightHandActive = usePlaybackStore((s) => s.setRightHandActive);
  const setLeftHandActive = usePlaybackStore((s) => s.setLeftHandActive);

  const muteInactiveHandAudio = usePlaybackStore((s) => s.muteInactiveHandAudio);
  const setMuteInactiveHandAudio = usePlaybackStore((s) => s.setMuteInactiveHandAudio);

  const studyMode = usePlaybackStore((s) => s.studyMode);
  const setStudyMode = usePlaybackStore((s) => s.setStudyMode);

  const trackHands = usePlaybackStore((s) => s.trackHands);
  const setTrackHands = usePlaybackStore((s) => s.setTrackHands);

  const splitPointMidi = usePlaybackStore((s) => s.splitPointMidi);
  const setSplitPointMidi = usePlaybackStore((s) => s.setSplitPointMidi);

  const useSplitPoint = usePlaybackStore((s) => s.useSplitPoint);
  const setUseSplitPoint = usePlaybackStore((s) => s.setUseSplitPoint);

  const rightHandColor = useThemeStore((s) => s.rightHandColor);
  const leftHandColor = useThemeStore((s) => s.leftHandColor);

  const handleTrackRoleChange = (trackIndex: number, role: HandRole) => {
    const updated = { ...trackHands, [trackIndex]: role };
    setTrackHands(updated);
  };

  const hasBothRole = Object.values(trackHands).some((r) => r === "both");
  const showSplitSlider = useSplitPoint || hasBothRole;

  // Active label for the dock trigger button
  const triggerLabel =
    leftHandActive && rightHandActive
      ? "Both"
      : leftHandActive
        ? "Left"
        : rightHandActive
          ? "Right"
          : "Muted";

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={`h-6 px-1.5 rounded-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-200 hover:text-white transition-all cursor-pointer shadow-sm shrink-0 ${
                studyMode ? "liquid-glass-accent" : "liquid-glass-btn"
              }`}
              aria-label="Practice Hands Settings"
            >
              {/* Dual Hand Glowing Dots */}
              <div className="flex items-center gap-1 shrink-0">
                <span
                  className="w-1.5 h-1.5 rounded-full transition-opacity shadow-[0_0_5px_currentColor]"
                  style={{
                    backgroundColor: leftHandColor,
                    opacity: leftHandActive ? 1 : 0.25,
                  }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full transition-opacity shadow-[0_0_5px_currentColor]"
                  style={{
                    backgroundColor: rightHandColor,
                    opacity: rightHandActive ? 1 : 0.25,
                  }}
                />
              </div>

              {studyMode && (
                <GraduationCap className="w-3 h-3 text-primary shrink-0" />
              )}

              <span className="w-8 text-center truncate shrink-0">{triggerLabel}</span>
              <ChevronDown className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>Practice Hands & Track Settings</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="center"
        className="w-auto  p-3.5 space-y-3.5 liquid-glass-popover rounded-2xl shadow-2xl"
      >
        {/* Practice Mode Filter */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400">
              Practice Hands
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              Visual Focus
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg liquid-glass-btn">
            <button
              onClick={() => {
                setLeftHandActive(true);
                setRightHandActive(false);
              }}
              className={`py-1 rounded-md text-[11px] font-medium transition-all active:scale-[0.97] cursor-pointer flex items-center justify-center gap-1 ${leftHandActive && !rightHandActive
                ? "liquid-glass-active text-zinc-100 font-semibold"
                : "text-zinc-400 hover:text-zinc-200"
                }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: leftHandColor }}
              />
              Left Only
            </button>

            <button
              onClick={() => {
                setLeftHandActive(true);
                setRightHandActive(true);
              }}
              className={`py-1 rounded-md text-[11px] font-medium transition-all active:scale-[0.97] cursor-pointer ${leftHandActive && rightHandActive
                ? "liquid-glass-active text-zinc-100 font-semibold"
                : "text-zinc-400 hover:text-zinc-200"
                }`}
            >
              Both Hands
            </button>

            <button
              onClick={() => {
                setLeftHandActive(false);
                setRightHandActive(true);
              }}
              className={`py-1 rounded-md text-[11px] font-medium transition-all active:scale-[0.97] cursor-pointer flex items-center justify-center gap-1 ${!leftHandActive && rightHandActive
                ? "liquid-glass-active text-zinc-100 font-semibold"
                : "text-zinc-400 hover:text-zinc-200"
                }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: rightHandColor }}
              />
              Right Only
            </button>
          </div>
        </div>

        {/* Study Mode (Wait for Input) Toggle */}
        <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
              <GraduationCap
                className={`w-3.5 h-3.5 ${studyMode ? "text-primary" : "text-zinc-400"}`}
              />
              <span>Study Mode</span>
            </div>
            <p className="text-[10px] text-zinc-400 leading-tight">
              {leftHandActive && rightHandActive
                ? "Waits for both hands"
                : rightHandActive && !leftHandActive
                  ? "Waits for right hand only"
                  : leftHandActive && !rightHandActive
                    ? "Waits for left hand only"
                    : "No practiced hand selected"}
            </p>
          </div>
          <Switch checked={studyMode} onCheckedChange={setStudyMode} />
        </div>

        {/* Option to hear both hands even when focusing on one */}
        {(!leftHandActive || !rightHandActive) && (
          <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-between gap-2 animate-in fade-in-50 duration-200">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                {muteInactiveHandAudio ? (
                  <VolumeX className="w-3 h-3 text-zinc-400" />
                ) : (
                  <Volume2 className="w-3 h-3 text-primary" />
                )}
                <span>Hear accompaniment audio</span>
              </div>
              <p className="text-[10px] text-zinc-400 leading-tight">
                {muteInactiveHandAudio
                  ? "Inactive hand audio is silenced"
                  : "Inactive hand audio still plays while visually dimmed"}
              </p>
            </div>
            <Switch
              checked={!muteInactiveHandAudio}
              onCheckedChange={(val) => setMuteInactiveHandAudio(!val)}
            />
          </div>
        )}

        <Separator className="bg-white/[0.08]" />

        {/* Split by Pitch Toggle */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                <Split className="w-3.5 h-3.5 text-primary" />
                <span>Split by pitch</span>
              </div>
              <p className="text-[10px] text-zinc-400 leading-tight">
                Divide notes into left/right at a keyboard split key
              </p>
            </div>
            <Switch
              checked={useSplitPoint}
              onCheckedChange={setUseSplitPoint}
            />
          </div>

          {/* Split Point Slider */}
          {showSplitSlider && (
            <div className="p-2 rounded-lg bg-black/30 border border-white/[0.08] space-y-2 animate-in fade-in-50 duration-200">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] text-zinc-400">Split Key</span>
                <span className="font-mono font-semibold text-primary tabular-nums">
                  {midiToNoteName(splitPointMidi)} ({splitPointMidi})
                </span>
              </div>
              <Slider
                min={36} // C2
                max={84} // C6
                step={1}
                value={[splitPointMidi]}
                onValueChange={([val]) => setSplitPointMidi(val)}
              />
              <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                <span>C2 (Bass)</span>
                <span>C4 (Middle)</span>
                <span>C6 (Treble)</span>
              </div>
            </div>
          )}
        </div>

        {/* Track Hand Assignments (Multi-track mode) */}
        {!useSplitPoint && activeSong && activeSong.tracks.length > 0 && (
          <>
            <Separator className="bg-white/[0.08]" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                  <Music2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Tracks ({activeSong.tracks.length})</span>
                </div>
                <span className="text-[10px] text-zinc-500">Per-track Hand</span>
              </div>

              <ScrollArea className="max-h-44 pr-1">
                <div className="space-y-1.5">
                  {activeSong.tracks.map((track) => {
                    const currentRole = trackHands[track.trackIndex] || track.defaultHand || "right";

                    return (
                      <div
                        key={track.trackIndex}
                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-zinc-200 text-[11px]">
                            {track.name.trim() || `Track ${track.trackIndex + 1}`}
                          </p>
                          <p className="text-[10px] text-zinc-500 tabular-nums">
                            {track.noteCount} notes
                          </p>
                        </div>

                        {/* Segmented Hand Pill (R / L / Split / Off) */}
                        <div className="flex items-center p-0.5 rounded-lg liquid-glass-btn shrink-0">
                          {(["right", "left", "both", "none"] as HandRole[]).map((role) => {
                            const isSelected = currentRole === role;
                            const label =
                              role === "right"
                                ? "R"
                                : role === "left"
                                  ? "L"
                                  : role === "both"
                                    ? "Split"
                                    : "Off";

                            return (
                              <button
                                key={role}
                                onClick={() => handleTrackRoleChange(track.trackIndex, role)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all active:scale-[0.97] cursor-pointer ${isSelected
                                  ? "liquid-glass-active text-zinc-100 font-semibold"
                                  : "text-zinc-500 hover:text-zinc-300"
                                  }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
