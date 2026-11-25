import React from "react";
import { Split, Music2, Volume2, VolumeX, GraduationCap, Sparkles } from "lucide-react";
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

  const melodyOnly = usePlaybackStore((s) => s.melodyOnly);
  const setMelodyOnly = usePlaybackStore((s) => s.setMelodyOnly);

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
  const isRightHandOnly = rightHandActive && !leftHandActive;
  const effectiveMelodyOnly = melodyOnly && isRightHandOnly;

  const splitKeySlider = (
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
  );

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={`h-6 px-2 rounded-full flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                studyMode || effectiveMelodyOnly ? "liquid-glass-accent text-zinc-100" : "liquid-glass-dock-btn"
              }`}
              aria-label="Practice Hands Settings"
            >
              {/* Dual Hand Glowing Dots */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className="w-2 h-2 rounded-full transition-opacity"
                  style={{
                    backgroundColor: leftHandColor,
                    opacity: leftHandActive ? 1 : 0.22,
                    boxShadow: leftHandActive ? `0 0 6px ${leftHandColor}` : undefined,
                  }}
                />
                <span
                  className="w-2 h-2 rounded-full transition-opacity"
                  style={{
                    backgroundColor: rightHandColor,
                    opacity: rightHandActive ? 1 : 0.22,
                    boxShadow: rightHandActive ? `0 0 6px ${rightHandColor}` : undefined,
                  }}
                />
              </div>

              {effectiveMelodyOnly && (
                <Sparkles className="w-3 h-3 text-primary shrink-0" />
              )}
              {studyMode && (
                <GraduationCap className="w-3 h-3 text-primary shrink-0" />
              )}
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

          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl bg-black/40 border border-white/[0.08]">
            <button
              onClick={() => {
                setLeftHandActive(true);
                setRightHandActive(false);
              }}
              className={`py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1 liquid-glass-segment ${leftHandActive && !rightHandActive
                ? "liquid-glass-segment-active text-zinc-100"
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
              className={`py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer liquid-glass-segment ${leftHandActive && rightHandActive
                ? "liquid-glass-segment-active text-zinc-100"
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
              className={`py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1 liquid-glass-segment ${!leftHandActive && rightHandActive
                ? "liquid-glass-segment-active text-zinc-100"
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
              {!leftHandActive && !rightHandActive
                ? "No practiced hand selected"
                : effectiveMelodyOnly
                  ? "Waits for right hand top note only"
                  : leftHandActive && rightHandActive
                    ? "Waits for both hands"
                    : rightHandActive
                      ? "Waits for right hand only"
                      : "Waits for left hand only"}
            </p>
          </div>
          <Switch checked={studyMode} onCheckedChange={setStudyMode} />
        </div>

        {/* Melody Only (Top Note) Toggle — Right Hand Only */}
        {isRightHandOnly && (
          <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-between gap-2 animate-in fade-in-50 duration-200">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                <Sparkles
                  className={`w-3.5 h-3.5 ${melodyOnly ? "text-primary" : "text-zinc-400"}`}
                />
                <span>Melody Only</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 font-normal">
                  Top Note
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 leading-tight">
                {melodyOnly
                  ? "Harmony notes dimmed; Study waits for top note"
                  : "Dim inner chord notes to focus on the melody"}
              </p>
            </div>
            <Switch checked={melodyOnly} onCheckedChange={setMelodyOnly} />
          </div>
        )}

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
                  ? effectiveMelodyOnly
                    ? "Dimmed left hand & harmony notes are silenced"
                    : "Inactive hand audio is silenced"
                  : effectiveMelodyOnly
                    ? "Dimmed left hand & harmony notes still play"
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

          {/* Split Point Slider (only when global Split by pitch is enabled) */}
          {useSplitPoint && splitKeySlider}
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
                        <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08] shrink-0">
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
                                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all cursor-pointer liquid-glass-segment ${isSelected
                                  ? "liquid-glass-segment-active text-zinc-100"
                                  : "text-zinc-400 hover:text-zinc-200"
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
              {hasBothRole && splitKeySlider}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
