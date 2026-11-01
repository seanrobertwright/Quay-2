// A poller for the Runs view (#362, #452): reads at once when started, then again after the delay
// each read asks for. The runs list asks for 15 s, or 60 s while the host is down; a followed
// run's detail (#453) asks for its own delays, or for no more reads once the run has ended. Reads
// never overlap: each wait starts when the last read ended.
//
// Stopping is explicit. The builder is only hidden when it closes, so a view that polls stops its
// poller whenever it leaves the screen; stopping aborts the read in flight, whose owner kills its
// `praxis` process, and clears the timer.

/** One read. It resolves to the wait before the next, in ms, or null for no more reads. */
export type PollRead = (signal: AbortSignal) => Promise<number | null>;

export interface Poller {
  /** Starts polling, reading at once, or stops it. Starting a poller that runs changes nothing. */
  set(active: boolean): void;
  /** Stops polling: the same as `set(false)`. */
  stop(): void;
  /** While polling, reads at once: the read in flight is aborted and the wait starts over. */
  now(): void;
}

export function createPoller(read: PollRead): Poller {
  let active = false;
  // Counts the reads started, so a read that was aborted or replaced schedules nothing.
  let current = 0;
  // The wait a rejected read keeps, so a passing failure doesn't end the polling.
  let lastDelay: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: AbortController | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    running?.abort();
    running = null;
  };

  const start = () => {
    clear();
    current += 1;
    const own = current;
    const controller = new AbortController();
    running = controller;
    read(controller.signal).then(
      (delay) => {
        lastDelay = delay;
        return delay;
      },
      // The read reports its own failures.
      () => lastDelay,
    ).then((delay) => {
      if (own !== current || !active) return;
      running = null;
      if (delay !== null) timer = setTimeout(start, delay);
    });
  };

  const set = (next: boolean) => {
    if (next === active) return;
    active = next;
    if (active) {
      lastDelay = null;
      start();
      return;
    }
    current += 1;
    clear();
  };

  return {
    set,
    stop: () => set(false),
    now: () => {
      if (active) start();
    },
  };
}
