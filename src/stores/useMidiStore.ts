import { create } from "zustand";
import type { MidiDeviceInfo, MidiLiveEventPayload } from "@/types/midi";
import { activeNotes } from "@/engine/activeNotes";
import { usePlaybackStore } from "@/stores/usePlaybackStore";
import {
  connectMidiDevice,
  disconnectMidiDevice,
  setAppSetting,
} from "@/services/tauriApi";

export type KeyboardRangePreset = "88" | "61" | "49" | "37" | "32-f" | "32-c" | "25";

export interface RangePresetConfig {
  id: KeyboardRangePreset;
  label: string;
  keyCount: number;
  defaultMinMidi: number;
  defaultRangeLabel: string;
}

export const RANGE_PRESETS: Record<KeyboardRangePreset, RangePresetConfig> = {
  "88": {
    id: "88",
    label: "Full 88 Keys",
    keyCount: 88,
    defaultMinMidi: 21,
    defaultRangeLabel: "A0 – C8",
  },
  "61": {
    id: "61",
    label: "61 Keys",
    keyCount: 61,
    defaultMinMidi: 36,
    defaultRangeLabel: "C2 – C7",
  },
  "49": {
    id: "49",
    label: "49 Keys",
    keyCount: 49,
    defaultMinMidi: 36,
    defaultRangeLabel: "C2 – C6",
  },
  "37": {
    id: "37",
    label: "37 Keys",
    keyCount: 37,
    defaultMinMidi: 48,
    defaultRangeLabel: "C3 – C6",
  },
  "32-f": {
    id: "32-f",
    label: "32 Keys (F start)",
    keyCount: 32,
    defaultMinMidi: 53,
    defaultRangeLabel: "F3 – C6",
  },
  "32-c": {
    id: "32-c",
    label: "32 Keys (C start)",
    keyCount: 32,
    defaultMinMidi: 48,
    defaultRangeLabel: "C3 – G5",
  },
  "25": {
    id: "25",
    label: "25 Keys",
    keyCount: 25,
    defaultMinMidi: 48,
    defaultRangeLabel: "C3 – C5",
  },
};

