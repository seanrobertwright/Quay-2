/** The companion's width before the operator drags it, in CSS px. */
export const DEFAULT_COMPANION_WIDTH = 340;
/** The narrowest the divider drags the companion to, in CSS px. */
export const MIN_COMPANION_WIDTH = 340;
/** The widest the divider drags the companion to, in CSS px. */
export const MAX_COMPANION_WIDTH = 560;

import type { CompanionViewId } from "./companionViews.ts";

const WIDTH_KEY = "quay_companion_width";
/** Where the Companion opens on setting is stored. */
export const OPENS_ON_KEY = "quay_companion_opens_on";

/** The companion views the Companion opens on setting can name. */
export const OPENS_ON_VALUES = ["pull-request", "ticket", "activity"] as const satisfies readonly CompanionViewId[];
/** The view the companion shows first when the selected terminal has it. */
export type CompanionOpensOn = (typeof OPENS_ON_VALUES)[number];
/** Companion opens on before the operator sets it. */
export const DEFAULT_OPENS_ON: CompanionOpensOn = "pull-request";

function parseOpensOn(raw: string | null): CompanionOpensOn {
  return OPENS_ON_VALUES.find((value) => value === raw) ?? DEFAULT_OPENS_ON;
}

/** The part of `localStorage` the companion's preferences use. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The companion's preferences, read from and written to its storage. */
export interface CompanionPrefs {
  readWidth(): number;
  readOpensOn(): CompanionOpensOn;
  writeWidth(width: number): void;
}

/** A width the companion can take: whole px between the minimum and maximum, else the default. */
export function clampCompanionWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COMPANION_WIDTH;
  return Math.min(MAX_COMPANION_WIDTH, Math.max(MIN_COMPANION_WIDTH, Math.round(width)));
}

/** Parses a stored width; an empty or non-numeric value is no width. */
function parseWidth(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_COMPANION_WIDTH;
  return clampCompanionWidth(Number(raw));
}

/**
 * The companion's preferences in `storage`, which is the WebView's `localStorage` in the app, so
 * they are kept per machine. Every value is validated as it is read and falls back to its default.
 */
export function companionPrefs(storage: PrefsStorage): CompanionPrefs {
  return {
    readWidth: (): number => parseWidth(storage.getItem(WIDTH_KEY)),
    readOpensOn: (): CompanionOpensOn => parseOpensOn(storage.getItem(OPENS_ON_KEY)),
    writeWidth: (width: number): void => storage.setItem(WIDTH_KEY, String(clampCompanionWidth(width))),
  };
}

const WIDTH_STEP = 16;
const WIDTH_BIG_STEP = 64;

/**
 * The width the companion's divider `key` moves it to, or null for a key it doesn't handle. The
 * divider is on the companion's left edge, so ArrowLeft widens it. Shift or PageUp/PageDown move
 * further, and Home and End go to either end.
 */
export function companionWidthByKey(width: number, key: string, shift: boolean): number | null {
  const step = shift ? WIDTH_BIG_STEP : WIDTH_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampCompanionWidth(width + step);
    case "ArrowRight":
      return clampCompanionWidth(width - step);
    case "PageUp":
      return clampCompanionWidth(width + WIDTH_BIG_STEP);
    case "PageDown":
      return clampCompanionWidth(width - WIDTH_BIG_STEP);
    case "Home":
      return MIN_COMPANION_WIDTH;
    case "End":
      return MAX_COMPANION_WIDTH;
    default:
      return null;
  }
}
