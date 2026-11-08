/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAttentionEvent,
  attentionItems,
  emptyAttentionQueue,
  type AttentionEvent,
  type AttentionQueue,
} from "./attentionQueue.ts";

/** The queue after `events`, applied in order to a new, empty queue. */
const run = (...events: AttentionEvent[]): AttentionQueue =>
  events.reduce(applyAttentionEvent, emptyAttentionQueue);

const requested = (requestId: string, terminalId: string | null, at: number, tool = "Bash"): AttentionEvent => ({
  type: "permissionRequested",
  requestId,
  terminalId,
  project: "E:/proj",
  tool,
  at,
});

test("a new queue holds nothing", () => {
  assert.deepEqual(attentionItems(emptyAttentionQueue), []);
});

test("a permission request waits in the queue with its terminal, project, tool and time", () => {
  assert.deepEqual(attentionItems(run(requested("req-1", "term-a", 100, "Write"))), [
    {
      kind: "permission",
      requestId: "req-1",
      terminalId: "term-a",
      project: "E:/proj",
      tool: "Write",
      waitingSince: 100,
    },
  ]);
});

test("resolving a permission request clears only that request", () => {
  const queue = run(
    requested("req-1", "term-a", 100),
    requested("req-2", "term-a", 200),
    { type: "permissionResolved", requestId: "req-1" }
  );
  assert.deepEqual(
    attentionItems(queue).map((item) => item.kind === "permission" && item.requestId),
    ["req-2"]
  );
});

const finished = (terminalId: string, at: number, project = "E:/proj"): AttentionEvent => ({
  type: "turnCompleted",
  terminalId,
  project,
  subagent: false,
  at,
});

test("a finished turn waits in the queue for its terminal", () => {
  assert.deepEqual(attentionItems(run(finished("term-a", 100))), [
    { kind: "finishedTurn", terminalId: "term-a", project: "E:/proj", waitingSince: 100 },
  ]);
});

/** Each item as `kind:key`, for asserting on order: the request id or the terminal. */
const keys = (queue: AttentionQueue): string[] =>
  attentionItems(queue).map((item) =>
    item.kind === "permission" ? `permission:${item.requestId}` : `finishedTurn:${item.terminalId}`
  );

test("items are ordered oldest first by when they started waiting, across kinds", () => {
  const queue = run(
    requested("req-late", "term-a", 300),
    finished("term-b", 100),
    requested("req-early", "term-c", 50),
    finished("term-d", 200)
  );
  assert.deepEqual(keys(queue), [
    "permission:req-early",
    "finishedTurn:term-b",
    "finishedTurn:term-d",
    "permission:req-late",
  ]);
});

test("a terminal's newer finished turn replaces its older one and keeps the original waiting time", () => {
  const queue = run(
    finished("term-a", 100, "E:/old"),
    finished("term-b", 200),
    finished("term-a", 300, "E:/new")
  );
  assert.deepEqual(attentionItems(queue), [
    { kind: "finishedTurn", terminalId: "term-a", project: "E:/new", waitingSince: 100 },
    { kind: "finishedTurn", terminalId: "term-b", project: "E:/proj", waitingSince: 200 },
  ]);
});

test("a subagent's finished turn creates no item", () => {
  const queue = run({ type: "turnCompleted", terminalId: "term-a", project: "E:/proj", subagent: true, at: 100 });
  assert.deepEqual(attentionItems(queue), []);
});

test("user input to a terminal clears its finished turn, leaving other terminals and its permission requests", () => {
  const queue = run(
    finished("term-a", 100),
    finished("term-b", 200),
    requested("req-1", "term-a", 300),
    { type: "userInput", terminalId: "term-a" }
  );
  assert.deepEqual(keys(queue), ["finishedTurn:term-b", "permission:req-1"]);
});

test("a new turn starting on a terminal clears its finished turn", () => {
  const queue = run(
    finished("term-a", 100),
    finished("term-b", 200),
    { type: "turnStarted", terminalId: "term-a", subagent: false }
  );
  assert.deepEqual(keys(queue), ["finishedTurn:term-b"]);
});

test("a subagent's turn starting leaves the terminal's finished turn waiting", () => {
  const queue = run(finished("term-a", 100), { type: "turnStarted", terminalId: "term-a", subagent: true });
  assert.deepEqual(keys(queue), ["finishedTurn:term-a"]);
});

test("dismissing a terminal's finished turn clears it and leaves its permission requests", () => {
  const queue = run(
    finished("term-a", 100),
    requested("req-1", "term-a", 200),
    { type: "finishedTurnDismissed", terminalId: "term-a" }
  );
  assert.deepEqual(keys(queue), ["permission:req-1"]);
});

test("the backend's pending permissions rebuild the queue after a webview reload, keeping requests already queued", () => {
  const queue = run(requested("req-live", "term-a", 100), {
    type: "pendingPermissionsLoaded",
    requests: [
      { requestId: "req-live", terminalId: "term-a", project: "E:/proj", tool: "Bash" },
      { requestId: "req-old", terminalId: "term-b", project: null, tool: "Write" },
    ],
    at: 500,
  });
  assert.deepEqual(attentionItems(queue), [
    { kind: "permission", requestId: "req-live", terminalId: "term-a", project: "E:/proj", tool: "Bash", waitingSince: 100 },
    { kind: "permission", requestId: "req-old", terminalId: "term-b", project: null, tool: "Write", waitingSince: 500 },
  ]);
});

test("a request heard twice stays one item that keeps its original waiting time", () => {
  const queue = run(requested("req-1", "term-a", 100), requested("req-1", "term-a", 400));
  assert.deepEqual(
    attentionItems(queue).map((item) => item.waitingSince),
    [100]
  );
});
