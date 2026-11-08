// Checks a trigger draft that has a Starts target with the backend's `praxis_check_trigger`
// (#472): the Praxis host's graph trigger rules, and the trigger's contract against its target's.
// A trigger without a target is never sent, so it is checked exactly as before.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TriggerTargetCheck } from "./types.ts";

/**
 * The check as the form last read it. A done check stays shown while the next one runs, marked
 * `pending`, so the issues don't flicker as the user types.
 */
export type TriggerCheckStatus =
  | { state: "checking" }
  | { state: "failed"; error: string }
  | { state: "done"; check: TriggerTargetCheck; pending: boolean };

/** What a trigger without a target is checked against as a graph trigger: nothing. */
const UNTARGETED: TriggerCheckStatus = { state: "done", check: { refused: [], diagnostics: [] }, pending: false };

/** The result and what it is for, so a result for older input shows as pending. */
type Checked = { content: unknown; target: string; refresh: number } & ({ check: TriggerTargetCheck } | { error: string });

/**
 * The check of a trigger with `content` that starts `target`, rerun when either changes or
 * `refresh` counts up, as it does when the builder saves, renames or deletes a record. An answer
 * for older input is never shown as current. With no target nothing is checked.
 */
export function useTriggerCheck(projectPath: string, content: unknown, target: string | null, refresh: number): TriggerCheckStatus {
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (target === null) return;
    let stale = false;
    invoke<TriggerTargetCheck>("praxis_check_trigger", { projectPath, content, target }).then(
      (check) => {
        if (!stale) setChecked({ content, target, refresh, check });
      },
      (e) => {
        if (!stale) setChecked({ content, target, refresh, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [projectPath, content, target, refresh]);

  if (target === null) return UNTARGETED;
  const pending = !checked || checked.content !== content || checked.target !== target || checked.refresh !== refresh;
  // A check for another target names other refusals and another contract, so it isn't shown.
  if (checked?.target !== target) return { state: "checking" };
  if ("check" in checked) return { state: "done", check: checked.check, pending };
  if (pending) return { state: "checking" };
  return { state: "failed", error: checked.error };
}
