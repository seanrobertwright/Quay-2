// Reads which of a record's files have changes since the last commit: a graph workflow's with
// the backend's `praxis_graph_workflow_changes` (#466), for a graph run's confirm, or a graph
// trigger's with `praxis_trigger_changes` (#476), for its Submit.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BundleChangesRead } from "./graphRunStart.ts";
import type { BundleChanges } from "./types.ts";

/** The backend commands that list a record's changed files. */
export type ChangesCommand = "praxis_graph_workflow_changes" | "praxis_trigger_changes";

/** Record `name`'s changed files, as `command` lists them, or why git status can't be read. Never rejects. */
export function readChanges(command: ChangesCommand, projectPath: string, name: string): Promise<BundleChangesRead> {
  return invoke<BundleChanges>(command, { projectPath, name }).then(
    (changes) => changes,
    (e) => ({ error: String(e) }),
  );
}

/**
 * Record `name`'s changed files in `projectPath`, as `command` lists them, read when the caller
 * mounts and again when any argument changes; bump `refresh` to read them again. Null while
 * `name` is null, and until the answer for the current arguments arrives: an older one is dropped.
 */
export function useRecordChanges(command: ChangesCommand, projectPath: string, name: string | null, refresh = 0): BundleChangesRead | null {
  const [read, setRead] = useState<{ key: string; changes: BundleChangesRead } | null>(null);
  const key = `${command}\n${projectPath}\n${name}\n${refresh}`;
  useEffect(() => {
    if (name === null) return;
    let stale = false;
    void readChanges(command, projectPath, name).then((changes) => !stale && setRead({ key, changes }));
    return () => {
      stale = true;
    };
  }, [command, projectPath, name, key]);
  return name !== null && read?.key === key ? read.changes : null;
}
