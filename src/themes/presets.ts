export interface ThemePreset {
  id: string;
  name: string;
  bgColor: string;
  rightHandColor: string;
  leftHandColor: string;
  accentColor: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "aurelia-gold",
    name: "Aurelia Gold",
    bgColor: "#09090b",
    rightHandColor: "#f5c26b",
    leftHandColor: "#60a5fa",
    accentColor: "#f5c26b",
  },
  {
    id: "midnight-opal",
    name: "Midnight Opal",
    bgColor: "#080a10",
    rightHandColor: "#7dd3fc",
    leftHandColor: "#a78bfa",
    accentColor: "#7dd3fc",
  },
  {
    id: "studio-ember",
    name: "Studio Ember",
    bgColor: "#0c0a09",
    rightHandColor: "#fb923c",
    leftHandColor: "#34d399",
    accentColor: "#fb923c",
  },
  {
    id: "ivory-minimal",
    name: "Ivory Minimal",
    bgColor: "#09090b",
    rightHandColor: "#f4f4f5",
    leftHandColor: "#94a3b8",
    accentColor: "#f4f4f5",
  },
  {
    id: "emerald-nocturne",
    name: "Emerald Nocturne",
    bgColor: "#070d0b",
    rightHandColor: "#4ade80",
    leftHandColor: "#fbbf24",
    accentColor: "#4ade80",
  },
];
