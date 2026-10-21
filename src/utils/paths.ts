/**
 * Normalizes a file or directory path for cross-platform and cross-tool consistency.
 * - Converts all backslashes and forward slashes to uniform `/`.
 * - Normalizes Windows drive letter to lowercase (e.g. `e:/...` vs `E:/...`).
 * - Strips any trailing slashes.
 */
export function normalizePath(p?: string | null): string {
  if (!p) return "";
  let clean = p.trim().replace(/\\/g, "/");
  // Normalize Windows drive letter: E:/ -> e:/
  if (/^[a-zA-Z]:\//.test(clean)) {
    clean = clean.charAt(0).toLowerCase() + clean.slice(1);
  }
  return clean.replace(/\/+$/, "");
}

/**
 * Returns true if two paths refer to the same directory or file,
 * ignoring slash direction, drive letter casing, and trailing slashes.
 */
export function isSamePath(a?: string | null, b?: string | null): boolean {
  return normalizePath(a) === normalizePath(b);
}

/**
 * Returns true if child is equal to parent or is a descendant folder of parent.
 */
export function isSubpathOf(child?: string | null, parent?: string | null): boolean {
  const normChild = normalizePath(child);
  const normParent = normalizePath(parent);
  if (!normChild || !normParent) return false;
  return normChild === normParent || normChild.startsWith(normParent + "/");
}

/**
 * Resolves the project a path belongs to: the first project the path is or sits
 * inside, else the first project whose git worktree list (keyed by project path)
 * contains the path. Returns the path itself when it belongs to no project.
 */
export function resolveRootRepo(
  activePath: string,
  projects: { path: string }[],
  worktreesByProject: Record<string, { path: string }[]> = {}
): string {
  const worktreesOf = (projectPath: string) =>
    Object.prototype.hasOwnProperty.call(worktreesByProject, projectPath)
      ? worktreesByProject[projectPath]
      : [];
  const matched =
    projects.find((p) => isSubpathOf(activePath, p.path)) ||
    projects.find((p) => worktreesOf(p.path).some((wt) => isSamePath(wt.path, activePath)));
  return matched ? matched.path : activePath;
}
