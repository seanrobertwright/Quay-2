// Topos's git version gate (#369), as the overlay shows it. The backend's `git_version_check`
// runs `git --version` once per app run and returns one of these statuses.

/** `GitVersionStatus` from `src-tauri/src/slices/git/version.rs`. */
export type GitVersionStatus =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "tooOld"; found: string }
  | { status: "unknown"; raw: string };

/** `GitError` from `src-tauri/src/slices/git/error.rs`; later tickets add kinds. */
export type GitError = { kind: "other"; stderr: string };

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
