// Runs the cross-record checks with the backend's `praxis_check_context` (#223, #269) and holds
// each project's results. A full check runs when the builder is shown and whenever `recheckAll`
// asks; opening a record re-checks the contracts it affects, and so does `check` after a save.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizePath } from "../../utils/paths.ts";
import { contractsToRecheck, mergeContexts, NO_CONTEXTS, type RunContexts } from "./runContext.ts";
import type { ContextCheck, DefinitionRef, PraxisKind } from "./types.ts";

/** One project's cross-record checks, and why the last one failed, if it did. */
export interface ProjectContexts {
  contexts: RunContexts;
  error: string | null;
}

const NO_PROJECT_CONTEXTS: ProjectContexts = { contexts: NO_CONTEXTS, error: null };

export interface RunContextChecks {
  /** The project's results so far, by its normalized path. */
  forProject: (projectKey: string) => ProjectContexts;
  /** Re-checks the contracts `record` affects, or every contract when it is null. */
  check: (projectPath: string, record: DefinitionRef | null) => void;
  /** Runs a full check of the shown project again, as after a reload, rename or delete. */
  recheckAll: () => void;
}

/** The cross-record checks of the shown project, whose open definition is `openKind`/`openId`. */
export function useRunContexts(
  isOpen: boolean,
  projectPath: string | null,
  openKind: PraxisKind | undefined,
  openId: string | undefined
): RunContextChecks {
  const [byProject, setByProject] = useState<ReadonlyMap<string, ProjectContexts>>(new Map());
  const byProjectRef = useRef(byProject);
  useEffect(() => {
    byProjectRef.current = byProject;
  }, [byProject]);
  // Counts requests, so a result never replaces a newer one for the same contract.
  const seqRef = useRef(0);
  const [fullChecks, setFullChecks] = useState(0);

  /**
   * Asks for `record`'s contracts along with those the last results say it was in, so a
   * contract it has left, such as a trigger's previous contract, is checked again.
   */
  const check = useCallback((path: string, record: DefinitionRef | null) => {
    const key = normalizePath(path);
    const seq = ++seqRef.current;
    const known = byProjectRef.current.get(key)?.contexts ?? NO_CONTEXTS;
    const also = record ? contractsToRecheck(known, record) : [];
    const settle = (change: (cur: ProjectContexts) => ProjectContexts) =>
      setByProject((m) => new Map(m).set(key, change(m.get(key) ?? NO_PROJECT_CONTEXTS)));
    invoke<ContextCheck>("praxis_check_context", { projectPath: path, record, also }).then(
      (result) => settle((cur) => ({ contexts: mergeContexts(cur.contexts, result, { seq, full: record === null }), error: null })),
      (e) => settle((cur) => ({ ...cur, error: String(e) }))
    );
  }, []);

  useEffect(() => {
    if (isOpen && projectPath) check(projectPath, null);
  }, [isOpen, projectPath, fullChecks, check]);

  useEffect(() => {
    if (isOpen && projectPath && openKind && openId !== undefined) check(projectPath, { kind: openKind, id: openId });
  }, [isOpen, projectPath, openKind, openId, check]);

  const forProject = useCallback((key: string) => byProject.get(key) ?? NO_PROJECT_CONTEXTS, [byProject]);
  const recheckAll = useCallback(() => setFullChecks((n) => n + 1), []);
  return { forProject, check, recheckAll };
}
