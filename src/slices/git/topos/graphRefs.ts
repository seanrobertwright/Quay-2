// Ref badges and worktree HEAD markers (#378): what `git_refs` returns, arranged per commit.

import { isSamePath } from "../../../utils/paths.ts";
import type { RefsState } from "./useGraphRefs.ts";

export type RefKind = "local" | "remote" | "tag";

/** A branch, remote-tracking branch or tag at the commit it names. */
export interface RefBadge {
  kind: RefKind;
  /** `main`, `origin/main` or `v1.0`. */
  name: string;
  oid: string;
}

/** Where one worktree's HEAD is. */
export interface WorktreeHead {
  path: string;
  oid: string;
  /** The branch checked out there, or null for a detached HEAD. */
  branch: string | null;
}

/** What `git_refs(repoPath)` returns. */
export interface GitRefs {
  refs: RefBadge[];
  worktrees: WorktreeHead[];
  /** Commits only a tag reaches, which the graph leaves out unless the Tags toggle is on (#370, #401). */
  tagOnlyCount: number;
}

/** A badge as a row shows it: a worktree's HEAD, named by its folder, or a ref. */
export type Badge =
  | { kind: "head"; name: string; path: string; current: boolean }
  | { kind: RefKind; name: string };

const KIND_ORDER: Record<RefKind, number> = { local: 0, remote: 1, tag: 2 };

/** The last segment of a folder path, the name a worktree goes by. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

/**
 * The badges on each commit, keyed by oid. A commit's badges are the worktree HEADs there (the
 * one at `selectedPath` first and marked current), then local branches, remote branches and tags,
 * each in name order.
 */
export function badgesByOid(refs: GitRefs, selectedPath: string | null): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  const add = (oid: string, badge: Badge) => {
    const list = out.get(oid);
    if (list) list.push(badge);
    else out.set(oid, [badge]);
  };
  const heads = refs.worktrees
    .map((w) => ({ oid: w.oid, name: folderName(w.path), path: w.path, current: isSamePath(w.path, selectedPath) }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  for (const h of heads) add(h.oid, { kind: "head", name: h.name, path: h.path, current: h.current });
  const sorted = [...refs.refs].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)
  );
  for (const r of sorted) add(r.oid, { kind: r.kind, name: r.name });
  return out;
}

/** The footer line for commits only a tag reaches, or null when there are none. */
export function tagOnlyLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 tagged commit is on no branch" : `${count.toLocaleString()} tagged commits are on no branch`;
}

/** What the graph list shows from a refs read: row badges by oid and the footer's ref lines. */
export interface RefsView {
  badges: ReadonlyMap<string, Badge[]>;
  /** The footer's count of commits only a tag reaches, or null for none. */
  tagOnlyNote: string | null;
  /** Why the refs couldn't be read, or null. */
  error: string | null;
}

/** No badges and no footer lines: refs not read yet, or a graph with none to show. */
export const NO_REFS: RefsView = { badges: new Map(), tagOnlyNote: null, error: null };

/** The view of a refs read, with the HEAD at `selectedPath` marked current. */
export function refsView(refs: RefsState, selectedPath: string | null): RefsView {
  switch (refs.state) {
    case "idle":
      return NO_REFS;
    case "done":
      return { badges: badgesByOid(refs.refs, selectedPath), tagOnlyNote: tagOnlyLine(refs.refs.tagOnlyCount), error: null };
    case "failed":
      return { ...NO_REFS, error: `Couldn't read branches and tags: ${refs.message}` };
  }
}
