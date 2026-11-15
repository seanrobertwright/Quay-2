import { useMemo, useState } from "react";
import { focusTerminal } from "../terminal/terminalRequests.ts";
import type { CompanionLens } from "./Companion.tsx";
import type { DiffLensTarget } from "./diffLensTarget.ts";

/** The diff lens control `useDiffLens` returns. */
export interface DiffLensControl extends CompanionLens {
  /** Clears the lens without moving focus, for the lens frame's own close, which returns focus itself. */
  dismiss: () => void;
}

/**
 * The diff lens open beside the companion. It belongs to the terminal it opened for, so selecting
 * another terminal closes it. `close` hands keyboard focus back to that terminal, as a close from
 * the companion (its Diff lens button or a click on a readiness cell) must; it does nothing while
 * no lens is open.
 */
export function useDiffLens(activeTerminalId: string | null): DiffLensControl {
  const [shown, setShown] = useState<DiffLensTarget | null>(null);
  if (shown && shown.terminalId !== activeTerminalId) setShown(null);
  return useMemo<DiffLensControl>(
    () => ({
      shown,
      openDiff: setShown,
      dismiss: () => setShown(null),
      close: () => {
        if (!shown) return;
        setShown(null);
        focusTerminal(shown.terminalId);
      },
    }),
    [shown]
  );
}
