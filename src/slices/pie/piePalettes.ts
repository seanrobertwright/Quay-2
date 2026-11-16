// The pie palettes the wire draws in. They live with the pie, and the shell's preferences pick
// one by id.

/** A pie palette: its name and the two colours its swatch shows. Spectrum gives one hue per action. */
export interface PiePalette {
  id: string;
  label: string;
  colors: readonly [string, string];
}

/** The six pie palettes, in the order the Project panel lists them. */
export const PIE_PALETTES = [
  { id: "spectrum", label: "Spectrum", colors: ["#7df9ff", "#ffffff"] },
  { id: "cyber", label: "Cyan + magenta", colors: ["#00f0ff", "#ff2bd6"] },
  { id: "tron", label: "Cyan + orange", colors: ["#18e0ff", "#ff9a1f"] },
  { id: "acid", label: "Lime + cyan", colors: ["#b6ff1a", "#00e5ff"] },
  { id: "sunset", label: "Pink + yellow", colors: ["#ff3d81", "#ffd60a"] },
  { id: "ice", label: "Ice white + green", colors: ["#dfe9ff", "#39ff88"] },
] as const satisfies readonly PiePalette[];

export type PiePaletteId = (typeof PIE_PALETTES)[number]["id"];
