import { create } from "zustand";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutActionId,
  formatBindingForDisplay,
} from "@/types/shortcuts";
import { setAppSetting } from "@/services/tauriApi";

interface ShortcutState {
  bindings: Record<ShortcutActionId, string | null>;
  dialogOpen: boolean;
  recordingActionId: ShortcutActionId | null;
  conflictActionId: ShortcutActionId | null;
  conflictPendingBinding: string | null;

  setDialogOpen: (open: boolean) => void;
  startRecording: (actionId: ShortcutActionId) => void;
  stopRecording: () => void;
  setConflict: (actionId: ShortcutActionId, binding: string) => void;

  findConflict: (
    binding: string,
    excludeAction: ShortcutActionId
  ) => ShortcutActionId | null;

  setBinding: (actionId: ShortcutActionId, binding: string | null) => void;
  swapBinding: (actionA: ShortcutActionId, actionB: ShortcutActionId) => void;
  reassignBinding: (targetAction: ShortcutActionId, newBinding: string) => void;
  resetToDefaults: () => void;
  hydrateShortcuts: (jsonStr: string) => void;

  getBinding: (actionId: ShortcutActionId) => string | null;
  getFormattedBinding: (actionId: ShortcutActionId) => string;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistShortcutsDebounced(
  bindings: Record<ShortcutActionId, string | null>
) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await setAppSetting("shortcuts_v1", JSON.stringify(bindings));
    } catch (err) {
      console.warn("Failed to persist shortcuts to SQLite:", err);
    }
  }, 350);
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  bindings: { ...DEFAULT_SHORTCUTS },
  dialogOpen: false,
  recordingActionId: null,
  conflictActionId: null,
  conflictPendingBinding: null,

  setDialogOpen: (dialogOpen) => {
    set({
      dialogOpen,
      recordingActionId: null,
      conflictActionId: null,
      conflictPendingBinding: null,
    });
  },

  startRecording: (recordingActionId) => {
    set({
      recordingActionId,
      conflictActionId: null,
      conflictPendingBinding: null,
    });
  },

  stopRecording: () => {
    set({
      recordingActionId: null,
      conflictActionId: null,
      conflictPendingBinding: null,
    });
  },

  setConflict: (conflictActionId, conflictPendingBinding) => {
    set({ conflictActionId, conflictPendingBinding });
  },

  findConflict: (binding, excludeAction) => {
    const { bindings } = get();
    for (const [id, b] of Object.entries(bindings)) {
      if (id !== excludeAction && b === binding) {
        return id as ShortcutActionId;
      }
    }
    return null;
  },

  setBinding: (actionId, binding) => {
    set((state) => {
      const next = { ...state.bindings, [actionId]: binding };
      persistShortcutsDebounced(next);
      return {
        bindings: next,
        recordingActionId: null,
        conflictActionId: null,
        conflictPendingBinding: null,
      };
    });
  },

  swapBinding: (actionA, actionB) => {
    set((state) => {
      const bindingA = state.bindings[actionA];
      const bindingB = state.bindings[actionB];
      const next = {
        ...state.bindings,
        [actionA]: bindingB,
        [actionB]: bindingA,
      };
      persistShortcutsDebounced(next);
      return {
        bindings: next,
        recordingActionId: null,
        conflictActionId: null,
        conflictPendingBinding: null,
      };
    });
  },

  reassignBinding: (targetAction, newBinding) => {
    set((state) => {
      const next = { ...state.bindings };
      // Remove this binding from any other action that holds it
      for (const [id, b] of Object.entries(next)) {
        if (b === newBinding) {
          next[id as ShortcutActionId] = null;
        }
      }
      next[targetAction] = newBinding;
      persistShortcutsDebounced(next);
      return {
        bindings: next,
        recordingActionId: null,
        conflictActionId: null,
        conflictPendingBinding: null,
      };
    });
  },

  resetToDefaults: () => {
    set({
      bindings: { ...DEFAULT_SHORTCUTS },
      recordingActionId: null,
      conflictActionId: null,
      conflictPendingBinding: null,
    });
    persistShortcutsDebounced(DEFAULT_SHORTCUTS);
  },

  hydrateShortcuts: (jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, string | null>;
      set({
        bindings: {
          ...DEFAULT_SHORTCUTS,
          ...parsed,
        },
      });
    } catch (err) {
      console.warn("Failed to parse shortcuts JSON:", err);
    }
  },

  getBinding: (actionId) => {
    return get().bindings[actionId] ?? null;
  },

  getFormattedBinding: (actionId) => {
    const binding = get().bindings[actionId];
    return formatBindingForDisplay(binding);
  },
}));
