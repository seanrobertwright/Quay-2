// Runs a graph binding's attach checks with the backend's `praxis_check_binding` (#274): its
// limits, cost unit and criteria under each saved contract that lists its graph, with the
// coverage of those criteria. The frontend never checks on its own.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AttachStatus } from "./bindingChecks.ts";
import type { BindingAttach } from "./types.ts";

/** The result and the project and binding it is for. */
type Checked = { projectPath: string; bindingId: string } & ({ attach: BindingAttach } | { error: string });

/**
 * The attach checks of the binding `content`, with `graph` as its graph's draft, rerun whenever
 * either changes or `refresh` does, as after a save, since the contracts are read as saved.
 * While a recheck runs, the binding `bindingId`'s last result stands, so the worst-case figures
 * don't flicker as the user types; it is `checking` only before that binding's first result. A
 * null `content` or `graph` is nothing to check.
 */
export function useBindingAttach(
  projectPath: string | null,
  bindingId: string | null,
  content: unknown,
  graph: unknown,
  refresh: number
): AttachStatus {
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (!projectPath || bindingId === null || content === null || graph === null) return;
    let stale = false;
    invoke<BindingAttach>("praxis_check_binding", { projectPath, content, graph }).then(
      (attach) => {
        if (!stale) setChecked({ projectPath, bindingId, attach });
      },
      (e) => {
        if (!stale) setChecked({ projectPath, bindingId, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [projectPath, bindingId, content, graph, refresh]);

  // The same object while nothing changes, so what is built from it can be memoized.
  return useMemo(() => {
    if (!checked || checked.projectPath !== projectPath || checked.bindingId !== bindingId) return CHECKING;
    return "error" in checked ? { state: "failed", error: checked.error } : { state: "done", attach: checked.attach };
  }, [checked, projectPath, bindingId]);
}

const CHECKING: AttachStatus = { state: "checking" };
