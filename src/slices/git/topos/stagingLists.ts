// The staging inspector's lists (#366, #382): which changes are unstaged and which staged, and
// the rows each list shows, flat or as a tree.

/** `EntryKind` from `src-tauri/src/slices/git/staging.rs`. */
export type EntryKind = "tracked" | "untracked" | "untrackedFolder" | "unmerged";

/** `StatusEntry` from `src-tauri/src/slices/git/staging.rs`. */
export interface StatusEntry {
  /** Relative to the worktree root, with `/` separators. */
  path: string;
  /** git's index letter then worktree letter, `.` for unchanged, `??` for untracked. */
  xy: string;
  kind: EntryKind;
}

/** `STATUS_CAP` from `src-tauri/src/slices/git/staging.rs`: the most entries one status read returns. */
export const STATUS_CAP = 10_000;

/** `WorktreeStatus` from `src-tauri/src/slices/git/staging.rs`. */
export interface WorktreeStatus {
  requestId: number;
  /** At most `STATUS_CAP` entries. */
  entries: StatusEntry[];
  /** Every change, including those past the cap. */
  total: number;
  truncated: boolean;
}

/** `PathTarget` from `src-tauri/src/slices/git/staging.rs`. */
export type PathTarget = { kind: "all" } | { kind: "paths"; paths: string[] };

export type Side = "unstaged" | "staged";

/** The list opposite `side`. */
export function otherSide(side: Side): Side {
  return side === "unstaged" ? "staged" : "unstaged";
}

/** One change in one list. */
export interface Change {
  path: string;
  /** The letter this side shows: M, A, D, T, R, C, U or ? for untracked. */
  letter: string;
  kind: EntryKind;
}

/** The Unstaged and Staged lists of a status, each in git's order. */
export function splitStatus(entries: readonly StatusEntry[]): Record<Side, Change[]> {
  const unstaged: Change[] = [];
  const staged: Change[] = [];
  for (const e of entries) {
    if (e.kind !== "tracked") {
      unstaged.push({ path: e.path, letter: e.kind === "unmerged" ? "U" : "?", kind: e.kind });
      continue;
    }
    const [x = ".", y = "."] = e.xy;
    if (x !== ".") staged.push({ path: e.path, letter: x, kind: e.kind });
    if (y !== ".") unstaged.push({ path: e.path, letter: y, kind: e.kind });
  }
  return { unstaged, staged };
}

/** The files of an untracked folder the operator expanded, read with a capped `status -uall`. */
export type FolderListing =
  | { state: "loading" }
  | { state: "done"; changes: Change[]; truncated: boolean }
  | { state: "failed"; message: string };

export type ListMode = "flat" | "tree";

export interface RowOptions {
  mode: ListMode;
  /** The tree folders the operator collapsed, by path. */
  collapsed: ReadonlySet<string>;
  /** The untracked folders the operator expanded, by path. */
  folders: ReadonlyMap<string, FolderListing>;
}

/** One row of a list: a change, a tree folder over changes, or a note under an expanded folder. */
export interface ListRow {
  /** Unique in its list and built from the path, so it survives the list changing. */
  key: string;
  type: "change" | "dir" | "note";
  /** The path a stage or unstage of this row acts on; for a note, its folder's. */
  path: string;
  /** What the row reads: the full path when flat, the last part of it in a tree. */
  name: string;
  depth: number;
  /** For a change row. */
  change?: Change;
  /** For a tree folder or an untracked folder: whether its contents show. */
  expanded?: boolean;
}

/** Whether `row` stands for a folder, a tree folder or an untracked one, so its name ends in `/`. */
export function isFolderRow(row: ListRow): boolean {
  return row.type === "dir" || row.change?.kind === "untrackedFolder";
}

interface TreeDir {
  path: string;
  /** Child folders and changes, in the order they first appear. */
  children: (TreeDir | Change)[];
  dirs: Map<string, TreeDir>;
}

function isDir(node: TreeDir | Change): node is TreeDir {
  return "children" in node;
}

function lastPart(path: string, parent: string): string {
  return parent === "" ? path : path.slice(parent.length + 1);
}

/** The rows of an untracked folder's change row and, when expanded, of what it holds. */
function pushChange(rows: ListRow[], c: Change, name: string, depth: number, opts: RowOptions): void {
  if (c.kind !== "untrackedFolder") {
    rows.push({ key: `c:${c.path}`, type: "change", path: c.path, name, depth, change: c });
    return;
  }
  const listing = opts.folders.get(c.path);
  rows.push({ key: `c:${c.path}`, type: "change", path: c.path, name, depth, change: c, expanded: listing !== undefined });
  if (listing === undefined) return;
  const note = (text: string) => rows.push({ key: `n:${c.path}`, type: "note", path: c.path, name: text, depth: depth + 1 });
  switch (listing.state) {
    case "loading":
      note("Loading…");
      return;
    case "failed":
      note(listing.message);
      return;
    case "done":
      for (const f of listing.changes) {
        const child = opts.mode === "flat" ? f.path : lastPart(f.path, c.path);
        rows.push({ key: `c:${f.path}`, type: "change", path: f.path, name: child, depth: depth + 1, change: f });
      }
      if (listing.truncated) note(`Showing the first ${STATUS_CAP.toLocaleString("en-US")} files`);
  }
}

/**
 * The rows a list shows for `changes`. Flat, each change is one row by its full path. As a tree,
 * changes nest under a row for each folder on their path, in the order they first appear, and a
 * collapsed folder hides what is under it. Either way an expanded untracked folder lists its files
 * beneath it.
 */
export function listRows(changes: readonly Change[], opts: RowOptions): ListRow[] {
  const rows: ListRow[] = [];
  if (opts.mode === "flat") {
    for (const c of changes) pushChange(rows, c, c.path, 0, opts);
    return rows;
  }
  const root: TreeDir = { path: "", children: [], dirs: new Map() };
  for (const c of changes) {
    const parts = c.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (next === undefined) {
        next = { path: dir.path === "" ? part : `${dir.path}/${part}`, children: [], dirs: new Map() };
        dir.dirs.set(part, next);
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push(c);
  }
  const walk = (dir: TreeDir, depth: number) => {
    for (const node of dir.children) {
      if (isDir(node)) {
        const expanded = !opts.collapsed.has(node.path);
        rows.push({ key: `d:${node.path}`, type: "dir", path: node.path, name: lastPart(node.path, dir.path), depth, expanded });
        if (expanded) walk(node, depth + 1);
      } else {
        pushChange(rows, node, lastPart(node.path, dir.path), depth, opts);
      }
    }
  };
  walk(root, 0);
  return rows;
}
