import { useCallback, useRef, useState } from "react";
import { RAW_TOOL } from "./rawTool.ts";
import { moveSurface } from "./surfaceHost.ts";
import { requestSurface } from "./surfaceRequests.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** What a surface's frame needs to move it. */
export interface Move {
  move: () => void;
  /** Whether it is being moved. */
  moving: boolean;
  /** Whether it goes to a stage tab, or back to the companion. */
  toTab: boolean;
}

/**
 * Moves `record`'s surface between the companion and a stage tab, and brings it into view there. Null unless
 * it is a raw surface that its agent put in the companion. `onRefusal` gets Quay's words for why it stays,
 * and null while it is tried.
 */
export function useMove(record: SurfaceRecord, onRefusal: (why: string | null) => void): Move | null {
  const [moving, setMoving] = useState(false);
  // A second click can come before the button is drawn again.
  const running = useRef(false);
  const toTab = !record.as_tab;
  const { terminal_id, id } = record;
  const move = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setMoving(true);
    onRefusal(null);
    try {
      await moveSurface({ terminal_id, id }, toTab);
      requestSurface({ terminal_id, id });
    } catch (error) {
      onRefusal(String(error));
    } finally {
      running.current = false;
      setMoving(false);
    }
  }, [terminal_id, id, toTab, onRefusal]);
  if (record.tool !== RAW_TOOL || record.place !== "companion") return null;
  return { move: () => void move(), moving, toTab };
}
