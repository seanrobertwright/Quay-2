/// <reference types="node" />
// A finished turn in the attention queue (#766), with only Tauri's `invoke` and events faked: what the
// backend sends around a Codex turn's end, in both orders it can come in.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, Fragment, type FC } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import { emit, mount, unmount } from "../surface/fixtures/surfaceFixtures.ts";
import type { AttentionItem } from "./attentionQueue.ts";

const { useAttentionQueue } = await import("./useAttentionQueue.ts");

const CODEX: TerminalInfo = { ...terminalInfo("t1", "E:/alpha"), run_kind: "codex", claude_status: "working" };

beforeEach(() => fakeInvoke(async (cmd) => (cmd === "get_pending_permissions" ? [] : null)));
afterEach(unmount);

let items: AttentionItem[] = [];
const Queue: FC = () => {
  items = useAttentionQueue([CODEX]).items;
  return createElement(Fragment);
};

const turnEnds = () => emit("bridge-event", { type: "turn.completed", tag: "t1", data: {} });
const status = (claude_status: TerminalInfo["claude_status"]) =>
  emit("terminal-status", { terminal_id: "t1", claude_status, plugin_hint: false });
const listed = () => items.map((item) => item.kind);

test("a Codex turn is listed once, whether it is reported before or after its terminal goes idle", async () => {
  await mount(createElement(Queue));
  await turnEnds();
  assert.deepEqual(listed(), ["finishedTurn"]);
  await status("idle");
  assert.deepEqual(listed(), ["finishedTurn"]);

  await status("working");
  assert.deepEqual(listed(), [], "the next turn started");
  await status("idle");
  assert.deepEqual(listed(), [], "idle alone lists nothing: the turn may have been interrupted");
  await turnEnds();
  await status("idle");
  assert.deepEqual(listed(), ["finishedTurn"]);
});

test("a Codex turn reported once the next one runs is not left listed", async () => {
  await mount(createElement(Queue));
  await status("idle");
  await status("working");
  await turnEnds();
  await status("working");
  assert.deepEqual(listed(), []);
});

test("a Codex turn at a permission prompt lists nothing", async () => {
  await mount(createElement(Queue));
  await status("waiting");
  assert.deepEqual(listed(), []);
});
