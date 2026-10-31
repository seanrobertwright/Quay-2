import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NO_FILTERS, pruneFilters, type FilterState, type GraphFilters } from "./graphFilters";
import type { ToposSettings } from "./toposSettings";
import type { RefsState } from "./useGraphRefs";

export interface GraphFiltersHandle {
  /** The repo's filters and highlights, or null while its stored filters are still being read. */
  state: FilterState | null;
  /** Sets the filters and highlights; a change of filters reaches the repo's topos.json entry. */
  set: (next: FilterState) => void;
}

function sameFilters(a: GraphFilters, b: GraphFilters): boolean {
  return (
    a.remotes === b.remotes &&
    a.tags === b.tags &&
    a.branches.length === b.branches.length &&
    a.branches.every((ref, i) => ref === b.branches[i])
  );
}

function store(repoPath: string, filters: GraphFilters): void {
  const repoFilters = { repoPath, branches: [...filters.branches], remotes: filters.remotes, tags: filters.tags };
  invoke<ToposSettings>("topos_settings_write", { patch: { repoFilters } }).catch(console.error);
}

/**
 * The branch filter, the Remotes and Tags toggles and the agent highlights of `repoPath`'s graph
 * (#401). The filters are read from the repo's topos.json entry, pruned of branches that are gone,
 * when the repo opens, and written back on each change. A filtered branch that `refs` stops listing
 * is pruned too. Highlights live only here and are never stored (#369).
 */
export function useGraphFilters(repoPath: string | null, refs: RefsState): GraphFiltersHandle {
  const [loaded, setLoaded] = useState<{ repoPath: string; state: FilterState } | null>(null);
  // Only the newest repo's read may set the filters.
  const reading = useRef(0);

  useEffect(() => {
    const id = ++reading.current;
    if (repoPath === null) return;
    const settle = (filters: GraphFilters) => {
      if (id === reading.current) setLoaded({ repoPath, state: { filters, agents: [] } });
    };
    invoke<GraphFilters>("topos_repo_filters", { repoPath }).then(settle, (e: unknown) => {
      // A store that can't be read opens the whole graph rather than none of it.
      console.error(e);
      settle(NO_FILTERS);
    });
  }, [repoPath]);

  // Filters read for another repo are never handed out.
  const state = loaded !== null && loaded.repoPath === repoPath ? loaded.state : null;

  const current = useRef(state);
  current.current = state;
  const set = useCallback(
    (next: FilterState) => {
      const prev = current.current;
      // Nothing is set before the stored filters arrive, so they can't overwrite a change.
      if (repoPath === null || prev === null) return;
      if (!sameFilters(prev.filters, next.filters)) store(repoPath, next.filters);
      current.current = next;
      setLoaded({ repoPath, state: next });
    },
    [repoPath]
  );

  const knownRefs = refs.state === "done" && refs.repoPath === repoPath ? refs.refs.refs : null;
  useEffect(() => {
    if (state === null || knownRefs === null) return;
    const pruned = pruneFilters(state.filters, knownRefs);
    if (pruned !== state.filters) set({ ...state, filters: pruned });
  }, [state, knownRefs, set]);

  return { state, set };
}
