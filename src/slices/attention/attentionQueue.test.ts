/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAttentionEvent,
  attentionItemKey,
  attentionItems,
  droppedPermissionCount,
  emptyAttentionQueue,
  type AttentionEvent,
  type AttentionQueue,
  waitedLabel,
} from "./attentionQueue.ts";

/** The queue after `events`, applied in order to a new, empty queue. */
const run = (...events: AttentionEvent[]): AttentionQueue =>
  events.reduce(applyAttentionEvent, emptyAttentionQueue);

const requested = (requestId: string, terminalId: string | null, at: number, tool = "Bash"): AttentionEvent => ({
  type: "permissionRequested",
  request: { requestId, terminalId, project: "E:/proj", tool },
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

test("an item queued before its terminal was known takes the terminal's project once it is", () => {
  const queue = run(
    {
      type: "pendingPermissionsLoaded",
      requests: [{ requestId: "req-old", terminalId: "term-b", project: null, tool: "Write" }],
      at: 500,
    },
    { type: "turnCompleted", terminalId: "term-c", project: null, subagent: false, at: 600 },
    {
      type: "terminalsKnown",
      terminals: [
        { terminalId: "term-b", project: "E:/b" },
        { terminalId: "term-c", project: "E:/c" },
      ],
    }
  );
  assert.deepEqual(attentionItems(queue), [
    { kind: "permission", requestId: "req-old", terminalId: "term-b", project: "E:/b", tool: "Write", waitingSince: 500 },
    { kind: "finishedTurn", terminalId: "term-c", project: "E:/c", waitingSince: 600 },
  ]);
});

test("a known terminal leaves an item's project as it was when the item already had one", () => {
  const queue = run(requested("req-1", "term-a", 100), {
    type: "terminalsKnown",
    terminals: [{ terminalId: "term-a", project: "E:/moved" }],
  });
  assert.deepEqual(
    attentionItems(queue).map((item) => item.project),
    ["E:/proj"]
  );
});

test("each item's key comes from its request or its terminal, so it stays put as the list changes", () => {
  const keys = (queue: AttentionQueue) => attentionItems(queue).map(attentionItemKey);
  const before = run(requested("req-1", "term-a", 200), finished("term-a", 300));
  assert.deepEqual(keys(before), ["permission:req-1", "finishedTurn:term-a"]);
  // An older item joining ahead of them moves them down the list but leaves their keys alone
  const after = applyAttentionEvent(before, finished("term-b", 100));
  assert.deepEqual(keys(after), ["finishedTurn:term-b", "permission:req-1", "finishedTurn:term-a"]);
});

test("how long an item has waited reads in its largest units", () => {
  const second = 1000;
  const minute = 60 * second;
  const hour = 60 * minute;
  const since = 1_000_000;
  const cases: [number, string][] = [
    [0, "0s"],
    [45 * second, "45s"],
    [59 * second + 999, "59s"],
    [3 * minute + 5 * second, "3m"],
    [hour, "1h"],
    [hour + 5 * minute, "1h 5m"],
    [26 * hour + 30 * minute, "1d 2h"],
    // A clock that stepped back never shows a negative wait
    [-5 * second, "0s"],
  ];
  for (const [waited, label] of cases) {
    assert.equal(waitedLabel(since, since + waited), label, `${waited} ms`);
  }
});

test("a terminal ending removes all its items and leaves other terminals' items", () => {
  const queue = run(
    requested("req-a1", "term-a", 100),
    requested("req-a2", "term-a", 200),
    finished("term-a", 300),
    requested("req-b", "term-b", 150),
    finished("term-b", 250),
    { type: "terminalEnded", terminalId: "term-a" }
  );
  assert.deepEqual(keys(queue), ["permission:req-b", "finishedTurn:term-b"]);
});

/** `count` permission requests from `terminalId`, `req-<terminal>-1` first, one time unit apart from `start`. */
const requests = (terminalId: string, count: number, start: number): AttentionEvent[] =>
  Array.from({ length: count }, (_, i) => requested(`req-${terminalId}-${i + 1}`, terminalId, start + i));

test("a terminal past 20 permission requests keeps its newest 20 and counts the ones dropped", () => {
  const queue = run(...requests("term-a", 23, 100));
  assert.deepEqual(
    keys(queue),
    Array.from({ length: 20 }, (_, i) => `permission:req-term-a-${i + 4}`)
  );
  assert.equal(droppedPermissionCount(queue, "term-a"), 3);
});

test("a terminal at its cap never evicts another terminal's permission requests", () => {
  const queue = run(
    requested("req-b-early", "term-b", 10),
    ...requests("term-a", 25, 100),
    requested("req-b-late", "term-b", 500)
  );
  const termB = attentionItems(queue).filter((item) => item.terminalId === "term-b");
  assert.deepEqual(
    termB.map((item) => item.kind === "permission" && item.requestId),
    ["req-b-early", "req-b-late"]
  );
  assert.equal(attentionItems(queue).filter((item) => item.terminalId === "term-a").length, 20);
  assert.equal(droppedPermissionCount(queue, "term-a"), 5);
  assert.equal(droppedPermissionCount(queue, "term-b"), 0);
});

test("a terminal ending forgets how many of its requests were dropped, and leaves other terminals' counts", () => {
  const queue = run(
    ...requests("term-a", 22, 100),
    ...requests("term-b", 21, 200),
    { type: "terminalEnded", terminalId: "term-a" }
  );
  assert.equal(droppedPermissionCount(queue, "term-a"), 0);
  assert.equal(droppedPermissionCount(queue, "term-b"), 1);
});
