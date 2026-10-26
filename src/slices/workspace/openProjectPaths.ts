import { normalizePath } from "../../utils/paths.ts";

/** Windows paths ignore case, so two spellings of one folder are the same project. */
export function sameFolder(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/**
 * Pure path logic behind the Open Project dialog: splitting and joining Windows paths for the
 * breadcrumbs, Tab completion in the path bar, and the verdict chip beside it.
 */

/** `C:/a/b/` -> `C:\a\b\`: one slash style, the one Windows shows. */
export function toBackslashes(p: string): string {
  return p.replace(/\//g, "\\");
}

/**
 * A path's breadcrumb parts, root first: `C:\Users\me` -> `["C:", "Users", "me"]`, and a UNC
 * path keeps `\\server\share` together as its root.
 */
export function splitPath(p: string): string[] {
  const clean = toBackslashes(p.trim());
  if (clean.startsWith("\\\\")) {
    const [server, share, ...rest] = clean.slice(2).split("\\").filter(Boolean);
    if (!server) return [];
    const root = share ? `\\\\${server}\\${share}` : `\\\\${server}`;
    return [root, ...rest];
  }
  return clean.split("\\").filter(Boolean);
}

/** The inverse of `splitPath`. A drive on its own gets its root slash: `["C:"]` -> `C:\`. */
export function joinPath(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return /^[a-zA-Z]:$/.test(parts[0]) ? `${parts[0]}\\` : parts[0];
  return parts.join("\\");
}

/** `C:\a\b` -> `C:\a`; a root has no parent. */
export function parentPath(p: string): string | null {
  const parts = splitPath(p);
  return parts.length > 1 ? joinPath(parts.slice(0, -1)) : null;
}

/** The last part of a path: `C:\a\b` -> `b`, `C:\` -> `C:`. */
export function baseName(p: string): string {
  const parts = splitPath(p);
  return parts[parts.length - 1] ?? "";
}

/** Joins a child folder name onto a folder path. */
export function childPath(parent: string, name: string): string {
  return joinPath([...splitPath(parent), name]);
}

/**
 * What the path bar is completing: the folder to list (`null` while still typing a drive) and the
 * partial name typed after its last slash.
 */
export function completionTarget(input: string): { parent: string | null; leaf: string } {
  const clean = toBackslashes(input);
  const cut = clean.lastIndexOf("\\");
  if (cut < 0) return { parent: null, leaf: clean };
  return { parent: joinPath(splitPath(clean.slice(0, cut + 1))) || clean.slice(0, cut + 1), leaf: clean.slice(cut + 1) };
}

/** The names that start with `leaf`, ignoring case, in their given order. */
export function filterCompletions(names: string[], leaf: string): string[] {
  const needle = leaf.toLowerCase();
  return names.filter((n) => n.toLowerCase().startsWith(needle));
}

/** The longest start every name shares, ignoring case, spelled as in the first name. */
export function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i].toLowerCase() === name[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/**
 * What Tab turns the path bar into. `candidates` are the folder names under the typed parent (or
 * drive roots like `C:\` while no slash is typed yet); `picked` is a highlighted suggestion.
 * One match, or a picked one, completes to that folder with a trailing slash so the next Tab
 * lists inside it; several extend the input to the prefix they share; none leave it alone.
 */
export function applyCompletion(input: string, candidates: string[], picked?: string): string {
  const { parent, leaf } = completionTarget(input);
  const matches = picked ? [picked] : filterCompletions(candidates, leaf);
  const withParent = (name: string) => (parent === null ? name : childPath(parent, name));
  if (matches.length === 1) {
    const full = withParent(matches[0]);
    return full.endsWith("\\") ? full : `${full}\\`;
  }
  const shared = commonPrefix(matches);
  return shared.length > leaf.length ? withParent(shared) : input;
}

/** What the folder the path bar names looks like on disk, from `inspect_folder`. */
export interface FolderInfo {
  exists: boolean;
  is_git: boolean;
  branch: string | null;
}

export type Verdict =
  | { kind: "empty" }
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "added"; projectPath: string }
  | { kind: "git"; branch: string | null }
  | { kind: "plain" };

/**
 * The chip beside the path bar. `info` is null while the folder is still being looked up. A
 * project already in Quay wins over its git state, since Open switches to it rather than adding.
 */
export function verdictFor(input: string, info: FolderInfo | null, projects: { path: string }[]): Verdict {
  if (!input.trim()) return { kind: "empty" };
  if (!info) return { kind: "checking" };
  if (!info.exists) return { kind: "missing" };
  const added = projects.find((p) => sameFolder(p.path, input));
  if (added) return { kind: "added", projectPath: added.path };
  return info.is_git ? { kind: "git", branch: info.branch } : { kind: "plain" };
}

export function canOpen(v: Verdict): boolean {
  return v.kind === "added" || v.kind === "git" || v.kind === "plain";
}

/** The path to add for `input`: trimmed, without a trailing slash unless it is a drive root. */
export function cleanOpenPath(input: string): string {
  return joinPath(splitPath(input));
}

/**
 * Places worth pinning in the sidebar: the folders existing projects live in, once each, without
 * drive roots or the home folder (both already listed), sorted by path.
 */
export function pinnedRoots(projectPaths: string[], home: string | null): string[] {
  const seen = new Map<string, string>();
  for (const path of projectPaths) {
    const parent = parentPath(path);
    if (!parent || splitPath(parent).length < 2) continue;
    if (home && sameFolder(parent, home)) continue;
    const key = normalizePath(parent).toLowerCase();
    if (!seen.has(key)) seen.set(key, parent);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, path]) => path);
}
