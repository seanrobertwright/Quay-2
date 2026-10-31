// The graph's filters and agent highlights (#368, #401). A branch filter and the Remotes and Tags
// toggles change the ref set, so a change reopens the graph session; they never hide a walked row.
// An agent highlight only dims rows. Every active one shows as a removable chip.
//
// Branch names are untrusted text: they are only ever rendered as text, and the backend checks
// each before git sees it.

import type { HighlightKind } from "./agentHighlight.ts";
import type { Badge, RefBadge } from "./graphRefs.ts";

/** What changes the ref set: `RepoFilters` in `src-tauri/src/slices/git/settings.rs`. */
export interface GraphFilters {
  /** Full branch names such as `refs/heads/main`; empty for every branch. */
  branches: readonly string[];
  /** Whether remote-tracking branches are walked. */
  remotes: boolean;
  /** Whether tags are walked. */
  tags: boolean;
}

/** Every branch and remote, no tags: the graph's ref set before any filter (#370). */
export const NO_FILTERS: GraphFilters = { branches: [], remotes: true, tags: false };

/** The filters and the agent kinds highlighted, which the chips show together. */
export interface FilterState {
  filters: GraphFilters;
  /** The agent kinds highlighted, in the order they were picked; never stored (#369). */
  agents: readonly HighlightKind[];
}

/** No agent kind highlighted. */
export const NO_AGENTS: readonly HighlightKind[] = [];

/** What Reset filters leaves: no filter and no highlight. */
export const RESET: FilterState = { filters: NO_FILTERS, agents: NO_AGENTS };

/** `RefSet` in `src-tauri/src/slices/git/rev_set.rs`, as `git_graph_open` and `git_log_search` take it. */
export type RefSet =
  | { kind: "branches" }
  | { kind: "only"; refs: string[] }
  | { kind: "filtered"; branches: string[]; remotes: boolean; tags: boolean; worktreePath: string | null };

/** Every branch and remote and HEAD: the ref set with no filter (#370). */
export const DEFAULT_REF_SET: RefSet = { kind: "branches" };

const LOCAL = "refs/heads/";
const REMOTE = "refs/remotes/";

/** The full branch name of a local or remote branch badge, or null for a tag or a HEAD marker. */
export function branchRef(badge: Pick<Badge, "kind" | "name">): string | null {
  if (badge.kind === "local") return LOCAL + badge.name;
  if (badge.kind === "remote") return REMOTE + badge.name;
  return null;
}

/** Whether `ref` is a full remote-tracking branch name such as `refs/remotes/origin/main`. */
export function isRemoteRef(ref: string): boolean {
  return ref.startsWith(REMOTE);
}

/** A full branch name as a badge shows it: `main`, or `origin/main` for a remote branch. */
export function branchLabel(ref: string): string {
  if (ref.startsWith(LOCAL)) return ref.slice(LOCAL.length);
  if (ref.startsWith(REMOTE)) return ref.slice(REMOTE.length);
  return ref;
}

/** Whether `filters` change the ref set from the default. */
export function isFiltered(filters: GraphFilters): boolean {
  return filters.branches.length > 0 || filters.remotes !== NO_FILTERS.remotes || filters.tags !== NO_FILTERS.tags;
}

/** "Show only…": the branch filter becomes `ref` alone. */
export function showOnly(filters: GraphFilters, ref: string): GraphFilters {
  return { ...filters, branches: [ref] };
}

/** Adds `ref` to the branch filter, or takes it out when it is in. */
export function toggleBranch(filters: GraphFilters, ref: string): GraphFilters {
  const branches = filters.branches.includes(ref) ? filters.branches.filter((b) => b !== ref) : [...filters.branches, ref];
  return { ...filters, branches };
}

/** Highlights `kind`, or stops highlighting it when it is highlighted. */
export function toggleAgent(agents: readonly HighlightKind[], kind: HighlightKind): HighlightKind[] {
  return agents.includes(kind) ? agents.filter((k) => k !== kind) : [...agents, kind];
}

/** How a highlighted kind reads in a chip and its button's name. */
function agentNoun(kind: HighlightKind): string {
  return kind === "unknown" ? "unknown agent" : kind;
}

/** One active filter or highlight as a toolbar chip. */
export interface FilterChip {
  /** Unique among the chips, for a React key. */
  key: string;
  /** The chip's text; a branch name is untrusted and only ever rendered as text. */
  label: string;
  /** The remove button's accessible name. */
  name: string;
  /** The state with this one filter or highlight removed. */
  remove: (state: FilterState) => FilterState;
}

/** The chips for every active filter and highlight: branches, then the toggles, then agent kinds. */
export function filterChips({ filters, agents }: FilterState): FilterChip[] {
  const chips: FilterChip[] = filters.branches.map((ref) => ({
    key: `branch:${ref}`,
    label: branchLabel(ref),
    name: `Remove branch filter ${branchLabel(ref)}`,
    remove: (s) => ({ ...s, filters: { ...s.filters, branches: s.filters.branches.filter((b) => b !== ref) } }),
  }));
  if (filters.remotes !== NO_FILTERS.remotes) {
    chips.push({
      key: "remotes",
      label: "Remotes hidden",
      name: "Show remotes again",
      remove: (s) => ({ ...s, filters: { ...s.filters, remotes: NO_FILTERS.remotes } }),
    });
  }
  if (filters.tags !== NO_FILTERS.tags) {
    chips.push({
      key: "tags",
      label: "Tags shown",
      name: "Hide tags again",
      remove: (s) => ({ ...s, filters: { ...s.filters, tags: NO_FILTERS.tags } }),
    });
  }
  for (const kind of agents) {
    chips.push({
      key: `agent:${kind}`,
      label: `Highlight ${agentNoun(kind)}`,
      name: `Stop highlighting ${agentNoun(kind)} commits`,
      remove: (s) => ({ ...s, agents: s.agents.filter((k) => k !== kind) }),
    });
  }
  return chips;
}

/**
 * The ref set the graph walks for `filters`. With none it is the default set, so moving between
 * worktrees keeps the session; with any it names the selected worktree, whose HEAD is always walked.
 */
export function graphRefSet(filters: GraphFilters, worktreePath: string | null): RefSet {
  if (!isFiltered(filters)) return DEFAULT_REF_SET;
  return { kind: "filtered", branches: [...filters.branches], remotes: filters.remotes, tags: filters.tags, worktreePath };
}

/**
 * `filters` without the branches `refs` no longer lists (#369), or `filters` itself when every
 * filtered branch is still there.
 */
export function pruneFilters(filters: GraphFilters, refs: readonly RefBadge[]): GraphFilters {
  if (filters.branches.length === 0) return filters;
  const existing = new Set<string>();
  for (const r of refs) {
    const ref = branchRef(r);
    if (ref !== null) existing.add(ref);
  }
  const branches = filters.branches.filter((b) => existing.has(b));
  return branches.length === filters.branches.length ? filters : { ...filters, branches };
}
