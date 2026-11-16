// The shell accent: the one colour that marks live state in the shell, set by the pie palette.
// The shell look stylesheet (`shellLook.css`) draws the live parts from the tokens here.
import { paletteColors, spectrumHue, type PiePaletteId } from "../pie/piePalettes.ts";
import { MODULES, type ModuleId } from "./modules.ts";

/**
 * The CSS custom properties the shell look stylesheet reads, by name: the accent, and the accent
 * at part opacity for a lit border (`-line`) and an inner glow (`-haze`).
 */
export type AccentTokens = Record<"--quay-accent" | "--quay-accent-line" | "--quay-accent-haze", string>;

/** `#rrggbb` at `alpha` opacity, as `rgba()`. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The accent tokens for `palette`, from its first colour. */
export function accentTokens(palette: PiePaletteId): AccentTokens {
  const [accent] = paletteColors(palette);
  return { "--quay-accent": accent, "--quay-accent-line": withAlpha(accent, 0.55), "--quay-accent-haze": withAlpha(accent, 0.22) };
}

/** The lightest surface a lit part sits on: a raised or hovered row. Darker surfaces contrast more. */
const LIGHTEST_SURFACE: readonly [number, number, number] = [0x21 / 255, 0x26 / 255, 0x2d / 255];

/** WCAG's contrast for text, which a lit title is. */
const TEXT_CONTRAST = 4.5;

/** The sRGB channels, 0 to 1, of `hsl(h 100% l%)`. */
function hslChannels(hue: number, lightness: number): [number, number, number] {
  const l = lightness / 100;
  const a = Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** WCAG relative luminance of sRGB channels. */
function luminance(channels: readonly [number, number, number]): number {
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Spectrum's colour for `hue`: the pie's 62% lightness, raised a point at a time until it reaches
 * text contrast on the lightest surface, so a dark hue such as violet still reads.
 */
function spectrumColor(hue: number): string {
  const surface = luminance(LIGHTEST_SURFACE);
  let lightness = 62;
  while (lightness < 100 && (luminance(hslChannels(hue, lightness)) + 0.05) / (surface + 0.05) < TEXT_CONTRAST) lightness += 1;
  return `hsl(${hue} 100% ${lightness}%)`;
}

/**
 * The colour `module`'s icon and edge take in `palette`, or null where they take the accent. With
 * Spectrum each module takes its own hue, the pie's hue for the wedge at its place clockwise from N.
 */
export function moduleAccent(palette: PiePaletteId, module: ModuleId): string | null {
  if (palette !== "spectrum") return null;
  return spectrumColor(spectrumHue(MODULES.indexOf(module)));
}

/** Sets `palette`'s accent tokens on `root`, the document's root element in the app. */
export function applyShellAccent(root: HTMLElement, palette: PiePaletteId): void {
  for (const [name, value] of Object.entries(accentTokens(palette))) root.style.setProperty(name, value);
}
