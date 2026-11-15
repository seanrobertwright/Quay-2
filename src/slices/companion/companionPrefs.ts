/** The companion's width before the operator drags it, in CSS px. */
export const DEFAULT_COMPANION_WIDTH = 340;
/** The narrowest the divider drags the companion to, in CSS px. */
export const MIN_COMPANION_WIDTH = 340;
/** The widest the divider drags the companion to, in CSS px. */
export const MAX_COMPANION_WIDTH = 560;

const WIDTH_KEY = "quay_companion_width";
const OPENS_ON_KEY = "quay_companion_opens_on";

/** The companion views the Companion opens on setting can name. */
export const OPENS_ON_VALUES = ["pull-request", "ticket", "activity"] as const;
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
export function companionPrefs(storage: PrefsStorage) {
  return {
    readWidth: (): number => parseWidth(storage.getItem(WIDTH_KEY)),
    readOpensOn: (): CompanionOpensOn => parseOpensOn(storage.getItem(OPENS_ON_KEY)),
    writeWidth: (width: number): void => storage.setItem(WIDTH_KEY, String(clampCompanionWidth(width))),
  };
}
