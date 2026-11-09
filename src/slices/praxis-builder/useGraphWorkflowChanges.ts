// Reads which of a graph workflow's files have changes since the last commit with the backend's
// `praxis_graph_workflow_changes` (#466), for a graph run's confirm.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BundleChangesRead } from "./graphRunStart.ts";
import type { BundleChanges } from "./types.ts";

/** The answer and what it is for, so one for another graph workflow isn't shown. */
type Read = { projectPath: string; name: string; changes: BundleChangesRead };

/**
 * The changed files of graph workflow `name` in `projectPath`, read once when the caller mounts
 * and again when either changes; null until the answer for them arrives.
 */
export function useGraphWorkflowChanges(projectPath: string, name: string): BundleChangesRead | null {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    let stale = false;
    invoke<BundleChanges>("praxis_graph_workflow_changes", { projectPath, name }).then(
      (changes) => {
        if (!stale) setRead({ projectPath, name, changes });
      },
      (e) => {
        if (!stale) setRead({ projectPath, name, changes: { error: String(e) } });
      },
    );
    return () => {
      stale = true;
    };
  }, [projectPath, name]);

  return read && read.projectPath === projectPath && read.name === name ? read.changes : null;
}
