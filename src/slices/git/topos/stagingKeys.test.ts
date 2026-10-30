/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capNote,
  clampInspectorWidth,
  DEFAULT_INSPECTOR_WIDTH,
  doneMessage,
  failureView,
  inspectorWidthByKey,
  listKeyAction,
  wipLabel,
} from "./stagingKeys.ts";

const plain = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };

test("the lists answer ↑/↓, Enter, s and u, and leave Tab to move focus", () => {
  const actions = ["ArrowUp", "ArrowDown", "Enter", "s", "u", "S", "Tab", "x"].map((key) =>
    listKeyAction({ key, ...plain }, false)
  );
  assert.deepEqual(actions, ["up", "down", "open", "stage", "unstage", "stage", null, null]);
});

test("bare keys never act in a text field, and no chord with Ctrl, Alt or Meta is taken", () => {
  assert.equal(listKeyAction({ key: "s", ...plain }, true), null);
  assert.equal(listKeyAction({ key: "ArrowDown", ...plain }, true), null);
  for (const mod of ["ctrlKey", "altKey", "metaKey"] as const) {
    for (const key of ["b", "k", "s", "u", "1", "ArrowDown", "Enter"]) {
      assert.equal(listKeyAction({ key, ...plain, [mod]: true }, false), null, `${mod}+${key}`);
    }
  }
});

test("the WIP row counts every change, and the cap note shows only past the cap", () => {
  assert.equal(wipLabel(1), "1 changed");
  assert.equal(wipLabel(10_005), "10,005 changed");
  assert.equal(capNote({ total: 12, truncated: false }), null);
  assert.equal(capNote({ total: 10_005, truncated: true }), "Showing the first 10,000 changes");
});

test("each finished action has a sentence for the live region", () => {
  assert.equal(doneMessage("stage", { kind: "paths", paths: ["README.md"] }), "Staged README.md");
  assert.equal(doneMessage("unstage", { kind: "paths", paths: ["a", "b", "c"] }), "Unstaged 3 paths");
  assert.equal(doneMessage("stage", { kind: "all" }), "Staged all changes");
  assert.equal(doneMessage("unstage", { kind: "all" }), "Unstaged all changes");
  assert.equal(doneMessage("ignore", { kind: "paths", paths: ["notes"] }), "Added notes/ to .gitignore");
});

test("a held index.lock offers Retry, and other failures say what git said", () => {
  assert.deepEqual(failureView({ kind: "indexLocked" }), {
    message: "Another git process is holding index.lock. Quay never deletes it; retry once that process is done.",
    retry: true,
    stale: false,
  });
  assert.deepEqual(failureView({ kind: "stagingBusy" }), {
    message: "Another staging operation is still running on this worktree.",
    retry: false,
    stale: false,
  });
  assert.deepEqual(failureView({ kind: "other", stderr: "fatal: bad" }), { message: "fatal: bad", retry: false, stale: false });
  assert.deepEqual(failureView("plain"), { message: "plain", retry: false, stale: false });
});

test("a stale diff says the file changed, offers no Retry and asks for the diff to reload", () => {
  assert.deepEqual(failureView({ kind: "staleDiff" }), {
    message: "The file changed since its diff was read, so nothing was staged or unstaged. The diff was reloaded.",
    retry: false,
    stale: true,
  });
});

test("a failure reads only its own kind and stderr, never inherited ones", () => {
  const inherited = Object.create({ kind: "indexLocked", stderr: "from the prototype" }) as object;
  assert.deepEqual(failureView(inherited), { message: "[object Object]", retry: false, stale: false });
});

test("the inspector opens 400 px wide and its handle resizes it within bounds", () => {
  assert.equal(DEFAULT_INSPECTOR_WIDTH, 400);
  assert.equal(clampInspectorWidth(100), 280);
  assert.equal(clampInspectorWidth(5000), 720);
  assert.equal(clampInspectorWidth(Number.NaN), 400);
  // The handle sits on the inspector's left edge: dragging or pressing left widens it.
  assert.equal(inspectorWidthByKey(400, "ArrowLeft", false), 416);
  assert.equal(inspectorWidthByKey(400, "ArrowRight", true), 336);
  assert.equal(inspectorWidthByKey(400, "Home", false), 280);
  assert.equal(inspectorWidthByKey(400, "End", false), 720);
  assert.equal(inspectorWidthByKey(400, "s", false), null);
});
