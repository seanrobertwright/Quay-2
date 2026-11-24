import { useCallback, useRef, useState } from "react";
import { dismissSurface } from "./surfaceHost.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** What a surface's frame needs to dismiss it. */
export interface Dismiss {
  dismiss: () => void;
  /** Whether it is being dismissed, or has been and is about to leave. */
  dismissing: boolean;
}

/**
 * Dismisses `record`'s surface, once. `onRefusal` gets Quay's words for why it stays, after which it can
 * be dismissed again, and null while it is tried.
 */
export function useDismiss(record: SurfaceRecord, onRefusal: (why: string | null) => void): Dismiss {
  const [dismissing, setDismissing] = useState(false);
  // A second click can come before the button is drawn again.
  const running = useRef(false);
  const dismiss = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setDismissing(true);
    onRefusal(null);
    try {
      await dismissSurface(record);
    } catch (error) {
      running.current = false;
      setDismissing(false);
      onRefusal(String(error));
    }
  }, [record, onRefusal]);
  return { dismiss: () => void dismiss(), dismissing };
}
