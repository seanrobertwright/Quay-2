// Unit tests for the shell-wide warning stack (#635): add, dismiss, order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addWarning, dismissWarning, type ShellWarning } from "./shellWarnings.ts";

const redirection: ShellWarning = { id: "redirection-guard", message: "Terminals cannot follow symlinks." };
const disk: ShellWarning = { id: "disk", message: "The disk is almost full." };

test("a warning added to an empty stack is the only one shown", () => {
  assert.deepEqual(addWarning([], redirection), [redirection]);
});

test("several warnings stack newest on top", () => {
  const stack = addWarning(addWarning([], redirection), disk);
  assert.deepEqual(stack.map((w) => w.id), ["disk", "redirection-guard"]);
});

test("adding a warning again replaces it and moves it to the top, so it never shows twice", () => {
  const reworded = { id: "redirection-guard", message: "Restart Quay from the Start menu." };
  const stack = addWarning(addWarning(addWarning([], redirection), disk), reworded);
  assert.deepEqual(stack, [reworded, disk]);
});

test("dismissing a warning removes only that one", () => {
  const stack = addWarning(addWarning([], redirection), disk);
  assert.deepEqual(dismissWarning(stack, "redirection-guard"), [disk]);
});

test("dismissing a warning that is not shown leaves the stack as it was", () => {
  const stack = [redirection];
  assert.deepEqual(dismissWarning(stack, "disk"), [redirection]);
});
