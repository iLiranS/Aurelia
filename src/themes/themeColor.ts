/**
 * Utility functions for dynamically applying the App Theme Color based on the Right Hand Color.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RgbColor {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) {
    return { r: 245, g: 194, b: 107 }; // Fallback to Aurelia Gold
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Calculates WCAG relative luminance to determine if a color is light.
 * Returns true if the background is light enough that foreground text must be dark.
 */
export function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const sR = r / 255;
  const sG = g / 255;
  const sB = b / 255;
  const rL = sR <= 0.03928 ? sR / 12.92 : Math.pow((sR + 0.055) / 1.055, 2.4);
  const gL = sG <= 0.03928 ? sG / 12.92 : Math.pow((sG + 0.055) / 1.055, 2.4);
  const bL = sB <= 0.03928 ? sB / 12.92 : Math.pow((sB + 0.055) / 1.055, 2.4);
  const luminance = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
  return luminance > 0.45;
}

/**
 * Applies the given theme color (right hand color) to document root CSS variables.
 * Handles contrast adjustment so light/white themes never produce white-on-white buttons.
 */
export function applyAppThemeColor(hexColor: string): void {
  if (typeof document === "undefined") return;

  const rgb = hexToRgb(hexColor);
  const isLight = isLightColor(hexColor);
  const rgbString = `${rgb.r}, ${rgb.g}, ${rgb.b}`;

  const root = document.documentElement;

  root.style.setProperty("--theme-color", hexColor);
  root.style.setProperty("--theme-color-rgb", rgbString);
  root.style.setProperty("--primary", hexColor);
  root.style.setProperty("--primary-rgb", rgbString);

  // When theme color is light (e.g. Ivory Minimal #f4f4f5, White),
  // solid buttons or badges MUST use dark text for contrast ("white + white text buttons is a no no!")
  const foreground = isLight ? "#09090b" : "#ffffff";
  root.style.setProperty("--primary-foreground", foreground);

  // Focus ring
  root.style.setProperty("--ring", `rgba(${rgbString}, 0.4)`);

  // Liquid glass accent and active segment dynamic styles
  // For light colors, reduce white wash while maintaining specular border and glow
  if (isLight) {
    root.style.setProperty("--theme-accent-bg", `rgba(${rgbString}, 0.16)`);
    root.style.setProperty("--theme-accent-bg-subtle", `rgba(${rgbString}, 0.06)`);
    root.style.setProperty("--theme-accent-border", `rgba(${rgbString}, 0.45)`);
    root.style.setProperty("--theme-accent-glow", `rgba(${rgbString}, 0.16)`);
  } else {
    root.style.setProperty("--theme-accent-bg", `rgba(${rgbString}, 0.22)`);
    root.style.setProperty("--theme-accent-bg-subtle", `rgba(${rgbString}, 0.09)`);
    root.style.setProperty("--theme-accent-border", `rgba(${rgbString}, 0.40)`);
    root.style.setProperty("--theme-accent-glow", `rgba(${rgbString}, 0.22)`);
  }

  root.dataset.themeIsLight = isLight ? "true" : "false";
}
