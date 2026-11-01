// The host recheck (#448, #362): while a failing host condition holds and a view that needs the
// host is on screen, Quay checks the host again every 60 s. It is the only check nothing else
// asked for. Each check starts 60 s after the last one ended, so checks never overlap.

/** How long the recheck waits between checks. */
export const HOST_RECHECK_MS = 60_000;

export interface HostRecheck {
  /** Starts the recheck, or stops it. Starting one that runs changes nothing. */
  set(active: boolean): void;
  /** Stops the recheck, clearing its timer. The same as `set(false)`. */
  stop(): void;
}

/**
 * A recheck that calls `check` every `every` ms while active. A check is never run before
 * the first wait. Stopping aborts the running check's signal, and a check that ends after a
 * stop schedules nothing, even when the recheck has been started again since.
 */
export function createHostRecheck(check: (signal: AbortSignal) => Promise<void>, every = HOST_RECHECK_MS): HostRecheck {
  let active = false;
  // Counts the starts, so a check left over from an earlier start can't schedule another.
  let start = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: AbortController | null = null;
  const schedule = (own: number) => {
    timer = setTimeout(() => {
      timer = null;
      const controller = new AbortController();
      running = controller;
      void check(controller.signal)
        .catch(() => {})
        .finally(() => {
          if (running === controller) running = null;
          if (active && own === start) schedule(own);
        });
    }, every);
  };
  const set = (next: boolean) => {
    if (next === active) return;
    active = next;
    if (active) {
      start += 1;
      schedule(start);
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = null;
    running?.abort();
    running = null;
  };
  return { set, stop: () => set(false) };
}
