// The pie's stroke log (#649), so overshoot between neighbouring parents can be checked in use. The
// spec switches the second ring to Turn if those errors pass 1 in 15; its intent is not knowable
// from a stroke, so the log keeps every stroke chosen with the pointer and flags each that ended in
// a parent's second ring within 30° of a neighbouring parent, the strokes where a lock could have
// gone either way. Kept in the WebView's localStorage under `quay_pie_stroke_log`.
import type { PrefsStorage } from "../companion/companionPrefs.ts";
import { parseStoredList } from "../../utils/storedList.ts";
import { LOCK_WITHIN_DEG, WEDGES, bearingOf, offWedge, type PiePoint, type PieRingKeys, type Wedge } from "./pieRecognizer.ts";

const KEY = "quay_pie_stroke_log";

/** How many strokes the log keeps; the oldest drop off first. */
export const MAX_LOGGED_STROKES = 500;

/** One stroke: what it chose, where it was released and the neighbouring parent it came near, if any. */
export interface PieStrokeRecord {
  /** When it was chosen, in ms since the epoch. */
  time: number;
  wedge: Wedge;
  /** The second-ring slice, or null for the wedge's own command. */
  slice: number | null;
  /** How far from the menu's centre it was released, in whole px. */
  distancePx: number;
  /** Its bearing at release, in whole degrees clockwise from N. */
  bearingDeg: number;
  /** For a second-ring pick, another parent within 30° of the release; otherwise null. */
  neighbour: Wedge | null;
}

/** The record of a stroke that chose `chosen` released at `at` from `origin`; null when nothing was chosen. */
export function strokeRecord(
  ring: PieRingKeys,
  chosen: { chosen: Wedge | null; slice: number | null },
  origin: PiePoint,
  at: PiePoint,
  time: number
): PieStrokeRecord | null {
  const wedge = chosen.chosen;
  if (!wedge) return null;
  const dx = at.x - origin.x;
  const dy = at.y - origin.y;
  const bearing = bearingOf(dx, dy);
  const neighbour =
    chosen.slice === null
      ? null
      : (WEDGES.filter((w) => w !== wedge && ring[w]?.slices && Math.abs(offWedge(bearing, w)) <= LOCK_WITHIN_DEG).sort(
          (a, b) => Math.abs(offWedge(bearing, a)) - Math.abs(offWedge(bearing, b))
        )[0] ?? null);
  return {
    time,
    wedge,
    slice: chosen.slice,
    distancePx: Math.round(Math.hypot(dx, dy)),
    bearingDeg: Math.round(bearing) % 360,
    neighbour,
  };
}

/** `log` with `record` added at the end, keeping the newest `MAX_LOGGED_STROKES`. */
export function logStroke(log: readonly PieStrokeRecord[], record: PieStrokeRecord): PieStrokeRecord[] {
  return [...log, record].slice(-MAX_LOGGED_STROKES);
}

/** Counts for checking overshoot: strokes on parents in `ring`, those that picked a slice, and those flagged between parents. */
export function strokeSummary(log: readonly PieStrokeRecord[], ring: PieRingKeys) {
  const onParents = log.filter((r) => ring[r.wedge]?.slices);
  return {
    parentStrokes: onParents.length,
    secondRing: onParents.filter((r) => r.slice !== null).length,
    betweenParents: onParents.filter((r) => r.neighbour !== null).length,
  };
}

const isWedge = (v: unknown): v is Wedge => typeof v === "string" && (WEDGES as readonly string[]).includes(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isRecord(v: unknown): v is PieStrokeRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isCount(r.time) &&
    isWedge(r.wedge) &&
    (r.slice === null || isCount(r.slice)) &&
    isCount(r.distancePx) &&
    isCount(r.bearingDeg) &&
    (r.neighbour === null || isWedge(r.neighbour))
  );
}

const parse = (raw: string | null): PieStrokeRecord[] => parseStoredList(raw, isRecord).slice(-MAX_LOGGED_STROKES);

/** The stroke log in `storage`. */
export function pieStrokeLog(storage: PrefsStorage) {
  return {
    read: () => parse(storage.getItem(KEY)),
    add(record: PieStrokeRecord) {
      storage.setItem(KEY, JSON.stringify(logStroke(parse(storage.getItem(KEY)), record)));
    },
  };
}
