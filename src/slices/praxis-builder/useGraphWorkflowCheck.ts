// Checks a graph workflow draft against the saved records it names with the backend's
// `praxis_check_graph_workflow` (#459): whether they exist, are valid and agree, and the grant
// set the workflow carries.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GraphWorkflowCheck } from "./types.ts";

/**
 * The check as the form last read it. A done check stays shown while the next one runs, marked
 * `pending`, so the issues don't flicker as the user types.
 */
export type GraphWorkflowCheckStatus =
  | { state: "checking" }
  | { state: "failed"; error: string }
  | { state: "done"; check: GraphWorkflowCheck; pending: boolean };

/** The result and what it is for, so a result for older content shows as pending. */
type Checked = { content: unknown; refresh: number } & ({ check: GraphWorkflowCheck } | { error: string });

/**
 * The check of a graph workflow with `content`, rerun when it changes or `refresh` counts up, as
 * it does when the builder saves, renames or deletes a record. An answer for older input is
 * never shown as current.
 */
export function useGraphWorkflowCheck(projectPath: string, content: unknown, refresh: number): GraphWorkflowCheckStatus {
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    let stale = false;
    invoke<GraphWorkflowCheck>("praxis_check_graph_workflow", { projectPath, content }).then(
      (check) => {
        if (!stale) setChecked({ content, refresh, check });
      },
      (e) => {
        if (!stale) setChecked({ content, refresh, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [projectPath, content, refresh]);

  const pending = !checked || checked.content !== content || checked.refresh !== refresh;
  if (checked && "check" in checked) return { state: "done", check: checked.check, pending };
  if (!checked || pending) return { state: "checking" };
  return { state: "failed", error: checked.error };
}
