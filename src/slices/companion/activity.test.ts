// Unit tests for the companion's Activity view entries (#644): the selected terminal's tool calls,
// each started and finished event paired into one call, merged with the messages it sent and got.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Envelope } from "../bridge/useBridgeEvents.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import { activityEntries } from "./activity.ts";

let seq = 0;
const event = (tag: string, type: string, ts: number, data: Record<string, unknown>): Envelope => ({
  v: 1,
  boot: "boot",
  seq: ++seq,
  ts,
  sessionId: "session",
  tag,
  type,
  data,
});
const message = (over: Partial<TrailMessage> & Pick<TrailMessage, "id" | "from_terminal" | "to_terminal" | "timestamp">): TrailMessage => ({
  content: "do the thing",
  as_user: false,
  status: "completed",
  ...over,
});

test("a started and a finished event with one tool use id are one call, with the command and its output", () => {
  // The bridge hands events newest first.
  const events = [
    event("term-a", "tool.finished", 2_000, { tool: "Bash", toolUseId: "t1", input: { command: "pnpm test" }, text: "1 passed", status: "ok" }),
    event("term-a", "tool.started", 1_000, { tool: "Bash", toolUseId: "t1", input: { command: "pnpm test" } }),
  ];
  assert.deepEqual(activityEntries("term-a", events, []), [
    { kind: "tool", id: "tool:t1", at: 1_000, tool: "Bash", summary: "pnpm test", output: "1 passed", status: "ok" },
  ]);
});

test("a call with no finish yet is running, and a failed one is an error", () => {
  const events = [
    event("term-a", "tool.started", 3_000, { tool: "Read", toolUseId: "t2", input: { file_path: "src/App.tsx" } }),
    event("term-a", "tool.finished", 2_000, { tool: "Edit", toolUseId: "t1", input: { file_path: "a.ts" }, text: "no match", status: "error" }),
    event("term-a", "tool.started", 1_000, { tool: "Edit", toolUseId: "t1", input: { file_path: "a.ts" } }),
  ];
  const entries = activityEntries("term-a", events, []);
  assert.deepEqual(
    entries.map((e) => (e.kind === "tool" ? [e.tool, e.summary, e.status, e.output] : null)),
    [
      ["Edit", "a.ts", "error", "no match"],
      ["Read", "src/App.tsx", "running", null],
    ],
  );
});

test("other terminals' events and events that are not tool calls are left out", () => {
  const events = [
    event("term-b", "tool.started", 1_000, { tool: "Bash", toolUseId: "b1", input: { command: "ls" } }),
    event("term-a", "turn.completed", 1_500, {}),
  ];
  assert.deepEqual(activityEntries("term-a", events, []), []);
});

test("messages to and from the terminal merge with its tool calls, oldest first", () => {
  const events = [event("term-a", "tool.started", 2_000, { tool: "Bash", toolUseId: "t1", input: { command: "ls" } })];
  const messages = [
    message({ id: "m2", from_terminal: "term-a", to_terminal: "term-b", to_name: "reviewer", timestamp: 3_000, content: "please review", response: null, status: "dispatched" }),
    message({ id: "m1", from_terminal: "user", from_name: "You", to_terminal: "term-a", timestamp: 1_000, content: "fix the bug", response: "Fixed in a.ts", as_user: true }),
    message({ id: "m3", from_terminal: "term-c", to_terminal: "term-d", timestamp: 1_500 }),
  ];
  const entries = activityEntries("term-a", events, messages);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["message:m1", "tool:t1", "message:m2"],
  );
  assert.deepEqual(entries[0], {
    kind: "message",
    id: "message:m1",
    at: 1_000,
    direction: "received",
    peer: "You",
    content: "fix the bug",
    reply: "Fixed in a.ts",
    status: "completed",
  });
  assert.deepEqual(entries[2], {
    kind: "message",
    id: "message:m2",
    at: 3_000,
    direction: "sent",
    peer: "reviewer",
    content: "please review",
    reply: null,
    status: "dispatched",
  });
});

test("past the limit only the newest entries are kept", () => {
  const events = Array.from({ length: 5 }, (_, i) =>
    event("term-a", "tool.started", (i + 1) * 1_000, { tool: "Bash", toolUseId: `t${i + 1}`, input: { command: `step ${i + 1}` } }),
  ).reverse();
  assert.deepEqual(
    activityEntries("term-a", events, [], 2).map((e) => e.id),
    ["tool:t4", "tool:t5"],
  );
});
