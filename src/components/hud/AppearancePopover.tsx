import React, { useState, useEffect } from "react";
import {
  Palette,
  Sparkles,
  Sun,
  Tag,
  Type,
  Keyboard,
  Volume2,
  Flame,
  Plus,
  Loader2,
  ChevronDown,
  FolderOpen,
  Contrast,
  Layers,
  Columns3,
  Rows3,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useThemeStore, THEME_PRESETS, type VfxPreset } from "@/stores/useThemeStore";
import { useSoundStore } from "@/stores/useSoundStore";
import { useLibraryStore } from "@/stores/useLibraryStore";

type SettingsTab = "graphics" | "sound" | "practice";

const SNAP_POINTS: Array<{ value: number; label: string }> = [
  { value: 1.5, label: "Fast" },
  { value: 3.0, label: "Default" },
  { value: 5.0, label: "Slow" },
];

function snapLookahead(raw: number): number {
  for (const pt of SNAP_POINTS) {
    if (Math.abs(raw - pt.value) <= 0.15) return pt.value;
  }
  return Math.round(raw * 10) / 10;
}

function formatLookaheadLabel(val: number): string {
  const match = SNAP_POINTS.find((pt) => Math.abs(val - pt.value) < 0.01);
  return match ? `${val.toFixed(1)}s · ${match.label}` : `${val.toFixed(1)}s`;
}

function getFolderDisplayName(rootFolder: string | null): string {
  if (!rootFolder) return "No folder selected";
  const parts = rootFolder.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || rootFolder;
}

