export type ShortcutActionId =
  | "playback.toggle"
  | "playback.restart"
  | "playback.seekBack"
  | "playback.seekForward"
  | "audio.volumeUp"
  | "audio.volumeDown"
  | "tempo.down"
  | "tempo.up"
  | "loop.smart"
  | "loop.clear"
  | "loop.jumpToStart"
  | "hands.toggleLeft"
  | "hands.toggleRight"
  | "practice.studyMode"
  | "midi.octaveDown"
  | "midi.octaveUp"
  | "view.library"
  | "view.freeplay"
  | "view.focus"
  | "library.search"
  | "app.shortcuts";

export type ShortcutCategory = "Playback" | "Practice" | "View" | "App";

export interface ShortcutDefinition {
  id: ShortcutActionId;
  category: ShortcutCategory;
  label: string;
  description: string;
  defaultBinding: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Playback
  {
    id: "playback.toggle",
    category: "Playback",
    label: "Play / Pause",
    description: "Start or pause MIDI song playback",
    defaultBinding: "Space",
  },
  {
    id: "playback.restart",
    category: "Playback",
    label: "Restart Song",
    description: "Seek to the beginning (0:00)",
    defaultBinding: "0",
  },
  {
    id: "playback.seekBack",
    category: "Playback",
    label: "Scrub Backward",
    description: "Hold to travel backward through the song",
    defaultBinding: "ArrowLeft",
  },
  {
    id: "playback.seekForward",
    category: "Playback",
    label: "Scrub Forward",
    description: "Hold to travel forward through the song",
    defaultBinding: "ArrowRight",
  },
  {
    id: "audio.volumeUp",
    category: "Playback",
    label: "Volume Up",
    description: "Increase volume by 5%",
    defaultBinding: "ArrowUp",
  },
  {
    id: "audio.volumeDown",
    category: "Playback",
    label: "Volume Down",
    description: "Decrease volume by 5%",
    defaultBinding: "ArrowDown",
  },

  // Practice
  {
    id: "tempo.down",
    category: "Practice",
    label: "Decrease Tempo",
    description: "Slow down playback speed by 5%",
    defaultBinding: "[",
  },
  {
    id: "tempo.up",
    category: "Practice",
    label: "Increase Tempo",
    description: "Speed up playback speed by 5%",
    defaultBinding: "]",
  },
  {
    id: "loop.smart",
    category: "Practice",
    label: "Set / Toggle A–B Loop",
    description: "1st click: set Point A, 2nd click: set Point B, 3rd+: toggle loop",
    defaultBinding: "L",
  },
  {
    id: "loop.clear",
    category: "Practice",
    label: "Clear A–B Loop",
    description: "Remove loop markers and return to full playback",
    defaultBinding: "Mod+L",
  },
  {
    id: "loop.jumpToStart",
    category: "Practice",
    label: "Jump to Loop Start",
    description: "Seek back to loop Point A (if set)",
    defaultBinding: "Shift+ArrowLeft",
  },
  {
    id: "hands.toggleLeft",
    category: "Practice",
    label: "Toggle Left Hand",
    description: "Mute or solo left hand accompaniment",
    defaultBinding: "1",
  },
  {
    id: "hands.toggleRight",
    category: "Practice",
    label: "Toggle Right Hand",
    description: "Mute or solo right hand melody",
    defaultBinding: "2",
  },
  {
    id: "practice.studyMode",
    category: "Practice",
    label: "Toggle Study Mode",
    description: "Pause waterfall at hit line until you play the expected notes",
    defaultBinding: "W",
  },
  {
    id: "midi.octaveDown",
    category: "Practice",
    label: "Shift MIDI Range Down",
    description: "Shift the active compact MIDI keyboard window down 1 octave",
    defaultBinding: "Alt+[",
  },
  {
    id: "midi.octaveUp",
    category: "Practice",
    label: "Shift MIDI Range Up",
    description: "Shift the active compact MIDI keyboard window up 1 octave",
    defaultBinding: "Alt+]",
  },

