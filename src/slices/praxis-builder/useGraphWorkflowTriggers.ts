// Reads the triggers that start a graph workflow with the backend's
// `praxis_graph_workflow_triggers` (#479): those whose saved target file names it.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GraphWorkflowTriggers } from "./types.ts";

export type GraphWorkflowTriggersStatus =
  | { state: "loading" }
  | { state: "failed"; error: string }
  | { state: "done"; found: GraphWorkflowTriggers };

/** The answer and what it is for, so one for another id or an older refresh isn't shown. */
type Read = { id: string; refresh: number } & ({ found: GraphWorkflowTriggers } | { error: string });

/**
 * The triggers that start graph workflow `graphWorkflowId`, read again when the id changes, as
 * it does on a rename, or `refresh` counts up, as it does when the builder saves, renames or
 * deletes a record. An answer for another id or an older refresh is never shown.
 */
export function useGraphWorkflowTriggers(projectPath: string, graphWorkflowId: string, refresh: number): GraphWorkflowTriggersStatus {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    let stale = false;
    const id = graphWorkflowId;
    invoke<GraphWorkflowTriggers>("praxis_graph_workflow_triggers", { projectPath, graphWorkflowId: id }).then(
      (found) => {
        if (!stale) setRead({ id, refresh, found });
      },
      (e) => {
        if (!stale) setRead({ id, refresh, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [projectPath, graphWorkflowId, refresh]);

  if (!read || read.id !== graphWorkflowId || read.refresh !== refresh) return { state: "loading" };
  return "found" in read ? { state: "done", found: read.found } : { state: "failed", error: read.error };
}
