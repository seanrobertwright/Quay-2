/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { removeWorktreeSafely } from "./worktreeRemoval.ts";

const REFUSAL =
  "fatal: 'E:/repo/.worktrees/feat' contains modified or untracked files, use --force to delete it\n\n?? notes.txt";

/** Records every step the removal takes, in order. */
function recordingSteps(checkResult: () => Promise<string | null>) {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      checkClean: async () => {
        calls.push("check");
        return checkResult();
      },
      closeTerminals: async () => {
        calls.push("close terminals");
      },
      remove: async (force: boolean) => {
        calls.push(force ? "remove --force" : "remove");
      },
    },
  };
}

test("a dirty worktree is refused before any terminal is closed", async () => {
  const { calls, steps } = recordingSteps(async () => REFUSAL);

  const result = await removeWorktreeSafely(steps, false);

  assert.deepEqual(result, { status: "blocked", message: REFUSAL });
  assert.deepEqual(calls, ["check"]);
});

test("a clean worktree closes its terminals, then removes without force", async () => {
  const { calls, steps } = recordingSteps(async () => null);

  const result = await removeWorktreeSafely(steps, false);

  assert.deepEqual(result, { status: "removed" });
  assert.deepEqual(calls, ["check", "close terminals", "remove"]);
});

test("remove anyway skips the check and removes with force", async () => {
  const { calls, steps } = recordingSteps(async () => REFUSAL);

  const result = await removeWorktreeSafely(steps, true);

  assert.deepEqual(result, { status: "removed" });
  assert.deepEqual(calls, ["close terminals", "remove --force"]);
});

test("a check that fails blocks with its error and closes nothing", async () => {
  const { calls, steps } = recordingSteps(async () => {
    throw "Git status failed in 'E:/gone': fatal: cannot change to 'E:/gone'";
  });

  const result = await removeWorktreeSafely(steps, false);

  assert.deepEqual(result, {
    status: "blocked",
    message: "Git status failed in 'E:/gone': fatal: cannot change to 'E:/gone'",
  });
  assert.deepEqual(calls, ["check"]);
});
