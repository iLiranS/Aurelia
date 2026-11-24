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
  {
    id: "espresso-ivory",
    name: "Espresso Ivory",
    bgColor: "#0c0908",
    rightHandColor: "#f5f0e8",
    leftHandColor: "#b47b4e",
    accentColor: "#f5f0e8",
  },
  {
    id: "crimson-velvet",
    name: "Crimson Velvet",
    bgColor: "#0c0709",
    rightHandColor: "#fb7185",
    leftHandColor: "#e2e8f0",
    accentColor: "#fb7185",
  },
  {
    id: "sakura-dusk",
    name: "Sakura Dusk",
    bgColor: "#0b080d",
    rightHandColor: "#f472b6",
    leftHandColor: "#2dd4bf",
    accentColor: "#f472b6",
  },
  {
    id: "arctic-aurora",
    name: "Arctic Aurora",
    bgColor: "#060b0e",
    rightHandColor: "#22d3ee",
    leftHandColor: "#c084fc",
    accentColor: "#22d3ee",
  },
  {
    id: "royal-amethyst",
    name: "Royal Amethyst",
    bgColor: "#09070e",
    rightHandColor: "#c4b5fd",
    leftHandColor: "#f59e0b",
    accentColor: "#c4b5fd",
  },
];