  // View
  {
    id: "view.library",
    category: "View",
    label: "Back to Library",
    description: "Return to the song library from a piece or free-play",
    defaultBinding: "Escape",
  },
  {
    id: "view.freeplay",
    category: "View",
    label: "Full-Screen Free-Play",
    description: "Switch to full-screen interactive piano stage",
    defaultBinding: "Mod+Shift+F",
  },
  {
    id: "view.focus",
    category: "View",
    label: "Focus Mode",
    description: "Hide all HUD docks and focus purely on the visual stage",
    defaultBinding: "F",
  },
  {
    id: "library.search",
    category: "View",
    label: "Search Library",
    description: "Focus the library search bar",
    defaultBinding: "Mod+K",
  },

  // App
  {
    id: "app.shortcuts",
    category: "App",
    label: "Keyboard Shortcuts",
    description: "Open the Shortcut Manager dialog",
    defaultBinding: "Mod+/",
  },
];

export const DEFAULT_SHORTCUTS: Record<ShortcutActionId, string> =
  SHORTCUT_DEFINITIONS.reduce((acc, def) => {
    acc[def.id] = def.defaultBinding;
    return acc;
  }, {} as Record<ShortcutActionId, string>);

export const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform.includes("Mac") ||
    navigator.userAgent.includes("Macintosh"));

/**
 * Normalizes a raw browser KeyboardEvent into a canonical binding string.
 * Example: 'Mod+Shift+F', 'Space', 'L', 'ArrowLeft'.
 * Lone modifier key presses return null.
 */
export function eventToBinding(e: KeyboardEvent): string | null {
  // Ignore lone modifier keys
  if (
    e.key === "Shift" ||
    e.key === "Control" ||
    e.key === "Alt" ||
    e.key === "Meta"
  ) {
    return null;
  }

  const parts: string[] = [];

  // Platform neutral 'Mod'
  const isPrimaryMod = isMac ? e.metaKey : e.ctrlKey;
  if (isPrimaryMod) parts.push("Mod");

  // On Mac, Ctrl is an additional modifier if Meta is primary
  if (isMac && e.ctrlKey) parts.push("Ctrl");

  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  // Normalize key name
  let keyName = e.key;
  if (e.code === "Space" || keyName === " ") {
    keyName = "Space";
  } else if (keyName === "ArrowLeft") {
    keyName = "ArrowLeft";
  } else if (keyName === "ArrowRight") {
    keyName = "ArrowRight";
  } else if (keyName === "ArrowUp") {
    keyName = "ArrowUp";
  } else if (keyName === "ArrowDown") {
    keyName = "ArrowDown";
  } else if (keyName === "Escape") {
    keyName = "Escape";
  } else if (keyName === "Enter") {
    keyName = "Enter";
  } else if (keyName === "Backspace") {
    keyName = "Backspace";
  } else if (e.code === "BracketLeft") {
    keyName = "[";
  } else if (e.code === "BracketRight") {
    keyName = "]";
  } else if (e.code === "Slash") {
    keyName = "/";
  } else if (e.code === "Period") {
    keyName = ".";
  } else if (e.code === "Comma") {
    keyName = ",";
  } else if (keyName.length === 1) {
    keyName = keyName.toUpperCase();
  }

  parts.push(keyName);
  return parts.join("+");
}

/**
 * Formats a canonical binding string for friendly UI display.
 * E.g., 'Mod+Shift+F' -> '⌘⇧F' on macOS, 'Ctrl+Shift+F' on Windows.
 */
export function formatBindingForDisplay(binding: string | null): string {
  if (!binding) return "—";

  if (isMac) {
    return binding
      .replace(/Mod\+/g, "⌘")
      .replace(/Ctrl\+/g, "⌃")
      .replace(/Shift\+/g, "⇧")
      .replace(/Alt\+/g, "⌥")
      .replace(/ArrowLeft/g, "←")
      .replace(/ArrowRight/g, "→")
      .replace(/ArrowUp/g, "↑")
      .replace(/ArrowDown/g, "↓")
      .replace(/Enter/g, "↵");
  }

  return binding
    .replace(/Mod\+/g, "Ctrl+")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowDown/g, "↓");
}
