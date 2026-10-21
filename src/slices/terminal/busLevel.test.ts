/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { busLevel, isPluginSilent, showsWorkingOnDelivery } from "./types.ts";

test("each CLI has its level, and shells and Archon are not peers", () => {
  assert.equal(busLevel({ run_kind: "codex", claude_status: "idle" }), "full peer");
  assert.equal(busLevel({ run_kind: "antigravity", claude_status: "starting" }), "responder");
  assert.equal(busLevel({ run_kind: "copilot", claude_status: "starting" }), "listener");
  assert.equal(busLevel({ run_kind: "powershell", claude_status: "unknown" }), null);
  assert.equal(busLevel({ run_kind: "archon", claude_status: "working" }), null);
});

test("an Unknown Claude terminal is a listener, and a Starting one a full peer", () => {
  assert.equal(busLevel({ run_kind: "claude", claude_status: "unknown" }), "listener");
  assert.ok(isPluginSilent({ run_kind: "claude", claude_status: "unknown" }));
  assert.equal(busLevel({ run_kind: "claude", claude_status: "starting" }), "full peer");
});

test("only a Claude terminal falls to listener when Unknown", () => {
  assert.equal(busLevel({ run_kind: "codex", claude_status: "unknown" }), "full peer");
  assert.ok(!isPluginSilent({ run_kind: "codex", claude_status: "unknown" }));
});

test("a delivery shows a terminal Working only when Quay will see its turn end", () => {
  assert.ok(showsWorkingOnDelivery({ run_kind: "claude", claude_status: "idle" }));
  assert.ok(!showsWorkingOnDelivery({ run_kind: "claude", claude_status: "unknown" }));
  assert.ok(showsWorkingOnDelivery({ run_kind: "codex", claude_status: "idle" }));
  assert.ok(!showsWorkingOnDelivery({ run_kind: "opencode", claude_status: "idle" }));
  assert.ok(!showsWorkingOnDelivery({ run_kind: "gemini", claude_status: "unknown" }));
});
