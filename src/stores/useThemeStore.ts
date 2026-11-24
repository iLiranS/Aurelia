import { create } from "zustand";
import { THEME_PRESETS, type ThemePreset } from "@/themes/presets";
import { setAppSetting } from "@/services/tauriApi";
import { applyAppThemeColor } from "@/themes/themeColor";

export { THEME_PRESETS, type ThemePreset };

export type VfxPreset = "embers" | "sparks" | "mist" | "off";

export interface AppearanceSettingsJson {
  presetId: string;
  rightHandColor: string;
  leftHandColor: string;
  particlesEnabled: boolean;
  vfxPreset?: VfxPreset;
  bloomEnabled: boolean;
  lookaheadSec: number;
  showKeyLabels: boolean;
  showNoteLabels?: boolean;
  qwertyPlayEnabled?: boolean;
  previewStartMode?: "peak" | "start";
  previewAudioEnabled?: boolean;
  keyboardVignette?: boolean;
  stageGlowEnabled?: boolean;
  showOctaveGuides?: boolean;
  showMeasureLines?: boolean;
}

interface ThemeState {
  presetId: string;
  bgColor: string;
  rightHandColor: string;
  leftHandColor: string;
  particlesEnabled: boolean;
  vfxPreset: VfxPreset;
  bloomEnabled: boolean;
  lookaheadSec: number;
  showKeyLabels: boolean;
  showNoteLabels: boolean;
  performanceMode: boolean;
  qwertyPlayEnabled: boolean;
  previewStartMode: "peak" | "start";
  previewAudioEnabled: boolean;
  keyboardVignette: boolean;
  stageGlowEnabled: boolean;
  showOctaveGuides: boolean;
  showMeasureLines: boolean;

