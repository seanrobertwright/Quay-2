// One Runs view's Run (#454, #466): the creation in flight for its name, which a Run in the
// header joins, and the outcome of the last one it started or joined. A creation outlives the
// view: one in flight when the view comes back on screen is joined, so its outcome shows when it
// ends. It draws nothing; `RunControl` does.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RunStart, RunStarts } from "./runStart.ts";

/** The outcome of the last Run a view started, and what its Copy said. */
export type Started = { start: RunStart; copied: string | null };

export interface RunStartView {
  /** The creation in flight for the name, if any: Run is disabled while there is one. */
  creating: Promise<RunStart> | null;
  /** The last outcome, until it is dismissed or another Run starts. */
  started: Started | null;
  /** Starts a run, or joins the creation in flight. */
  start(): void;
  /** Copies a refusal's words and says whether that worked. */
  copyRefusal(message: string): void;
  dismiss(): void;
}

/** `name`'s Run in `projectPath`, through `starts`; `onCreated` is told of each created run. */
export function useRunStart(starts: RunStarts, projectPath: string, name: string, onCreated: (workOrderId: string) => void): RunStartView {
  const [started, setStarted] = useState<Started | null>(null);
  const creating = useSyncExternalStore(starts.subscribe, () => starts.inFlight(projectPath, name));
  const mountedRef = useRef(true);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const settle = useRef((start: RunStart) => {
    if (!mountedRef.current) return;
    setStarted({ start, copied: null });
    if (start.kind === "created") onCreatedRef.current(start.workOrderId);
  }).current;

  useEffect(() => {
    mountedRef.current = true;
    // A creation started before the view left the screen is joined. One this view starts is
    // settled where it starts.
    void starts.inFlight(projectPath, name)?.then(settle);
    return () => {
      mountedRef.current = false;
    };
  }, [starts, projectPath, name, settle]);

  return {
    creating,
    started,
    start() {
      setStarted(null);
      void starts.start(projectPath, name).then(settle);
    },
    copyRefusal(message) {
      const copied = (text: string) => setStarted((s) => (s ? { ...s, copied: text } : s));
      navigator.clipboard.writeText(message).then(
        () => copied("Copied praxis's words."),
        (e) => copied(`Couldn't copy: ${String(e)}`),
      );
    },
    dismiss: () => setStarted(null),
  };
}
