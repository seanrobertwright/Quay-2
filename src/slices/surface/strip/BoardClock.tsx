import { useEffect, useState } from "react";
import { formatRunClock, formatTimeWaited } from "../../../lib/dates.ts";
import type { BoardRun } from "../surfaceTypes.ts";

const TICK_MS = 1000;

/** How long a running board goes without an update before it says when it had one, in milliseconds. */
const QUIET_AFTER_MS = 2 * 60_000;

/** The time now, kept true while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

interface BoardClockProps {
  run: BoardRun;
  /** Keeps the clock, which changes every second, out of the name of what it is in. */
  unnamed?: boolean;
}

/** A board's clock, and, while it runs and is quiet, when it was last updated. Nothing else is drawn as it ticks. */
export const BoardClock = ({ run, unnamed = false }: BoardClockProps) => {
  const running = run.stopped_at === null;
  const now = useNow(running);
  // A board that has just been sent is newer than the last tick
  const upTo = run.stopped_at ?? Math.max(now, run.updated_at);
  return (
    <span data-board-clock className="flex shrink-0 items-center gap-2 text-[11px]">
      {running && upTo - run.updated_at >= QUIET_AFTER_MS && <span className="text-[#e3b341]">updated {formatTimeWaited(run.updated_at, upTo)} ago</span>}
      <span aria-hidden={unnamed || undefined} className="font-mono text-[#8b949e]">
        {formatRunClock(upTo - run.started_at)}
      </span>
    </span>
  );
};
