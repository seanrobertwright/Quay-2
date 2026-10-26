/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGraphDraft,
  isDirty,
  layoutForSave,
  markDeletedOnDisk,
  markSaved,
  moveNodes,
  reconcileWithDisk,
  type GraphDraft,
} from "./drafts.ts";
import type { JsonObject } from "./model.ts";
import type { DefinitionFile } from "./types.ts";

const ref = { kind: "graphs" as const, id: "ship" };

const content: JsonObject = {
  id: "ship",
  revision: "sha256:aaaa",
  nodes: [
    { id: "task-1", kind: "TASK", dependsOn: [], config: { executionKind: "agent" } },
    { id: "end-1", kind: "END", dependsOn: ["task-1"], config: {} },
  ],
};

function file(overrides: Partial<DefinitionFile> = {}): DefinitionFile {
  return {
    id: "ship",
    kind: "graphs",
    missing: false,
    contentHash: "hash-1",
    content,
    layout: { version: 1, nodes: { "task-1": { x: 10, y: 20 }, "end-1": { x: 10, y: 200 } } },
    ...overrides,
  };
}

function draft(f: DefinitionFile = file()): GraphDraft {
  const result = createGraphDraft(ref, f);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

test("a new draft takes the saved positions, the file's hash, and is clean", () => {
  const d = draft();
  assert.deepEqual([...d.positions], [
    ["task-1", { x: 10, y: 20 }],
    ["end-1", { x: 10, y: 200 }],
  ]);
  assert.equal(d.baseHash, "hash-1");
  assert.equal(isDirty(d), false);
  assert.equal(d.deletedOnDisk, false);
});

test("nodes without a saved position are placed, rounded, and the draft is still clean", () => {
  const d = draft(file({ layout: undefined }));
  assert.equal(d.positions.size, 2);
  for (const p of d.positions.values()) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), JSON.stringify(p));
  }
  assert.equal(isDirty(d), false);
});

test("a graph the canvas can't draw makes no draft", () => {
  const result = createGraphDraft(ref, file({ content: { id: "ship" } }));
  assert.equal(result.ok, false);
});

test("moving a node makes the draft dirty, and moving it back makes it clean", () => {
  const d = draft();
  const moved = moveNodes(d, [["task-1", { x: 50.4, y: 20 }]]);
  assert.deepEqual(moved.positions.get("task-1"), { x: 50, y: 20 });
  assert.equal(isDirty(moved), true);
  const back = moveNodes(moved, [["task-1", { x: 10.2, y: 19.8 }]]);
  assert.equal(isDirty(back), false);
});

test("a move to the same integer position, or of an unknown node, changes nothing", () => {
  const d = draft();
  assert.equal(moveNodes(d, [["task-1", { x: 10.3, y: 20.1 }]]), d);
  assert.equal(moveNodes(d, [["ghost", { x: 1, y: 1 }]]), d);
});

test("moving keeps the node order of the positions", () => {
  const moved = moveNodes(draft(), [["task-1", { x: 99, y: 99 }]]);
  assert.deepEqual([...moved.positions.keys()], ["task-1", "end-1"]);
});

test("the layout sent on save lists every position in node order with the viewport", () => {
  const moved = moveNodes(draft(), [["end-1", { x: 30, y: 40 }]]);
  assert.deepEqual(layoutForSave(moved, { x: 1, y: 2, zoom: 0.5 }), {
    nodes: [
      { id: "task-1", x: 10, y: 20 },
      { id: "end-1", x: 30, y: 40 },
    ],
    viewport: { x: 1, y: 2, zoom: 0.5 },
  });
  assert.equal(layoutForSave(moved, undefined).viewport, null);
});

test("a save makes the written content and the positions sent the new base", () => {
  const moved = moveNodes(draft(), [["end-1", { x: 30, y: 40 }]]);
  const sent = layoutForSave(moved, undefined);
  const written = { ...content, revision: "sha256:bbbb" };
  const saved = markSaved(moved, { content: written, contentHash: "hash-2" }, sent);
  assert.equal(isDirty(saved), false);
  assert.equal(saved.baseHash, "hash-2");
  assert.deepEqual(saved.content, written);
});

test("a move made while the save was in flight stays dirty after it", () => {
  const moved = moveNodes(draft(), [["end-1", { x: 30, y: 40 }]]);
  const sent = layoutForSave(moved, undefined);
  const movedAgain = moveNodes(moved, [["end-1", { x: 60, y: 40 }]]);
  const saved = markSaved(movedAgain, { content, contentHash: "hash-2" }, sent);
  assert.equal(isDirty(saved), true);
  assert.deepEqual(saved.positions.get("end-1"), { x: 60, y: 40 });
});

test("a save clears the deleted-on-disk mark", () => {
  const deleted = markDeletedOnDisk(draft());
  assert.equal(deleted.deletedOnDisk, true);
  const saved = markSaved(deleted, { content, contentHash: "hash-2" }, layoutForSave(deleted, undefined));
  assert.equal(saved.deletedOnDisk, false);
});

// --- disk changes ----------------------------------------------------------------------

test("a file with the hash the draft loaded keeps the draft", () => {
  const moved = moveNodes(draft(), [["end-1", { x: 30, y: 40 }]]);
  assert.deepEqual(reconcileWithDisk(moved, file()), { action: "keep", draft: moved });
});

test("a changed file reloads a clean draft quietly", () => {
  assert.deepEqual(reconcileWithDisk(draft(), file({ contentHash: "hash-9" })), { action: "reload" });
});

test("a changed file keeps a dirty draft, which finds the conflict when it saves", () => {
  const moved = moveNodes(draft(), [["end-1", { x: 30, y: 40 }]]);
  assert.deepEqual(reconcileWithDisk(moved, file({ contentHash: "hash-9" })), { action: "keep", draft: moved });
});

test("a deleted file marks the draft deleted on disk, dirty or not", () => {
  const missing = file({ missing: true, contentHash: undefined, content: undefined, layout: undefined });
  for (const d of [draft(), moveNodes(draft(), [["end-1", { x: 30, y: 40 }]])]) {
    const result = reconcileWithDisk(d, missing);
    assert.equal(result.action, "keep");
    assert.equal(result.action === "keep" && result.draft.deletedOnDisk, true);
  }
});

test("a file that comes back unchanged clears the deleted mark", () => {
  const result = reconcileWithDisk(markDeletedOnDisk(draft()), file());
  assert.equal(result.action === "keep" && result.draft.deletedOnDisk, false);
});

test("a file that can't be parsed any more reloads a clean draft, so its problem shows", () => {
  const broken = file({ contentHash: "hash-9", content: undefined, problem: { message: "Not valid JSON" } });
  assert.deepEqual(reconcileWithDisk(draft(), broken), { action: "reload" });
});
