// PROTOTYPE (#351). Every open question is a knob, kept in the URL so a setting
// can be shared and survives reload. Values are parsed and clamped here.

import type { EdgeStyle } from "./geometry";
import type { ClashMode, PayloadFormat } from "./protocol";

export type WidthMode = "global" | "visible" | "resizable";

export interface Knobs {
  /** "syn" for synthetic, or the name of a dump in data/. */
  source: string;
  commits: number;
  concurrency: number;
  style: EdgeStyle;
  k: number;
  rho: number;
  H: number;
  W: number;
  R: number;
  width: WidthMode;
  cap: number;
  clash: ClashMode;
  payload: PayloadFormat;
  sticky: boolean;
  chunk: number;
  overscan: number;
  theme: "dark" | "light";
  /** #370: native scrolling, or a spacer capped at SCALED_MAX_PX with a virtual offset. */
  scroll: "native" | "scaled";
}

export const DEFAULTS: Knobs = {
  source: "syn",
  commits: 50_000,
  concurrency: 8,
  style: "scurve",
  k: 0.62,
  rho: 6,
  H: 28,
  W: 16,
  R: 4.5,
  width: "global",
  cap: 24,
  clash: "off",
  payload: "columnar",
  sticky: true,
  chunk: 8,
  overscan: 12,
  theme: "dark",
  scroll: "native",
};

export const COMMIT_CHOICES = [10_000, 50_000, 200_000, 500_000, 1_000_000, 1_500_000, 2_000_000];
export const CONCURRENCY_CHOICES = [3, 8, 30];
export const CHUNK_CHOICES = [1, 8, 32];

function num(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function oneOf<T extends string>(raw: string | null, choices: readonly T[], fallback: T): T {
  return choices.find((c) => c === raw) ?? fallback;
}

function choice(raw: string | null, choices: number[], fallback: number): number {
  const n = Number(raw);
  return choices.includes(n) ? n : fallback;
}

export function parseKnobs(search: string): Knobs {
  const q = new URLSearchParams(search);
  const source = q.get("source") ?? DEFAULTS.source;
  return {
    source: /^[\w.-]+$/.test(source) ? source : DEFAULTS.source,
    commits: choice(q.get("commits"), COMMIT_CHOICES, DEFAULTS.commits),
    concurrency: choice(q.get("concurrency"), CONCURRENCY_CHOICES, DEFAULTS.concurrency),
    style: oneOf(q.get("style"), ["scurve", "elbow"] as const, DEFAULTS.style),
    k: num(q.get("k"), DEFAULTS.k, 0.3, 0.95),
    rho: num(q.get("rho"), DEFAULTS.rho, 1, 14),
    H: num(q.get("H"), DEFAULTS.H, 16, 48),
    W: num(q.get("W"), DEFAULTS.W, 8, 32),
    R: num(q.get("R"), DEFAULTS.R, 2, 10),
    width: oneOf(q.get("width"), ["global", "visible", "resizable"] as const, DEFAULTS.width),
    cap: Math.round(num(q.get("cap"), DEFAULTS.cap, 2, 200)),
    clash: oneOf(q.get("clash"), ["off", "derived", "all"] as const, DEFAULTS.clash),
    payload: oneOf(q.get("payload"), ["json", "columnar"] as const, DEFAULTS.payload),
    sticky: q.get("sticky") !== "0",
    chunk: choice(q.get("chunk"), CHUNK_CHOICES, DEFAULTS.chunk),
    overscan: Math.round(num(q.get("overscan"), DEFAULTS.overscan, 0, 100)),
    theme: oneOf(q.get("theme"), ["dark", "light"] as const, DEFAULTS.theme),
    scroll: oneOf(q.get("scroll"), ["native", "scaled"] as const, DEFAULTS.scroll),
  };
}

export function knobsToSearch(k: Knobs): string {
  const q = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS) as (keyof Knobs)[]) {
    if (k[key] === DEFAULTS[key]) continue;
    q.set(key, typeof k[key] === "boolean" ? (k[key] ? "1" : "0") : String(k[key]));
  }
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

export interface Preset {
  key: string;
  name: string;
  knobs: Partial<Knobs>;
}

/** The three shapes to compare; the floating bar and ←/→ cycle through them. */
export const PRESETS: Preset[] = [
  { key: "A", name: "S-curve k=0.62, global width", knobs: { style: "scurve", k: 0.62, width: "global", cap: 24, clash: "off" } },
  { key: "B", name: "Rounded elbow ρ=6, visible-rows width", knobs: { style: "elbow", rho: 6, width: "visible", cap: 24, clash: "off" } },
  { key: "C", name: "S-curve k=0.8, resizable, clash probing", knobs: { style: "scurve", k: 0.8, width: "resizable", cap: 24, clash: "derived" } },
];

export function matchingPreset(k: Knobs): number {
  return PRESETS.findIndex((p) => (Object.keys(p.knobs) as (keyof Knobs)[]).every((key) => p.knobs[key] === k[key]));
}
