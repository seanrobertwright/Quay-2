// What the template catalog (#449) and the graph host model (#461) share as they read the Praxis
// host for one project's builder session: the `praxis` calls in flight and their cancel, the
// listeners, and the timer that wakes them when a reading turns muted. Each model keeps its own
// readings and states; this module holds none.
import { hostConditionView } from "./hostCondition.ts";
import type { CallOutcome, HostCondition, Invoker } from "./praxisHost.ts";

/** How long a reading is current; after it, the state is shown muted ("may be out of date"). */
export const MUTED_AFTER_MS = 10 * 60_000;

/** The most `show` calls a model runs at once. */
export const MAX_SHOWS_IN_FLIGHT = 2;

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when the host condition lets Quay read the host. */
export const online = (condition: HostCondition) => hostConditionView(condition).usable;

/**
 * Runs at most `limit` tasks at once, in the order they were queued. The limit is this queue's,
 * so no caller can run past it.
 */
export function createLimiter(limit: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (running >= limit) return;
    const start = queue.shift();
    if (start) start();
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        running += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            next();
          });
      });
      next();
    });
  };
}

export interface HostReadSession {
  /**
   * One `praxis` call through the runner for the session's project, cancelled by `dispose`. It
   * never rejects: an `invoke` that throws comes back as a `refused` outcome.
   */
  praxis(command: string, args: Record<string, unknown>): Promise<CallOutcome>;
  /**
   * Re-arms the mute timer, runs the model's `onChange`, then calls every listener. Does
   * nothing once disposed.
   */
  changed(): void;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** True once `dispose` has run. */
  readonly disposed: boolean;
  /** Cancels every call in flight, clears the mute timer and drops the listeners. */
  dispose(): void;
}

export interface HostReadSessionOptions {
  projectPath: string;
  call: Invoker;
  /** When each reading the model holds was taken, in ms since the epoch. */
  stamps: () => Iterable<number>;
  /** The model's own work on each change, run before the listeners. */
  onChange?: () => void;
}

export function createHostReadSession({ projectPath, call, stamps, onChange }: HostReadSessionOptions): HostReadSession {
  let disposed = false;
  const callIds = new Set<string>();
  const listeners = new Set<() => void>();
  let muteTimer: ReturnType<typeof setTimeout> | null = null;

  function changed() {
    if (disposed) return;
    scheduleMute();
    onChange?.();
    for (const listener of listeners) listener();
  }

  /** Wakes listeners when the next current reading turns muted. */
  function scheduleMute() {
    if (muteTimer !== null) clearTimeout(muteTimer);
    muteTimer = null;
    const now = Date.now();
    const current = [...stamps()].filter((at) => now - at < MUTED_AFTER_MS);
    if (current.length === 0) return;
    muteTimer = setTimeout(changed, Math.min(...current) + MUTED_AFTER_MS - now);
  }

  return {
    async praxis(command, args) {
      const callId = crypto.randomUUID();
      callIds.add(callId);
      try {
        return (await call(command, { projectPath, callId, ...args })) as CallOutcome;
      } catch (e) {
        return { kind: "refused", message: String(e) };
      } finally {
        callIds.delete(callId);
      }
    },
    changed,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get disposed() {
      return disposed;
    },
    dispose() {
      disposed = true;
      if (muteTimer !== null) clearTimeout(muteTimer);
      muteTimer = null;
      listeners.clear();
      for (const callId of callIds) void call("praxis_host_cancel", { callId }).catch(() => {});
    },
  };
}
