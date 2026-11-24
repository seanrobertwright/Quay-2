// When the companion shows the Surface view over the view it would show: while a question of the
// selected terminal asks to be seen. The view underneath is left as it is, so it is the one the
// companion returns to when the question settles.
import { useCallback, useState } from "react";
import type { SurfaceRecord } from "../surface/surfaceTypes.ts";

/** What decides whether the Surface view goes over the one underneath. */
interface Underneath {
  /** Whether the view underneath is on screen with an undecided card of Quay's. */
  cardShown: boolean;
  /** Whether the terminal has a permission request waiting. */
  permissionPending: boolean;
  /** Shows the Activity view underneath. */
  showActivity: () => void;
}

export interface QuestionOver {
  /** Whether the Surface view shows over the view underneath. */
  over: boolean;
  /** Shows the Surface view over it while the terminal has a question; says whether it has one. */
  open: () => boolean;
  /** Takes the questions there are off the screen: another view was asked for. One that arrives later shows again. */
  leave: () => void;
  /**
   * Follows the selection and the terminal's questions. Called in every render that has not called
   * `open` or `leave`, once what is underneath is known.
   */
  follow: (underneath: Underneath) => void;
}

const keyOf = ({ id, order }: SurfaceRecord) => `${order} ${id}`;

/** Whether `asking` holds a question that `before` does not. */
function holdsNew(asking: readonly SurfaceRecord[], before: readonly SurfaceRecord[]): boolean {
  const known = new Set(before.map(keyOf));
  return asking.some((record) => !known.has(keyOf(record)));
}

/**
 * Whether a question of `terminalId` shows over the companion's view. `asking` is its asking
 * surfaces, the same list until one changes. What a selected terminal opens is decided once `ready`:
 * when both its questions and its permission requests are known, which on a webview reload is after
 * the selection is restored.
 */
export function useQuestionOver(terminalId: string | null, asking: readonly SurfaceRecord[], ready: boolean): QuestionOver {
  // The questions already dealt with; null until it is decided what the terminal opens.
  const [seen, setSeen] = useState<{ terminalId: string | null; asking: readonly SurfaceRecord[] | null }>({ terminalId, asking: null });
  const [isOver, setIsOver] = useState(false);
  const put = useCallback(
    (over: boolean) => {
      setSeen({ terminalId, asking });
      setIsOver(over);
    },
    [terminalId, asking],
  );
  const open = useCallback(() => {
    if (asking.length === 0) return false;
    put(true);
    return true;
  }, [asking, put]);
  const leave = useCallback(() => put(false), [put]);

  const follow = ({ cardShown, permissionPending, showActivity }: Underneath) => {
    if (seen.terminalId !== terminalId) {
      setSeen({ terminalId, asking: null });
      setIsOver(false);
    } else if (seen.asking === null) {
      if (!ready || terminalId === null) return;
      put(asking.length > 0 && !permissionPending);
      if (asking.length > 0 && permissionPending) showActivity();
    } else if (seen.asking !== asking) {
      put(asking.length > 0 && (isOver || (!cardShown && holdsNew(asking, seen.asking))));
    }
  };
  return { over: isOver && seen.terminalId === terminalId && asking.length > 0, open, leave, follow };
}
