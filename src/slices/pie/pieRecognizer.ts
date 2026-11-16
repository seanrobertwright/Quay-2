// The pie menu's recognizer: which wedge a stroke points at, and what each press, drag, release,
// click and letter does to the menu. It is pure: the host feeds it pointer and key events with
// their times and draws what the state says.

/** The eight wedges, clockwise from N straight up. */
export const WEDGES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Wedge = (typeof WEDGES)[number];

/** How far the pointer must move from where the menu opened before a stroke points anywhere. */
export const DEAD_ZONE_PX = 26;

/**
 * The wedge a stroke `dx`, `dy` px from the menu's centre points at (y grows downward), or null
 * inside the dead zone. Each wedge spans 45°, centred on its direction.
 */
export function wedgeAt(dx: number, dy: number): Wedge | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE_PX) return null;
  // Degrees clockwise from N.
  const bearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return WEDGES[Math.round(bearing / 45) % 8];
}

/** A point in the window, in CSS px from its top left corner. */
export interface PiePoint {
  x: number;
  y: number;
}

/**
 * What the recognizer needs of a ring: the wedges that apply, each with the letter that chooses
 * it. A wedge left out or null is dim and empty, and is never chosen.
 */
export type PieRingKeys = Readonly<Partial<Record<Wedge, { letter: string } | null>>>;

/** The menu: closed, held (the button still down, drawn once the display delay passes) or open to read. */
export type PieState =
  | { phase: "closed" }
  | { phase: "held"; origin: PiePoint; pointer: PiePoint; pressedAt: number; shown: boolean }
  | { phase: "open"; origin: PiePoint; pointer: PiePoint };

export const CLOSED: PieState = { phase: "closed" };

/** What the host feeds the recognizer. `time` is in ms, from one clock. */
export type PieEvent =
  | { type: "press"; at: PiePoint; time: number }
  | { type: "move"; at: PiePoint }
  | { type: "release"; at: PiePoint; time: number }
  | { type: "click"; at: PiePoint }
  | { type: "tick"; time: number }
  | { type: "key"; key: string };

/** The menu after an event, and the wedge the event chose, if any. A choice always closes the menu. */
export interface PieStep {
  state: PieState;
  chosen: Wedge | null;
}

/** The wedge at `at` from the menu's `origin`, when it applies in `ring`. */
function applyingWedgeAt(origin: PiePoint, at: PiePoint, ring: PieRingKeys): Wedge | null {
  const wedge = wedgeAt(at.x - origin.x, at.y - origin.y);
  return wedge && ring[wedge] ? wedge : null;
}

/** The wedge the pointer aims at now, if it applies; null while closed, in the dead zone or on a dim wedge. */
export function aimedWedge(state: PieState, ring: PieRingKeys): Wedge | null {
  return state.phase === "closed" ? null : applyingWedgeAt(state.origin, state.pointer, ring);
}

const stay = (state: PieState): PieStep => ({ state, chosen: null });
const choose = (wedge: Wedge): PieStep => ({ state: CLOSED, chosen: wedge });

/**
 * The menu after `event`, for a ring `ring` and a display delay of `delayMs`. Hold, drag and
 * release chooses the wedge released on, whether or not the menu has drawn yet. A release in
 * the dead zone (a plain click) or on a dim wedge leaves the menu open, drawn, to read; a click
 * then chooses a wedge, or closes the menu in the dead zone. A wedge's letter chooses it while
 * the menu is held or open, and Escape closes it.
 */
export function stepPie(state: PieState, event: PieEvent, ring: PieRingKeys, delayMs: number): PieStep {
  if (event.type === "press") {
    return stay({ phase: "held", origin: event.at, pointer: event.at, pressedAt: event.time, shown: delayMs <= 0 });
  }
  if (state.phase === "closed") return stay(state);
  switch (event.type) {
    case "move":
      return stay({ ...state, pointer: event.at });
    case "tick":
      if (state.phase !== "held" || state.shown || event.time - state.pressedAt < delayMs) return stay(state);
      return stay({ ...state, shown: true });
    case "release": {
      if (state.phase !== "held") return stay(state);
      const wedge = applyingWedgeAt(state.origin, event.at, ring);
      return wedge ? choose(wedge) : stay({ phase: "open", origin: state.origin, pointer: event.at });
    }
    case "click": {
      if (state.phase !== "open") return stay(state);
      if (wedgeAt(event.at.x - state.origin.x, event.at.y - state.origin.y) === null) return stay(CLOSED);
      const wedge = applyingWedgeAt(state.origin, event.at, ring);
      return wedge ? choose(wedge) : stay({ ...state, pointer: event.at });
    }
    case "key": {
      if (event.key === "Escape") return stay(CLOSED);
      const key = event.key.toLowerCase();
      const wedge = WEDGES.find((w) => ring[w]?.letter.toLowerCase() === key);
      return wedge ? choose(wedge) : stay(state);
    }
  }
}
