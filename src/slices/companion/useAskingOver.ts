// When the companion shows the Surface view over the view it would show: while an asking surface of
// the selected terminal is to be seen. The view underneath is left as it is, so it is the one the
// companion returns to when the surface settles.
import { useCallback, useState } from "react";
import { sameSurface } from "../surface/surfaceAttention.ts";
import type { SurfaceRecord } from "../surface/surfaceTypes.ts";

interface Seen {
  terminalId: string | null;
  /** The asking surfaces already dealt with; null until it is decided what the terminal opens. */
  asking: readonly SurfaceRecord[] | null;
}

/** A terminal's asking surfaces, and which of them the companion has dealt with. */
export interface AskingState {
  terminalId: string | null;
  asking: readonly SurfaceRecord[];
  seen: Seen;
  isOver: boolean;
  /** Forgets what is seen: another terminal is selected. */
  restart: () => void;
  /** Shows the Surface view over the one underneath, while any surface asks. */
  open: () => void;
  /** Takes the surfaces that ask off the screen: another view was asked for. One that asks later shows again. */
  leave: () => void;
}

/**
 * The state that `useAskingOver` follows. `asking` is `terminalId`'s asking surfaces as `askingOf`
 * gives them. `open` and `leave` are for what the operator does between renders; what is asked for
 * in a render is given to `useAskingOver` instead.
 */
export function useAskingState(terminalId: string | null, asking: readonly SurfaceRecord[]): AskingState {
  const [seen, setSeen] = useState<Seen>({ terminalId, asking: null });
  const [isOver, setIsOver] = useState(false);
  const put = useCallback(
    (over: boolean) => {
      setSeen({ terminalId, asking });
      setIsOver(over);
    },
    [terminalId, asking],
  );
  const open = useCallback(() => put(asking.length > 0), [asking, put]);
  const leave = useCallback(() => put(false), [put]);
  const restart = () => {
    setSeen({ terminalId, asking: null });
    setIsOver(false);
  };
  return { terminalId, asking, seen, isOver, restart, open, leave };
}

/**
 * What this render was asked for: `open`, the Surface view; `leave`, another view; `wait`, only that
 * the view underneath changes, so whether a surface goes over it is decided in the next render.
 */
export type AskedOfRender = "open" | "leave" | "wait";

interface Underneath {
  /** What this render was asked for, or null. */
  asked: AskedOfRender | null;
  /** Whether the terminal's asking surfaces and its permission requests are known. */
  ready: boolean;
  /** Whether the view underneath is on screen with an undecided card of Quay's. */
  cardShown: boolean;
  /** Whether the terminal has a permission request waiting. */
  permissionPending: boolean;
  /** Shows the Activity view underneath. */
  showActivity: () => void;
}

/** Whether `asking` holds a surface that `before` does not. */
const holdsNew = (asking: readonly SurfaceRecord[], before: readonly SurfaceRecord[]): boolean =>
  asking.some((record) => !before.some((known) => sameSurface(record, known)));

/**
 * Whether the Surface view shows over the companion's view, by what is asked of this render, the
 * selection and the terminal's asking surfaces. What a selected terminal opens is decided once
 * `ready`, which on a webview reload is after the selection is restored.
 */
export function useAskingOver(
  { terminalId, asking, seen, isOver, restart, open, leave }: AskingState,
  { asked, ready, cardShown, permissionPending, showActivity }: Underneath,
): boolean {
  const follow = () => {
    if (seen.terminalId !== terminalId) return restart();
    if (seen.asking === null) {
      if (!ready || terminalId === null) return;
      if (permissionPending) leave();
      else open();
      if (asking.length > 0 && permissionPending) showActivity();
    } else if (seen.asking !== asking) {
      if (isOver || (!cardShown && holdsNew(asking, seen.asking))) open();
      else leave();
    }
  };
  if (asked === "open") open();
  else if (asked === "leave") leave();
  else if (asked === null) follow();
  return isOver && seen.terminalId === terminalId && asking.length > 0;
}
