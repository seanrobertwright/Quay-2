// The pie menu's recognizer: which wedge, or which slice of a parent's second ring, a stroke points
// at, and what each press, drag, release, click and letter does to the menu. It is pure: the host
// feeds it pointer and key events with their times and draws what the state says.

/** The eight wedges, clockwise from N straight up. */
export const WEDGES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Wedge = (typeof WEDGES)[number];

/** How far the pointer must move from where the menu opened before a stroke points anywhere. */
export const DEAD_ZONE_PX = 26;

/** Where the second ring starts: a stroke this far out picks a parent's slice, not the parent. */
export const SECOND_RING_PX = 132;
/** On crossing the first ring, the stroke locks to the nearest parent at most this far off. */
export const LOCK_WITHIN_DEG = 30;
/** A lock holds until the pointer is more than this far off its parent. */
export const LOCK_HYSTERESIS_DEG = 32;
/** Each of a parent's three slices spans this much; together they span its direction ±30°. */
export const SLICE_DEG = 20;

/** Degrees clockwise from N of a stroke `dx`, `dy` px from the menu's centre (y grows downward), in [0, 360). */
export function bearingOf(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

/** How far bearing `deg` is off `wedge`'s direction, in [-180, 180), clockwise positive. */
export function offWedge(deg: number, wedge: Wedge): number {
  return ((deg - WEDGES.indexOf(wedge) * 45 + 540) % 360) - 180;
}

/**
 * The wedge a stroke `dx`, `dy` px from the menu's centre points at (y grows downward), or null
 * inside the dead zone. Each wedge spans 45°, centred on its direction.
 */
export function wedgeAt(dx: number, dy: number): Wedge | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE_PX) return null;
  return WEDGES[Math.round(bearingOf(dx, dy) / 45) % 8];
}

/** A point in the window, in CSS px from its top left corner. */
export interface PiePoint {
  x: number;
  y: number;
}

/**
 * What the recognizer needs of a ring: the wedges that apply, each with the letter that chooses
 * it. A wedge left out or null is dim and empty, and is never chosen. A wedge with `slices` is a
 * parent: its second ring holds them, anticlockwise to clockwise, and a null slice is dim.
 */
export type PieRingKeys = Readonly<Partial<Record<Wedge, { letter: string; slices?: readonly (object | null)[] } | null>>>;

/**
 * The menu: closed, held (the button still down, drawn once the display delay passes) or open to
 * read. `lock` is the parent whose second ring the pointer is in, if any.
 */
export type PieState =
  | { phase: "closed" }
  | { phase: "held"; origin: PiePoint; pointer: PiePoint; pressedAt: number; shown: boolean; lock: Wedge | null }
  | { phase: "open"; origin: PiePoint; pointer: PiePoint; lock: Wedge | null };

export const CLOSED: PieState = { phase: "closed" };

/** What the host feeds the recognizer. `time` is in ms, from one clock. */
export type PieEvent =
  | { type: "press"; at: PiePoint; time: number }
  | { type: "move"; at: PiePoint }
  | { type: "release"; at: PiePoint; time: number }
  | { type: "click"; at: PiePoint }
  | { type: "tick"; time: number }
  | { type: "key"; key: string };

/**
 * The menu after an event, and what the event chose, if anything: a wedge, and the index of its
 * second-ring slice when the stroke picked one (null for the wedge's own command). A choice always
 * closes the menu.
 */
export interface PieStep {
  state: PieState;
  chosen: Wedge | null;
  slice: number | null;
}

/**
 * The parent a stroke at `at` is locked to, given the lock it held before. Short of the second
 * ring there is none. Past its start a lock holds while the pointer stays within 32° of its
 * parent; otherwise the stroke locks to the nearest parent within 30°, whatever wedge lies under
 * the pointer, or to none.
 */
function lockAt(prev: Wedge | null, origin: PiePoint, at: PiePoint, ring: PieRingKeys): Wedge | null {
  const dx = at.x - origin.x;
  const dy = at.y - origin.y;
  if (Math.hypot(dx, dy) < SECOND_RING_PX) return null;
  const deg = bearingOf(dx, dy);
  if (prev && Math.abs(offWedge(deg, prev)) <= LOCK_HYSTERESIS_DEG) return prev;
  let best: Wedge | null = null;
  for (const wedge of WEDGES) {
    if (!ring[wedge]?.slices) continue;
    const off = Math.abs(offWedge(deg, wedge));
    if (off <= LOCK_WITHIN_DEG && (best === null || off < Math.abs(offWedge(deg, best)))) best = wedge;
  }
  return best;
}

