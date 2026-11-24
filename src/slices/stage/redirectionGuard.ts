import { invoke } from "@tauri-apps/api/core";
import { showShellWarning } from "./shellWarnings.ts";

/** The shell-wide warning's id. */
export const REDIRECTION_GUARD_WARNING_ID = "redirection-guard";

// The banner is one line whose end is cut on a narrow stage, so the fix comes before the effect.
const MESSAGE =
  "Restart Quay from the Start menu, taskbar or Explorer: " +
  "terminals can't follow symlinks, so node_modules and commit hooks fail.";

/**
 * Shows the shell-wide warning when Quay started with RedirectionGuard enforced (#629) and the
 * operator has not dismissed it since Quay started. Only a `true` answer shows it: an ask that
 * fails shows nothing, as a check that failed does. Never rejects.
 */
export async function warnOfRedirectionGuard(): Promise<void> {
  try {
    if ((await invoke("get_redirection_guard_warning")) !== true) return;
  } catch (error) {
    console.warn("Could not ask whether RedirectionGuard is enforced:", error);
    return;
  }
  showShellWarning({ id: REDIRECTION_GUARD_WARNING_ID, message: MESSAGE, onDismiss: rememberDismissal });
}

/** Tells the backend, which outlives a reload of the window, that the operator dismissed it. */
function rememberDismissal(): void {
  invoke("dismiss_redirection_guard_warning").catch((error) =>
    console.warn("Could not remember that the RedirectionGuard warning was dismissed:", error),
  );
}
