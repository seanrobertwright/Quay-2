import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./gitVersion";
import { progressLine, type OpEvent, type SpeedupCheck, type SpeedupItem } from "./speedup";
import type { ToposSettings, ToposSettingsPatch } from "./toposSettings";

/** Where an apply stands, as the dialog shows it. */
export type ApplyState =
  | { state: "idle" }
  | { state: "running"; opId: string; line: string | null }
  | { state: "failed"; message: string };

export interface Speedup {
  /** What `git_speedup_check` said for the repo, or null until it answers or when it failed. */
  check: SpeedupCheck | null;
  /** Whether the operator closed the banner since the repo opened. */
  dismissed: boolean;
  dismiss: () => void;
  /** "Don't suggest for this repo": stored in the repo's topos.json entry. */
  suppress: () => void;
  apply: ApplyState;
  /** Runs the ticked items, then checks again. Resolves true once every item was written. */
  run: (items: SpeedupItem[]) => Promise<boolean>;
  /** Stops the running commit-graph write. */
  cancel: () => void;
  /** Clears a failed apply, as the dialog closes. */
  reset: () => void;
}

/**
 * The speed-ups for `repoPath` (#385). The check runs once per repo it opens on; nothing is
 * written until `run`, and then only the items it is given.
 */
export function useSpeedup(repoPath: string | null): Speedup {
  const [check, setCheck] = useState<SpeedupCheck | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [apply, setApply] = useState<ApplyState>({ state: "idle" });
  // Only the newest check may set the result, so a check for the last repo can't land on this one.
  const checkId = useRef(0);
  const repo = useRef(repoPath);
  repo.current = repoPath;

  const recheck = useCallback(() => {
    const id = ++checkId.current;
    const path = repo.current;
    if (path === null) {
      setCheck(null);
      return Promise.resolve();
    }
    return invoke<SpeedupCheck>("git_speedup_check", { repoPath: path })
      .then((result) => {
        if (id === checkId.current) setCheck(result);
      })
      .catch((e: unknown) => {
        // A failed check offers nothing; the banner just stays away.
        if (id === checkId.current) setCheck(null);
        console.error(errorMessage(e));
      });
  }, []);

  useEffect(() => {
    setCheck(null);
    setDismissed(false);
    setApply({ state: "idle" });
    void recheck();
  }, [repoPath, recheck]);

  const dismiss = useCallback(() => setDismissed(true), []);

  const suppress = useCallback(() => {
    const path = repo.current;
    if (path === null) return;
    setCheck((c) => (c === null ? c : { ...c, suppressed: true }));
    const patch: ToposSettingsPatch = { suppressSpeedup: path };
    invoke<ToposSettings>("topos_settings_write", { patch }).catch(console.error);
  }, []);

  const run = useCallback(
    async (items: SpeedupItem[]) => {
      const path = repo.current;
      if (path === null || items.length === 0) return false;
      const opId = crypto.randomUUID();
      setApply({ state: "running", opId, line: null });
      const channel = new Channel<OpEvent>();
      channel.onmessage = (event) => {
        const line = progressLine(event);
        if (line !== null) setApply((a) => (a.state === "running" && a.opId === opId ? { ...a, line } : a));
      };
      try {
        await invoke("git_speedup_apply", { repoPath: path, items, opId, onEvent: channel });
      } catch (e: unknown) {
        if (repo.current === path) {
          const cancelled = typeof e === "object" && e !== null && (e as { kind?: unknown }).kind === "cancelled";
          setApply({ state: "failed", message: cancelled ? "The commit-graph write was cancelled." : errorMessage(e) });
          void recheck();
        }
        return false;
      }
      if (repo.current !== path) return false;
      setApply({ state: "idle" });
      // Applied items are no longer offered; whatever is left can be offered again another time.
      setDismissed(true);
      await recheck();
      return true;
    },
    [recheck]
  );

  const cancel = useCallback(() => {
    if (apply.state !== "running") return;
    invoke("git_op_cancel", { opId: apply.opId }).catch(console.error);
  }, [apply]);

  const reset = useCallback(() => setApply((a) => (a.state === "failed" ? { state: "idle" } : a)), []);

  return { check, dismissed, dismiss, suppress, apply, run, cancel, reset };
}