function presetForSuggestedKeyCount(count: number | null): KeyboardRangePreset | null {
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

interface PersistedMidiSettings {
  rangePreset: KeyboardRangePreset;
  minMidi: number;
  keyCount: number;
  autoOctaveFollow: boolean;
  dimOutOfRange: boolean;
  lastDeviceName: string | null;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function persistMidiSettingsDebounced(state: PersistedMidiSettings) {
  if (saveTimeout) clearTimeout(saveTimeout);
  const payload: PersistedMidiSettings = {
    rangePreset: state.rangePreset,
    minMidi: state.minMidi,
    keyCount: state.keyCount,
    autoOctaveFollow: state.autoOctaveFollow,
    dimOutOfRange: state.dimOutOfRange,
    lastDeviceName: state.lastDeviceName,
  };
  saveTimeout = setTimeout(() => {
    setAppSetting("midi_hardware_v1", JSON.stringify(payload)).catch(() => {});
  }, 300);
}

function clampMinMidi(minMidi: number, keyCount: number): number {
  const maxAllowedMin = 108 - keyCount + 1;
  return Math.max(21, Math.min(maxAllowedMin, minMidi));
}

interface MidiState {
  devices: MidiDeviceInfo[];
  connectedDevice: string | null;
  rangePreset: KeyboardRangePreset;
  minMidi: number;
  keyCount: number;
  autoOctaveFollow: boolean;
  dimOutOfRange: boolean;
  sustainDown: boolean;
  lastDeviceName: string | null;

  setDevices: (devices: MidiDeviceInfo[]) => void;
  setConnectedDevice: (name: string | null) => void;
  connectDevice: (portName: string) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  setRangePreset: (preset: KeyboardRangePreset) => void;
  setMinMidi: (minMidi: number) => void;
  shiftOctave: (delta: -1 | 1) => void;
  setAutoOctaveFollow: (enabled: boolean) => void;
  setDimOutOfRange: (enabled: boolean) => void;
  handleMidiLiveEvent: (payload: MidiLiveEventPayload) => void;
  hydrateMidiSettings: (rawJson: string) => void;
}

export const useMidiStore = create<MidiState>((set, get) => ({
  devices: [],
  connectedDevice: null,
  rangePreset: "88",
  minMidi: 21,
  keyCount: 88,
  autoOctaveFollow: true,
  dimOutOfRange: true,
  sustainDown: false,
  lastDeviceName: null,

  setDevices: (devices) => set({ devices }),

  setConnectedDevice: (name) => set({ connectedDevice: name }),

  connectDevice: async (portName: string) => {
    try {
      const info = await connectMidiDevice(portName);
      if (!info) return;

      const current = get();
      const suggestedPreset =
        current.rangePreset === "88"
          ? presetForSuggestedKeyCount(info.suggestedKeyCount)
          : null;

      if (suggestedPreset && suggestedPreset !== "88") {
        const cfg = RANGE_PRESETS[suggestedPreset];
        set({
          connectedDevice: info.name,
          lastDeviceName: info.name,
          rangePreset: cfg.id,
          keyCount: cfg.keyCount,
          minMidi: cfg.defaultMinMidi,
        });
      } else {
        set({
          connectedDevice: info.name,
          lastDeviceName: info.name,
        });
      }
      persistMidiSettingsDebounced(get());
    } catch (err) {
      console.error("Failed to connect MIDI device:", err);
    }
  },

  disconnectDevice: async () => {
    try {
      await disconnectMidiDevice();
    } catch (err) {
      console.error("Failed to disconnect MIDI device:", err);
    }
    activeNotes.clearAllLive();
    set({ connectedDevice: null, sustainDown: false });
  },

  setRangePreset: (preset) => {
    const cfg = RANGE_PRESETS[preset];
    if (!cfg) return;
    set({
      rangePreset: cfg.id,
      keyCount: cfg.keyCount,
      minMidi: cfg.defaultMinMidi,
    });
    persistMidiSettingsDebounced(get());
  },

  setMinMidi: (minMidi) => {
    const { keyCount } = get();
    const clamped = clampMinMidi(minMidi, keyCount);
    set({ minMidi: clamped });
    persistMidiSettingsDebounced(get());
  },

  shiftOctave: (delta) => {
    const { minMidi, keyCount } = get();
    if (keyCount >= 88) return;
    const nextMin = clampMinMidi(minMidi + delta * 12, keyCount);
    if (nextMin !== minMidi) {
      set({ minMidi: nextMin });
      persistMidiSettingsDebounced(get());
    }
  },

  setAutoOctaveFollow: (enabled) => {
    set({ autoOctaveFollow: enabled });
    persistMidiSettingsDebounced(get());
  },

  setDimOutOfRange: (enabled) => {
    set({ dimOutOfRange: enabled });
    persistMidiSettingsDebounced(get());
  },

  handleMidiLiveEvent: (payload) => {
    if (payload.kind === "noteOn") {
      const state = get();
      if (state.autoOctaveFollow && state.keyCount < 88) {
        const maxMidi = state.minMidi + state.keyCount - 1;
        let nextMin = state.minMidi;
        if (payload.midi < state.minMidi) {
          const octavesDown = Math.ceil((state.minMidi - payload.midi) / 12);
          nextMin = Math.max(21, state.minMidi - octavesDown * 12);
        } else if (payload.midi > maxMidi) {
          const octavesUp = Math.ceil((payload.midi - maxMidi) / 12);
          nextMin = Math.min(108 - state.keyCount + 1, state.minMidi + octavesUp * 12);
        }
        if (nextMin !== state.minMidi) {
          set({ minMidi: nextMin });
          persistMidiSettingsDebounced(get());
        }
      }

      const splitPointMidi = usePlaybackStore.getState().splitPointMidi;
      const hand: 1 | 2 = payload.midi >= splitPointMidi ? 1 : 2;
      activeNotes.setLiveNote(payload.midi, hand, payload.velocity / 127);
    } else if (payload.kind === "noteOff") {
      activeNotes.clearLiveNote(payload.midi);
    } else if (payload.kind === "sustain") {
      set({ sustainDown: payload.velocity >= 64 });
    }
  },

  hydrateMidiSettings: (rawJson) => {
    try {
      const parsed = JSON.parse(rawJson) as Partial<PersistedMidiSettings>;
      const preset =
        parsed.rangePreset && parsed.rangePreset in RANGE_PRESETS
          ? parsed.rangePreset
          : "88";
      const cfg = RANGE_PRESETS[preset];
      const keyCount =
        typeof parsed.keyCount === "number" && parsed.keyCount >= 1 && parsed.keyCount <= 88
          ? parsed.keyCount
          : cfg.keyCount;
      const minMidi =
        typeof parsed.minMidi === "number"
          ? clampMinMidi(parsed.minMidi, keyCount)
          : cfg.defaultMinMidi;

      set({
        rangePreset: preset,
        keyCount,
        minMidi,
        autoOctaveFollow:
          typeof parsed.autoOctaveFollow === "boolean" ? parsed.autoOctaveFollow : true,
        dimOutOfRange:
          typeof parsed.dimOutOfRange === "boolean" ? parsed.dimOutOfRange : true,
        lastDeviceName:
          typeof parsed.lastDeviceName === "string" ? parsed.lastDeviceName : null,
      });
    } catch {
      // Ignore malformed JSON
    }
  },
}));