interface PieAim {
  wedge: Wedge | null;
  slice: number | null;
}

/** What a pointer at `at` aims at under `lock`: the locked parent's slice, else the applying wedge under it. */
function aimAt(origin: PiePoint, at: PiePoint, lock: Wedge | null, ring: PieRingKeys): PieAim {
  if (lock) {
    const off = offWedge(bearingOf(at.x - origin.x, at.y - origin.y), lock);
    return { wedge: lock, slice: Math.max(0, Math.min(2, Math.floor((off + LOCK_WITHIN_DEG) / SLICE_DEG))) };
  }
  const wedge = wedgeAt(at.x - origin.x, at.y - origin.y);
  return { wedge: wedge && ring[wedge] ? wedge : null, slice: null };
}

/** The wedge and slice at `at` when they apply; null in the dead zone or on a dim wedge or slice. */
function applyingAimAt(origin: PiePoint, at: PiePoint, lock: Wedge | null, ring: PieRingKeys): PieAim | null {
  const aim = aimAt(origin, at, lock, ring);
  if (!aim.wedge) return null;
  if (aim.slice !== null && !ring[aim.wedge]?.slices?.[aim.slice]) return null;
  return aim;
}

/** The wedge the pointer aims at now (the locked parent in its second ring); null while closed, in the dead zone or on a dim wedge. */
export function aimedWedge(state: PieState, ring: PieRingKeys): Wedge | null {
  return state.phase === "closed" ? null : aimAt(state.origin, state.pointer, state.lock, ring).wedge;
}

/** The second-ring slice the pointer aims at now, as an index into its parent's `slices`; null off the second ring. */
export function aimedSlice(state: PieState, ring: PieRingKeys): number | null {
  return state.phase === "closed" ? null : aimAt(state.origin, state.pointer, state.lock, ring).slice;
}

const stay = (state: PieState): PieStep => ({ state, chosen: null, slice: null });
const choose = (aim: PieAim): PieStep => ({ state: CLOSED, chosen: aim.wedge, slice: aim.slice });

/**
 * The menu after `event`, for a ring `ring` and a display delay of `delayMs`. Hold, drag and
 * release chooses the wedge released on, or the slice when released past the second ring's start,
 * whether or not the menu has drawn yet. A release in the dead zone (a plain click) or on a dim
 * wedge or slice leaves the menu open, drawn, to read; a click then chooses a wedge or slice, or
 * closes the menu in the dead zone. A wedge's letter chooses it while the menu is held or open,
 * and Escape closes it.
 */
export function stepPie(state: PieState, event: PieEvent, ring: PieRingKeys, delayMs: number): PieStep {
  if (event.type === "press") {
    return stay({ phase: "held", origin: event.at, pointer: event.at, pressedAt: event.time, shown: delayMs <= 0, lock: null });
  }
  if (state.phase === "closed") return stay(state);
  switch (event.type) {
    case "move":
      return stay({ ...state, pointer: event.at, lock: lockAt(state.lock, state.origin, event.at, ring) });
    case "tick":
      if (state.phase !== "held" || state.shown || event.time - state.pressedAt < delayMs) return stay(state);
      return stay({ ...state, shown: true });
    case "release": {
      if (state.phase !== "held") return stay(state);
      const lock = lockAt(state.lock, state.origin, event.at, ring);
      const aim = applyingAimAt(state.origin, event.at, lock, ring);
      return aim ? choose(aim) : stay({ phase: "open", origin: state.origin, pointer: event.at, lock });
    }
    case "click": {
      if (state.phase !== "open") return stay(state);
      if (wedgeAt(event.at.x - state.origin.x, event.at.y - state.origin.y) === null) return stay(CLOSED);
      const lock = lockAt(state.lock, state.origin, event.at, ring);
      const aim = applyingAimAt(state.origin, event.at, lock, ring);
      return aim ? choose(aim) : stay({ ...state, pointer: event.at, lock });
    }
    case "key": {
      if (event.key === "Escape") return stay(CLOSED);
      const key = event.key.toLowerCase();
      const wedge = WEDGES.find((w) => ring[w]?.letter.toLowerCase() === key);
      return wedge ? choose({ wedge, slice: null }) : stay(state);
    }
  }
}
