export type WorktreeRemovalResult = { status: "removed" } | { status: "blocked"; message: string };

export interface WorktreeRemovalSteps {
  /** Git's refusal when the worktree has uncommitted changes, or null when clean. */
  checkClean: () => Promise<string | null>;
  closeTerminals: () => Promise<void>;
  remove: (force: boolean) => Promise<void>;
}

/**
 * Removes a worktree without closing a terminal it cannot remove. Unless forced,
 * it checks for uncommitted changes first; git's refusal, or the check's own error,
 * comes back as "blocked" and nothing is closed. Errors from closing terminals or
 * from the removal itself are thrown.
 */
export async function removeWorktreeSafely(
  steps: WorktreeRemovalSteps,
  force: boolean
): Promise<WorktreeRemovalResult> {
  if (!force) {
    let refusal: string | null;
    try {
      refusal = await steps.checkClean();
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    }
    if (refusal) return { status: "blocked", message: refusal };
  }
  await steps.closeTerminals();
  await steps.remove(force);
  return { status: "removed" };
}