export const AppearancePopover: React.FC = () => {
  const presetId = useThemeStore((s) => s.presetId);
  const setPreset = useThemeStore((s) => s.setPreset);
  const rightHandColor = useThemeStore((s) => s.rightHandColor);
  const leftHandColor = useThemeStore((s) => s.leftHandColor);
  const setRightHandColor = useThemeStore((s) => s.setRightHandColor);
  const setLeftHandColor = useThemeStore((s) => s.setLeftHandColor);

  const bloomEnabled = useThemeStore((s) => s.bloomEnabled);
  const setBloomEnabled = useThemeStore((s) => s.setBloomEnabled);
  const vfxPreset = useThemeStore((s) => s.vfxPreset);
  const setVfxPreset = useThemeStore((s) => s.setVfxPreset);
  const keyboardVignette = useThemeStore((s) => s.keyboardVignette);
  const setKeyboardVignette = useThemeStore((s) => s.setKeyboardVignette);
  const stageGlowEnabled = useThemeStore((s) => s.stageGlowEnabled);
  const setStageGlowEnabled = useThemeStore((s) => s.setStageGlowEnabled);
  const showOctaveGuides = useThemeStore((s) => s.showOctaveGuides);
  const setShowOctaveGuides = useThemeStore((s) => s.setShowOctaveGuides);
  const showMeasureLines = useThemeStore((s) => s.showMeasureLines);
  const setShowMeasureLines = useThemeStore((s) => s.setShowMeasureLines);

  const lookaheadSec = useThemeStore((s) => s.lookaheadSec);
  const setLookaheadSec = useThemeStore((s) => s.setLookaheadSec);
  const showKeyLabels = useThemeStore((s) => s.showKeyLabels);
  const setShowKeyLabels = useThemeStore((s) => s.setShowKeyLabels);
  const showNoteLabels = useThemeStore((s) => s.showNoteLabels);
  const setShowNoteLabels = useThemeStore((s) => s.setShowNoteLabels);
  const qwertyPlayEnabled = useThemeStore((s) => s.qwertyPlayEnabled);
  const setQwertyPlayEnabled = useThemeStore((s) => s.setQwertyPlayEnabled);
  const previewStartMode = useThemeStore((s) => s.previewStartMode);
  const setPreviewStartMode = useThemeStore((s) => s.setPreviewStartMode);
  const previewAudioEnabled = useThemeStore((s) => s.previewAudioEnabled);
  const setPreviewAudioEnabled = useThemeStore((s) => s.setPreviewAudioEnabled);

  const soundfonts = useSoundStore((s) => s.soundfonts);
  const activeSoundFontPath = useSoundStore((s) => s.activeSoundFontPath);
  const isSwitchingSoundFont = useSoundStore((s) => s.isSwitchingSoundFont);
  const selectSoundFont = useSoundStore((s) => s.selectSoundFont);
  const importSoundFont = useSoundStore((s) => s.importSoundFont);
  const reverbMix = useSoundStore((s) => s.reverbMix);
  const setReverbMix = useSoundStore((s) => s.setReverbMix);
  const touch = useSoundStore((s) => s.touch);
  const setTouch = useSoundStore((s) => s.setTouch);

  const rootFolder = useLibraryStore((s) => s.rootFolder);
  const selectFolder = useLibraryStore((s) => s.selectFolder);

  const [activeTab, setActiveTab] = useState<SettingsTab>("graphics");
  const [isSliderHovered, setIsSliderHovered] = useState(false);
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  // Global pointerup listener ensures drag state releases cleanly
  useEffect(() => {
    if (!isSliderDragging) return;
    const handleUp = () => setIsSliderDragging(false);
    window.addEventListener("pointerup", handleUp);
    return () => window.removeEventListener("pointerup", handleUp);
  }, [isSliderDragging]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className="w-7 h-7 rounded-lg liquid-glass-btn flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-all cursor-pointer shadow-sm"
              aria-label="Studio Settings"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>Studio Settings</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-80 p-3.5 space-y-3 liquid-glass-popover rounded-2xl shadow-2xl"
      >
        {/* Header + 3-Tab Segmented Bar */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">
              Studio Settings
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl bg-black/40 border border-white/[0.08]">
            {(
              [
                { id: "graphics", label: "Graphics" },
                { id: "sound", label: "Sound" },
                { id: "practice", label: "Practice" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-1 text-[11px] font-medium rounded-lg cursor-pointer transition-all liquid-glass-segment ${
                  activeTab === tab.id
                    ? "liquid-glass-segment-active text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* TAB 1: GRAPHICS */}
        {activeTab === "graphics" && (
          <div className="space-y-3">
            {/* 5 Curated Theme Presets */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400">
                Theme
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {THEME_PRESETS.map((p) => {
                  const isSelected = presetId === p.id;
                  return (
                    <Tooltip key={p.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setPreset(p.id)}
                          className={`h-9 rounded-xl flex items-center justify-center gap-1 cursor-pointer liquid-glass-segment ${
                            isSelected
                              ? "liquid-glass-segment-active"
                              : "hover:border-white/20"
                          }`}
                          aria-label={p.name}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shadow-[0_0_4px_currentColor]"
                            style={{
                              backgroundColor: p.leftHandColor,
                              color: p.leftHandColor,
                            }}
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shadow-[0_0_4px_currentColor]"
                            style={{
                              backgroundColor: p.rightHandColor,
                              color: p.rightHandColor,
                            }}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <span>{p.name}</span>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* Custom Hand Colors */}
            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex items-center justify-between px-2.5 py-1.5 rounded-lg liquid-glass-btn cursor-pointer transition-all">
                <span className="text-[11px] text-zinc-300">Left Hand</span>
                <input
                  type="color"
                  value={leftHandColor}
                  onChange={(e) => setLeftHandColor(e.target.value)}
                  className="w-4 h-4 rounded-full border-0 p-0 cursor-pointer bg-transparent"
                />
              </label>

              <label className="flex items-center justify-between px-2.5 py-1.5 rounded-lg liquid-glass-btn cursor-pointer transition-all">
                <span className="text-[11px] text-zinc-300">Right Hand</span>
                <input
                  type="color"
                  value={rightHandColor}
                  onChange={(e) => setRightHandColor(e.target.value)}
                  className="w-4 h-4 rounded-full border-0 p-0 cursor-pointer bg-transparent"
                />
              </label>
            </div>

            <Separator className="bg-white/[0.08]" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Bloom Glow</span>
                </div>
                <Switch
                  checked={bloomEnabled}
                  onCheckedChange={setBloomEnabled}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Particles</span>
                </div>
                <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
                  {(
                    ["embers", "sparks", "mist", "off"] as readonly VfxPreset[]
                  ).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setVfxPreset(preset)}
                      className={`px-1.5 py-0.5 text-[10px] font-medium rounded-md cursor-pointer transition-all capitalize liquid-glass-segment ${
                        vfxPreset === preset
                          ? "liquid-glass-segment-active text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Contrast className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Keyboard Vignette</span>
                </div>
                <Switch
                  checked={keyboardVignette}
                  onCheckedChange={setKeyboardVignette}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Aurora &amp; Mist</span>
                </div>
                <Switch
                  checked={stageGlowEnabled}
                  onCheckedChange={setStageGlowEnabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Columns3 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Octave Guides</span>
                </div>
                <Switch
                  checked={showOctaveGuides}
                  onCheckedChange={setShowOctaveGuides}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Rows3 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Measure Lines</span>
                </div>
                <Switch
                  checked={showMeasureLines}
                  onCheckedChange={setShowMeasureLines}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SOUND */}
        {activeTab === "sound" && (
          <div className="space-y-3">
            {/* Piano Voice Row */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-200">Piano Voice</span>
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
                      aria-label="Import custom .sf2 SoundFont"
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

              <div className="relative">
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
            </div>

            <Separator className="bg-white/[0.08]" />

            {/* Reverb Slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-200">Room Reverb</span>
                <span className="text-zinc-400 font-mono tabular-nums">
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

            {/* Touch Feel Pills */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-200">Touch Feel</span>
              <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
                {(["soft", "balanced", "strong"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTouch(t)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md cursor-pointer transition-all capitalize liquid-glass-segment ${
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

            <Separator className="bg-white/[0.08]" />

            {/* Hover Audio */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Hover Audio</span>
              </div>
              <Switch
                checked={previewAudioEnabled}
                onCheckedChange={setPreviewAudioEnabled}
              />
            </div>
          </div>
        )}

        {/* TAB 3: PRACTICE */}
        {activeTab === "practice" && (
          <div className="space-y-3">
            {/* Single-Row Snapping Fall Speed Slider */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-200">Fall Speed</span>
              <div
                className="relative w-36 py-1"
                onMouseEnter={() => setIsSliderHovered(true)}
                onMouseLeave={() => setIsSliderHovered(false)}
              >
                {/* Hover / Drag Floating Value Readout */}
                <div
                  className={`absolute -top-5 right-0 font-mono text-[10px] text-primary px-1.5 py-0.5 rounded-md liquid-glass-popover pointer-events-none transition-opacity duration-150 tabular-nums ${
                    isSliderHovered || isSliderDragging
                      ? "opacity-100"
                      : "opacity-0"
                  }`}
                >
                  {formatLookaheadLabel(lookaheadSec)}
                </div>

                <Slider
                  min={1.5}
                  max={5.0}
                  step={0.1}
                  value={[lookaheadSec]}
                  onValueChange={([val]) => setLookaheadSec(snapLookahead(val))}
                  onPointerDown={() => setIsSliderDragging(true)}
                />

                {/* Subtle detent ticks beneath track (1.5s, 3.0s, 5.0s) */}
                <div className="relative w-full h-1 pointer-events-none mt-1">
                  <span className="absolute left-0 -translate-x-1/2 w-1 h-1 rounded-full bg-white/20" />
                  <span className="absolute left-[42.86%] -translate-x-1/2 w-1 h-1 rounded-full bg-white/20" />
                  <span className="absolute left-full -translate-x-1/2 w-1 h-1 rounded-full bg-white/20" />
                </div>
              </div>
            </div>

            <Separator className="bg-white/[0.08]" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Tag className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Key Labels</span>
                </div>
                <Switch
                  checked={showKeyLabels}
                  onCheckedChange={setShowKeyLabels}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Type className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Note Labels</span>
                </div>
                <Switch
                  checked={showNoteLabels}
                  onCheckedChange={setShowNoteLabels}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-zinc-200">
                  <Keyboard className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Keyboard Piano (QWERTY)</span>
                </div>
                <Switch
                  checked={qwertyPlayEnabled}
                  onCheckedChange={setQwertyPlayEnabled}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-zinc-200">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>Preview Start</span>
                </div>
                <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
                  <button
                    onClick={() => setPreviewStartMode("peak")}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md cursor-pointer liquid-glass-segment ${
                      previewStartMode === "peak"
                        ? "liquid-glass-segment-active text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Peak
                  </button>
                  <button
                    onClick={() => setPreviewStartMode("start")}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md cursor-pointer liquid-glass-segment ${
                      previewStartMode === "start"
                        ? "liquid-glass-segment-active text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>

            <Separator className="bg-white/[0.08]" />

            {/* MIDI Library Folder Action Row */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-zinc-200">MIDI Library</div>
                <div
                  className="text-[10px] text-zinc-400 truncate"
                  title={rootFolder || undefined}
                >
                  {getFolderDisplayName(rootFolder)}
                </div>
              </div>
              <button
                onClick={() => selectFolder()}
                className="h-7 px-2.5 rounded-lg liquid-glass-btn text-[11px] font-medium text-zinc-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
                aria-label="Select MIDI Folder"
              >
                <FolderOpen className="w-3.5 h-3.5 text-primary" />
                <span>Select Folder</span>
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
