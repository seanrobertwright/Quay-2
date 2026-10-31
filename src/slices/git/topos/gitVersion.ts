// Topos's git version gate (#369), as the overlay shows it. The backend's `git_version_check`
// runs `git --version` once per app run and returns one of these statuses.

/** `GitVersionStatus` from `src-tauri/src/slices/git/version.rs`. */
export type GitVersionStatus =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "tooOld"; found: string }
  | { status: "unknown"; raw: string };

/** `GitError` from `src-tauri/src/slices/git/error.rs`. */
export type GitError =
  | { kind: "other"; stderr: string }
  | { kind: "cancelled" }
  | { kind: "indexLocked" }
  | { kind: "stagingBusy" }
  | { kind: "staleDiff" }
  | { kind: "conflictStale" }
  | { kind: "changedSinceDiscard"; paths: string[] }
  | { kind: "hookFailed"; hook: string; output: string }
  | { kind: "noOperation" }
  | { kind: "conflictsRemain"; count: number }
  /** The file is handed to an agent (#392); `agent` is untrusted display text. */
  | { kind: "handedOff"; path: string; agent: string }
  /** Ref operations (#393). Paths, worktrees and names are untrusted display text. */
  | { kind: "checkoutWouldOverwrite"; paths: string[] }
  | { kind: "branchInOtherWorktree"; worktree: string }
  | { kind: "invalidRefName"; name: string }
  /** Branch and tag writes (#394). */
  | { kind: "notFullyMerged"; ahead: number; tip: string }
  | { kind: "refExists"; name: string }
  | { kind: "refLocked" }
  /** Fetch, pull and push (#395). Refs, reasons and remote lines are untrusted display text. */
  | { kind: "nonFastForward"; ref: string }
  | { kind: "noUpstream"; branch: string; remotes: string[] }
  | { kind: "remoteRejected"; ref: string; reason: string; remoteLines: string[] }
  | { kind: "authFailed" }
  | { kind: "hostKeyUnknown" }
  | { kind: "network" }
  | { kind: "divergentPullNeedsStrategy" };

/** `e`, a rejected git command, as a `GitError`, or null when it isn't one of the known kinds. */
export function parseGitError(e: unknown): GitError | null {
  if (typeof e !== "object" || e === null || !Object.prototype.hasOwnProperty.call(e, "kind")) return null;
  const fields = e as Record<string, unknown>;
  switch (fields.kind) {
    case "cancelled":
    case "indexLocked":
    case "stagingBusy":
    case "staleDiff":
    case "conflictStale":
    case "noOperation":
    case "refLocked":
    case "authFailed":
    case "hostKeyUnknown":
    case "network":
    case "divergentPullNeedsStrategy":
      return { kind: fields.kind };
    case "nonFastForward":
      return { kind: "nonFastForward", ref: String(fields.ref) };
    case "noUpstream":
      return Array.isArray(fields.remotes)
        ? { kind: "noUpstream", branch: String(fields.branch), remotes: fields.remotes.map(String) }
        : null;
    case "remoteRejected":
      return {
        kind: "remoteRejected",
        ref: String(fields.ref),
        reason: String(fields.reason),
        remoteLines: Array.isArray(fields.remoteLines) ? fields.remoteLines.map(String) : [],
      };
    case "conflictsRemain":
      return Number.isSafeInteger(fields.count) && (fields.count as number) >= 0
        ? { kind: "conflictsRemain", count: fields.count as number }
        : null;
    case "other":
      return { kind: "other", stderr: String(fields.stderr) };
    case "changedSinceDiscard":
      return { kind: "changedSinceDiscard", paths: Array.isArray(fields.paths) ? fields.paths.map(String) : [] };
    case "hookFailed":
      return { kind: "hookFailed", hook: String(fields.hook), output: String(fields.output) };
    case "handedOff":
      return { kind: "handedOff", path: String(fields.path), agent: String(fields.agent) };
    case "checkoutWouldOverwrite":
      return { kind: "checkoutWouldOverwrite", paths: Array.isArray(fields.paths) ? fields.paths.map(String) : [] };
    case "branchInOtherWorktree":
      return { kind: "branchInOtherWorktree", worktree: String(fields.worktree) };
    case "invalidRefName":
      return { kind: "invalidRefName", name: String(fields.name) };
    case "refExists":
      return { kind: "refExists", name: String(fields.name) };
    case "notFullyMerged":
      return Number.isSafeInteger(fields.ahead) && (fields.ahead as number) >= 0
        ? { kind: "notFullyMerged", ahead: fields.ahead as number, tip: String(fields.tip) }
        : null;
    default:
      return null;
  }
}

/** The text to show for a rejected git command: a `GitError`'s stderr, or whatever was thrown. */
export function errorMessage(e: unknown): string {
  const error = parseGitError(e);
  if (error?.kind === "handedOff") return `${error.path} is with ${error.agent}, so Topos changed nothing. Take it back to change it here.`;
  if (typeof e === "object" && e !== null && Object.prototype.hasOwnProperty.call(e, "stderr")) return String((e as { stderr: unknown }).stderr);
  return String(e);
}

/** The floor the backend's `MIN_GIT_VERSION` enforces, for messages. */
export const MIN_GIT_VERSION = "2.36";

export const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";

/** What the overlay shows for a status: Topos itself, perhaps with a warning, or a blocking message. */
export type GateView =
  | { kind: "open"; warning?: string }
  | { kind: "blocked"; title: string; detail: string };

export function gateView(status: GitVersionStatus): GateView {
  switch (status.status) {
    case "ok":
      return { kind: "open" };
    case "missing":
      return { kind: "blocked", title: "Git not found on PATH", detail: "Install git, then press Retry." };
    case "tooOld":
      return {
        kind: "blocked",
        title: `Topos needs git ${MIN_GIT_VERSION} or newer. Found ${status.found}.`,
        detail: "Update git, then press Retry.",
      };
    case "unknown":
      return {
        kind: "open",
        warning: `Couldn't read git's version (${status.raw}). Topos is carrying on, but some features may fail.`,
      };
  }
}
