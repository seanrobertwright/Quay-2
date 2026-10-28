// Checks a grant draft against the saved records around it with the backend's
// `praxis_check_grant` (#223, #231): its delegation chain and its scratch missions.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GrantCheck } from "./types.ts";

/**
 * The grant check as the form last read it. A done check stays shown while the next one
 * runs, marked `pending`, so the chain and the limit checks don't flicker as the user types.
 */
export type GrantCheckStatus =
  | { state: "checking" }
  | { state: "failed"; error: string }
  | { state: "done"; check: GrantCheck; pending: boolean };

/** The result and what it is for, so a result for older content shows as pending. */
type Checked = { content: unknown; refresh: number } & ({ check: GrantCheck } | { error: string });

/** How long typing must pause before the check runs, since each one reads the chain and every bindings file. */
const PAUSE_MS = 250;

/** The check of the grant `id` with `content`, rerun when either changes or `refresh` counts up. */
export function useGrantCheck(projectPath: string, id: string, content: unknown, refresh: number): GrantCheckStatus {
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      invoke<GrantCheck>("praxis_check_grant", { projectPath, id, content }).then(
        (check) => {
          if (!stale) setChecked({ content, refresh, check });
        },
        (e) => {
          if (!stale) setChecked({ content, refresh, error: String(e) });
        }
      );
    }, PAUSE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [projectPath, id, content, refresh]);

  const pending = !checked || checked.content !== content || checked.refresh !== refresh;
  if (checked && "check" in checked) return { state: "done", check: checked.check, pending };
  if (!checked || pending) return { state: "checking" };
  return { state: "failed", error: checked.error };
}
