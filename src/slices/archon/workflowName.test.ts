// The short forms of an Archon workflow's name in labels and terminal names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shortWorkflowName, workflowTerminalName } from "./workflowName.ts";

test("a workflow's short name drops its owner", () => {
  assert.equal(shortWorkflowName("owner/lril-sdlc:implement"), "lril-sdlc:implement");
  assert.equal(shortWorkflowName("plan"), "plan");
  assert.equal(shortWorkflowName("owner/"), "owner/");
});

test("a workflow's terminal is named for its last step", () => {
  assert.equal(workflowTerminalName("owner/lril-sdlc:implement"), "archon-implement");
  assert.equal(workflowTerminalName("plan"), "archon-plan");
  assert.equal(workflowTerminalName("owner/"), "archon-run");
});
