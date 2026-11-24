import { useEffect, useState } from "react";

/** How often what says how long ago something was is read again, in milliseconds. */
const TICK_MS = 30_000;

/** Draws again now and then while `ticking`, so that what is drawn of how long ago something was stays true. */
export function useTick(ticking: boolean): void {
  const [, setTicks] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTicks((ticks) => ticks + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
}
