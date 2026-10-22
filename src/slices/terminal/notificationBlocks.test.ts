/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationBlocks } from "./types.ts";

test("an idle prompt or an auth success doesn't block the agent", () => {
  assert.ok(!notificationBlocks("idle_prompt"));
  assert.ok(!notificationBlocks("auth_success"));
});

test("a permission prompt, a dialog, or a type Quay doesn't know blocks the agent", () => {
  for (const kind of ["permission_prompt", "elicitation_dialog", "something_new", undefined, 7]) {
    assert.ok(notificationBlocks(kind), String(kind));
  }
});
