import { create } from "zustand";
import type { SoundFontInfo, TouchPreset, SoundProfile } from "@/types/midi";
import {
  listSoundfonts,
  selectSoundfont as apiSelectSoundfont,
  importSoundfont as apiImportSoundfont,
  audioSetSoundProfile,
  setAppSetting,
} from "@/services/tauriApi";

interface SoundState {
  soundfonts: SoundFontInfo[];
  activeSoundFontPath: string | null;
  isSwitchingSoundFont: boolean;
  reverbMix: number; // 0.0 .. 0.45, default 0.18
  touch: TouchPreset; // 'soft' | 'balanced' | 'strong', default 'balanced'

  fetchSoundfonts: () => Promise<void>;
  selectSoundFont: (path: string) => Promise<void>;
  importSoundFont: () => Promise<SoundFontInfo | null>;
  setReverbMix: (mix: number) => void;
  setTouch: (touch: TouchPreset) => void;
  hydrateSoundProfile: (rawJson: string) => void;
  setActiveSoundFontPath: (path: string | null) => void;
  setIsSwitchingSoundFont: (switching: boolean) => void;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveProfile(profile: SoundProfile) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    setAppSetting("sound_profile_v1", JSON.stringify(profile)).catch(() => {});
  }, 300);
}

export const useSoundStore = create<SoundState>((set, get) => ({
  soundfonts: [],
  activeSoundFontPath: null,
  isSwitchingSoundFont: false,
  reverbMix: 0.18,
  touch: "balanced",

  setActiveSoundFontPath: (path: string | null) => set({ activeSoundFontPath: path }),
  setIsSwitchingSoundFont: (switching: boolean) => set({ isSwitchingSoundFont: switching }),

  fetchSoundfonts: async () => {
    try {
      const list = await listSoundfonts();
      set({ soundfonts: list });
      if (!get().activeSoundFontPath && list.length > 0) {
        set({ activeSoundFontPath: list[0].path });
      }
    } catch (err) {
      console.error("Failed to fetch soundfonts:", err);
    }
  },

  selectSoundFont: async (path: string) => {
    if (get().activeSoundFontPath === path) return;
    set({ isSwitchingSoundFont: true });
    try {
      await apiSelectSoundfont(path);
      set({ activeSoundFontPath: path });
    } catch (err) {
      console.error("Failed to select soundfont:", err);
      set({ isSwitchingSoundFont: false });
    }
  },

  importSoundFont: async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "SoundFont", extensions: ["sf2"] }],
      });
      if (typeof selected === "string") {
        set({ isSwitchingSoundFont: true });
        const imported = await apiImportSoundfont(selected);
        if (imported) {
          await get().fetchSoundfonts();
          set({ activeSoundFontPath: imported.path });
          return imported;
        }
      }
    } catch (err) {
      console.error("Failed to import soundfont:", err);
    } finally {
      set({ isSwitchingSoundFont: false });
    }
    return null;
  },

  setReverbMix: (reverbMix: number) => {
    const clamped = Math.max(0, Math.min(0.45, reverbMix));
    set({ reverbMix: clamped });
    const touch = get().touch;
    audioSetSoundProfile({ reverbMix: clamped, touch }).catch(() => {});
    debouncedSaveProfile({ reverbMix: clamped, touch });
  },

  setTouch: (touch: TouchPreset) => {
    set({ touch });
    const reverbMix = get().reverbMix;
    audioSetSoundProfile({ reverbMix, touch }).catch(() => {});
    debouncedSaveProfile({ reverbMix, touch });
  },

  hydrateSoundProfile: (rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson);
      const reverbMix =
        typeof parsed.reverbMix === "number"
          ? Math.max(0, Math.min(0.45, parsed.reverbMix))
          : 0.18;
      const touch: TouchPreset = ["soft", "balanced", "strong"].includes(
        parsed.touch
      )
        ? parsed.touch
        : "balanced";
      set({ reverbMix, touch });
      audioSetSoundProfile({ reverbMix, touch }).catch(() => {});
    } catch (e) {
      console.warn("Failed to parse sound profile:", e);
    }
  },
}));
