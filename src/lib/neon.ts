// The live parts the shell look stylesheet (`src/slices/shell/shellLook.css`) draws in neon. A
// component marks a lit part with `data-neon={neonPart(part, lit)}`; the stylesheet has one
// `[data-neon="…"]` rule per name here, which `neon.test.ts` checks.

/** Every part the shell look draws, by its `data-neon` name. */
export const NEON_PARTS = ["edge", "module", "dot", "underline", "row", "pane", "title", "ready", "quay-card"] as const;

/** A part the shell look draws. */
export type NeonPart = (typeof NEON_PARTS)[number];

/** The `data-neon` value for `part`: its name while `lit`, otherwise no attribute. */
export function neonPart(part: NeonPart, lit: boolean): NeonPart | undefined {
  return lit ? part : undefined;
}
