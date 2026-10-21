/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepSendChoices, toAgentChoices } from "./sendChoices.ts";
import type { ClaudeStatus } from "../terminal/types.ts";

const agent = (id: string, claude_status: ClaudeStatus = "idle") => ({ id, claude_status });

test("To Agent never offers an exited terminal", () => {
  const agents = [agent("a"), agent("b", "exited"), agent("c", "working")];
  assert.deepEqual(
    toAgentChoices(agents, "a", false).map((t) => t.id),
    ["c"],
  );
});

test("To Agent offers From Agent's terminal only for a message dispatched as the user", () => {
  const agents = [agent("a"), agent("b")];
  assert.deepEqual(toAgentChoices(agents, "a", false).map((t) => t.id), ["b"]);
  assert.deepEqual(toAgentChoices(agents, "a", true).map((t) => t.id), ["a", "b"]);
});

test("a To Agent that exits moves to another live peer", () => {
  const agents = [agent("a"), agent("b", "exited"), agent("c")];
  assert.deepEqual(keepSendChoices(agents, "a", "b", false), { from: "a", to: "c" });
});

test("the first To Agent skips an exited terminal", () => {
  const agents = [agent("a"), agent("b", "exited"), agent("c")];
  assert.deepEqual(keepSendChoices(agents, "", "", false), { from: "a", to: "c" });
});

test("To Agent is empty when no other live peer is left", () => {
  const agents = [agent("a"), agent("b", "exited")];
  assert.deepEqual(keepSendChoices(agents, "a", "b", false), { from: "a", to: "" });
});

test("From Agent may still be an exited terminal", () => {
  const agents = [agent("a", "exited"), agent("b")];
  assert.deepEqual(keepSendChoices(agents, "a", "b", false), { from: "a", to: "b" });
});

test("a valid pair is kept as it is", () => {
  const agents = [agent("a"), agent("b"), agent("c")];
  assert.deepEqual(keepSendChoices(agents, "b", "c", false), { from: "b", to: "c" });
  assert.deepEqual(keepSendChoices(agents, "b", "b", true), { from: "b", to: "b" });
  assert.deepEqual(keepSendChoices(agents, "b", "b", false), { from: "b", to: "a" });
});
