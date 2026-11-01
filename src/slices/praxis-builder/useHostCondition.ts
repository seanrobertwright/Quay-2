// The builder project's host condition, as the latest call for it left it (#448). It reads the
// backend's condition when the project changes and follows the `praxis-host-condition` event;
// it never calls `praxis` by itself, except for the 60 s recheck while a failing condition holds
// and a view that needs the host is on screen.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hostConditionView } from "./hostCondition.ts";
import { createHostRecheck } from "./hostRecheck.ts";
import { createLatestCondition } from "./latestCondition.ts";
import { checkHost, listenHostCondition, type HostCondition } from "./praxisHost.ts";

export interface HostConditionState {
  condition: HostCondition;
  /** Why the last recheck couldn't be made, such as an unregistered project; null when it was. */
  error: string | null;
}

/** True while the window is shown, not minimized or in a background tab. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * `projectPath`'s host condition. `hostNeeded` says a view that needs the host is open; with the
 * window shown and a failing condition, that is when the recheck runs.
 */
export function useHostCondition(projectPath: string | null, hostNeeded: boolean): HostConditionState {
  const [latest] = useState(createLatestCondition);
  const [condition, setCondition] = useState<HostCondition>({ state: "notCheckedYet" });
  const [error, setError] = useState<string | null>(null);
  const visible = useDocumentVisible();

  // Reads the backend's condition for the project, keeping the answer only if it is the newest.
  const read = useCallback(
    (path: string) => {
      const id = latest.beginRead();
      invoke<HostCondition>("praxis_host_condition", { projectPath: path }).then(
        (answer) => {
          if (latest.readDone(id, answer)) setCondition(latest.current());
        },
        // A project the backend doesn't know keeps "not checked yet"; the views say why it can't load.
        () => {},
      );
    },
    [latest],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    void listenHostCondition((change) => {
      if (latest.changed(change)) setCondition(latest.current());
    }).then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [latest]);

  // A recheck ends by reading the condition it left. It never rejects: a check that couldn't be
  // made sets `error`.
  const checkOnce = useCallback(
    async (path: string, signal: AbortSignal) => {
      try {
        await checkHost(path, signal);
        if (!signal.aborted) setError(null);
      } catch (e) {
        if (!signal.aborted) setError(String(e));
      } finally {
        if (!signal.aborted) read(path);
      }
    },
    [read],
  );

  useEffect(() => {
    latest.project(projectPath);
    setCondition(latest.current());
    setError(null);
    if (projectPath) read(projectPath);
  }, [projectPath, latest, read]);

  const failing = hostConditionView(condition).failing;
  const active = hostNeeded && visible && failing && projectPath !== null;
  useEffect(() => {
    if (!active || !projectPath) return;
    const recheck = createHostRecheck((signal) => checkOnce(projectPath, signal));
    recheck.set(true);
    return () => recheck.stop();
  }, [active, projectPath, checkOnce]);

  return { condition, error };
}
