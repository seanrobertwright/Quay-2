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
  | { kind: "handedOff"; path: string; agent: string };

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
      return { kind: fields.kind };
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