  setPreset: (presetId: string) => void;
  setRightHandColor: (color: string) => void;
  setLeftHandColor: (color: string) => void;
  setParticlesEnabled: (enabled: boolean) => void;
  setVfxPreset: (preset: VfxPreset) => void;
  setBloomEnabled: (enabled: boolean) => void;
  setLookaheadSec: (seconds: number) => void;
  setShowKeyLabels: (show: boolean) => void;
  setShowNoteLabels: (show: boolean) => void;
  setPerformanceMode: (perf: boolean) => void;
  togglePerformanceMode: () => void;
  setQwertyPlayEnabled: (enabled: boolean) => void;
  setPreviewStartMode: (mode: "peak" | "start") => void;
  setPreviewAudioEnabled: (enabled: boolean) => void;
  setKeyboardVignette: (enabled: boolean) => void;
  setStageGlowEnabled: (enabled: boolean) => void;
  setShowOctaveGuides: (show: boolean) => void;
  setShowMeasureLines: (show: boolean) => void;
  hydrateAppearance: (jsonStr: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistAppearanceDebounced(state: ThemeState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const data: AppearanceSettingsJson = {
        presetId: state.presetId,
        rightHandColor: state.rightHandColor,
        leftHandColor: state.leftHandColor,
        particlesEnabled: state.particlesEnabled,
        vfxPreset: state.vfxPreset,
        bloomEnabled: state.bloomEnabled,
        lookaheadSec: state.lookaheadSec,
        showKeyLabels: state.showKeyLabels,
        showNoteLabels: state.showNoteLabels,
        qwertyPlayEnabled: state.qwertyPlayEnabled,
        previewStartMode: state.previewStartMode,
        previewAudioEnabled: state.previewAudioEnabled,
        keyboardVignette: state.keyboardVignette,
        stageGlowEnabled: state.stageGlowEnabled,
        showOctaveGuides: state.showOctaveGuides,
        showMeasureLines: state.showMeasureLines,
      };
      await setAppSetting("appearance_v1", JSON.stringify(data));
    } catch (err) {
      console.warn("Failed to save appearance settings:", err);
    }
  }, 400);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  presetId: "midnight-opal",
  bgColor: "#080a10",
  rightHandColor: "#7dd3fc",
  leftHandColor: "#a78bfa",
  particlesEnabled: true,
  vfxPreset: "embers",
  bloomEnabled: true,
  lookaheadSec: 3.0,
  showKeyLabels: true,
  showNoteLabels: false,
  performanceMode: false,
  qwertyPlayEnabled: false,
  previewStartMode: "peak",
  previewAudioEnabled: true,
  keyboardVignette: true,
  stageGlowEnabled: true,
  showOctaveGuides: true,
  showMeasureLines: true,

  setPreset: (presetId) => {
    const found = THEME_PRESETS.find((p) => p.id === presetId);
    if (found) {
      applyAppThemeColor(found.rightHandColor);
      set({
        presetId,
        bgColor: found.bgColor,
        rightHandColor: found.rightHandColor,
        leftHandColor: found.leftHandColor,
      });
    } else {
      set({ presetId });
    }
    persistAppearanceDebounced(get());
  },

  setRightHandColor: (rightHandColor) => {
    applyAppThemeColor(rightHandColor);
    set({ rightHandColor, presetId: "custom" });
    persistAppearanceDebounced(get());
  },

  setLeftHandColor: (leftHandColor) => {
    set({ leftHandColor, presetId: "custom" });
    persistAppearanceDebounced(get());
  },

  setParticlesEnabled: (particlesEnabled) => {
    const vfxPreset: VfxPreset = particlesEnabled
      ? get().vfxPreset === "sparks"
        ? "sparks"
        : "embers"
      : "off";
    set({ particlesEnabled, vfxPreset });
    persistAppearanceDebounced(get());
  },

  setVfxPreset: (vfxPreset) => {
    const particlesEnabled = vfxPreset === "embers" || vfxPreset === "sparks";
    set({ vfxPreset, particlesEnabled });
    persistAppearanceDebounced(get());
  },

  setBloomEnabled: (bloomEnabled) => {
    set({ bloomEnabled });
    persistAppearanceDebounced(get());
  },

  setLookaheadSec: (lookaheadSec) => {
    set({ lookaheadSec });
    persistAppearanceDebounced(get());
  },

  setShowKeyLabels: (showKeyLabels) => {
    set({ showKeyLabels });
    persistAppearanceDebounced(get());
  },

  setShowNoteLabels: (showNoteLabels) => {
    set({ showNoteLabels });
    persistAppearanceDebounced(get());
  },

  setPerformanceMode: (performanceMode) => set({ performanceMode }),
  togglePerformanceMode: () =>
    set((state) => ({ performanceMode: !state.performanceMode })),

  setQwertyPlayEnabled: (qwertyPlayEnabled) => {
    set({ qwertyPlayEnabled });
    persistAppearanceDebounced(get());
  },

  setPreviewStartMode: (previewStartMode) => {
    set({ previewStartMode });
    persistAppearanceDebounced(get());
  },

  setPreviewAudioEnabled: (previewAudioEnabled) => {
    set({ previewAudioEnabled });
    persistAppearanceDebounced(get());
  },

  setKeyboardVignette: (keyboardVignette) => {
    set({ keyboardVignette });
    persistAppearanceDebounced(get());
  },

  setStageGlowEnabled: (stageGlowEnabled) => {
    set({ stageGlowEnabled });
    persistAppearanceDebounced(get());
  },

  setShowOctaveGuides: (showOctaveGuides) => {
    set({ showOctaveGuides });
    persistAppearanceDebounced(get());
  },

  setShowMeasureLines: (showMeasureLines) => {
    set({ showMeasureLines });
    persistAppearanceDebounced(get());
  },

  hydrateAppearance: (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr) as Partial<AppearanceSettingsJson>;
      set((state) => {
        const preset = parsed.presetId
          ? THEME_PRESETS.find((p) => p.id === parsed.presetId)
          : undefined;

        const nextRight =
          parsed.rightHandColor ?? preset?.rightHandColor ?? state.rightHandColor;
        applyAppThemeColor(nextRight);

        const nextVfxPreset: VfxPreset =
          parsed.vfxPreset === "embers" ||
          parsed.vfxPreset === "sparks" ||
          parsed.vfxPreset === "mist" ||
          parsed.vfxPreset === "off"
            ? parsed.vfxPreset
            : parsed.particlesEnabled === false
              ? "off"
              : state.vfxPreset;

        const nextParticlesEnabled =
          nextVfxPreset === "embers" || nextVfxPreset === "sparks";

        return {
          ...state,
          presetId: parsed.presetId ?? state.presetId,
          bgColor: preset?.bgColor ?? state.bgColor,
          rightHandColor: nextRight,
          leftHandColor:
            parsed.leftHandColor ?? preset?.leftHandColor ?? state.leftHandColor,
          particlesEnabled: nextParticlesEnabled,
          vfxPreset: nextVfxPreset,
          bloomEnabled: parsed.bloomEnabled ?? state.bloomEnabled,
          lookaheadSec: parsed.lookaheadSec ?? state.lookaheadSec,
          showKeyLabels: parsed.showKeyLabels ?? state.showKeyLabels,
          showNoteLabels: parsed.showNoteLabels ?? state.showNoteLabels,
          qwertyPlayEnabled: parsed.qwertyPlayEnabled ?? state.qwertyPlayEnabled,
          previewStartMode: parsed.previewStartMode ?? state.previewStartMode,
          previewAudioEnabled:
            parsed.previewAudioEnabled ?? state.previewAudioEnabled,
          keyboardVignette: parsed.keyboardVignette ?? state.keyboardVignette,
          stageGlowEnabled: parsed.stageGlowEnabled ?? state.stageGlowEnabled,
          showOctaveGuides: parsed.showOctaveGuides ?? state.showOctaveGuides,
          showMeasureLines: parsed.showMeasureLines ?? state.showMeasureLines,
        };
      });
    } catch (err) {
      console.warn("Failed to parse appearance settings JSON:", err);
    }
  },
}));

// Apply initial default theme color immediately on module load
applyAppThemeColor("#f5c26b");

