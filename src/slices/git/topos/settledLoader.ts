// Loading what a selection shows once it settles (#368, #397): details load 120 ms after the
// selection stops moving, every read carries a request id so a stale answer is dropped, answers
// are cached by key in an LRU, and the last thing shown stays until the new one arrives.

import { Lru } from "./lru.ts";

/** The timer functions the loader uses, passed in so tests can run time by hand. */
export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface LoadState<T> {
  /** The selected key, or null for no selection. */
  key: string | null;
  /** What is shown: the selected key's value, or the previous one's while it loads. */
  shown: T | null;
  /** The key `shown` belongs to. */
  shownKey: string | null;
  /** True while the selected key's value is on its way, so `shown` is an older key's. */
  pending: boolean;
  /** Why the selected key's read failed, or null. */
  error: string | null;
}

export interface SettledLoaderOptions<T> {
  fetch: (key: string) => Promise<T>;
  /** How long the selection must hold still before it is read. */
  delayMs: number;
  /** How many answers the cache keeps. */
  capacity: number;
  timers: Timers;
  onState: (state: LoadState<T>) => void;
  /** A failed read's reason as text. */
  describe?: (error: unknown) => string;
}

function defaultDescribe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SettledLoader<T> {
  private readonly options: SettledLoaderOptions<T>;
  private readonly cache: Lru<string, T>;
  private state: LoadState<T> = { key: null, shown: null, shownKey: null, pending: false, error: null };
  private timer: unknown = null;
  private latest = 0;
  private disposed = false;

  constructor(options: SettledLoaderOptions<T>) {
    this.options = options;
    this.cache = new Lru<string, T>(options.capacity);
  }

  private put(next: LoadState<T>): void {
    this.state = next;
    this.options.onState(next);
  }

  private cancelWait(): void {
    if (this.timer !== null) this.options.timers.clear(this.timer);
    this.timer = null;
  }

  /**
   * Selects `key`: a cached value shows at once; otherwise the previous value stays, marked
   * pending, and `key` is read once no other selection has come for the delay. Null clears.
   */
  select(key: string | null): void {
    if (this.disposed) return;
    this.cancelWait();
    // A newer selection makes any answer still on its way stale.
    const id = ++this.latest;
    if (key === null) {
      this.put({ key: null, shown: null, shownKey: null, pending: false, error: null });
      return;
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.put({ key, shown: cached, shownKey: key, pending: false, error: null });
      return;
    }
    this.put({ ...this.state, key, pending: true, error: null });
    this.timer = this.options.timers.set(() => {
      this.timer = null;
      this.read(key, id);
    }, this.options.delayMs);
  }

  private read(key: string, id: number): void {
    this.options.fetch(key).then(
      (value) => {
        this.cache.set(key, value);
        if (this.disposed || id !== this.latest) return;
        this.put({ key, shown: value, shownKey: key, pending: false, error: null });
      },
      (error: unknown) => {
        if (this.disposed || id !== this.latest) return;
        this.put({ ...this.state, pending: false, error: (this.options.describe ?? defaultDescribe)(error) });
      }
    );
  }

  /** Stops for good: the wait is cleared and no answer lands after this. */
  dispose(): void {
    this.disposed = true;
    this.cancelWait();
  }
}
