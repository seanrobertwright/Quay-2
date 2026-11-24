// Which of a terminal's asking surfaces is drawn open. The others are lines.
import { useState } from "react";
import { askingOf, sameSurface } from "./surfaceAttention.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { SurfaceFocus } from "./SurfaceView.tsx";

export interface SurfaceQueue {
  /** How many wait. */
  waiting: number;
  /** The one drawn open, or null when none asks. */
  open: SurfaceRecord | null;
  /** Opens one that waits, which folds the one that was open. */
  choose: (record: SurfaceRecord) => void;
}

/**
 * The queue of `surfaces`, one terminal's, oldest first. The one the operator opened, or that `focus`
 * names, is open while it asks; otherwise the oldest is.
 */
export function useSurfaceQueue(surfaces: readonly SurfaceRecord[], focus: SurfaceFocus | null): SurfaceQueue {
  const [chosen, choose] = useState<SurfaceRecord | null>(null);
  const [followed, setFollowed] = useState<SurfaceFocus | null>(null);
  const asking = askingOf(surfaces);
  if (focus && focus.seq !== followed?.seq) {
    setFollowed(focus);
    choose(asking.find(({ id }) => id === focus.surfaceId) ?? null);
  }
  const open = asking.find((record) => chosen && sameSurface(record, chosen)) ?? asking[0] ?? null;
  return { waiting: asking.length, open, choose };
}
