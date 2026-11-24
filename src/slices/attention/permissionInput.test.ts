// Unit tests for the rule that splits a permission request's input into its summary and the rest,
// which the summary does not show (#704).
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPermissionInput } from "./permissionInput.ts";

test("every field but the summarised one is the rest, in the order it arrived", () => {
  assert.deepEqual(splitPermissionInput({ replace_all: false, file_path: "a.ts", old_string: "x", new_string: "y" }), {
    summary: "a.ts",
    rest: [
      { name: "replace_all", value: false },
      { name: "old_string", value: "x" },
      { name: "new_string", value: "y" },
    ],
  });
});

test("an input the summary shows whole has no rest", () => {
  assert.deepEqual(splitPermissionInput("ls -la"), { summary: "ls -la", rest: [] });
  assert.deepEqual(splitPermissionInput({ command: "ls -la" }), { summary: "ls -la", rest: [] });
  assert.deepEqual(splitPermissionInput({}), { summary: "{}", rest: [] });
  assert.deepEqual(splitPermissionInput([]), { summary: "[]", rest: [] });
});

test("an absent input has no summary and no rest", () => {
  assert.deepEqual(splitPermissionInput(undefined), { summary: "", rest: [] });
  assert.deepEqual(splitPermissionInput(null), { summary: "", rest: [] });
});

test("an object with no summarised field is all rest, so its JSON is not its summary too", () => {
  assert.deepEqual(splitPermissionInput({ query: "quay", limit: 5 }), {
    summary: "",
    rest: [
      { name: "query", value: "quay" },
      { name: "limit", value: 5 },
    ],
  });
  assert.deepEqual(splitPermissionInput({ command: ["ls", "-la"] }), {
    summary: "",
    rest: [{ name: "command", value: ["ls", "-la"] }],
  });
});

test("only the first summarised field is left out of the rest", () => {
  assert.deepEqual(splitPermissionInput({ path: "docs", pattern: "TODO" }), {
    summary: "docs",
    rest: [{ name: "pattern", value: "TODO" }],
  });
});

test("an input that is not a plain object is one value with no name", () => {
  assert.deepEqual(splitPermissionInput([1, "two"]), { summary: "", rest: [{ name: null, value: [1, "two"] }] });
  assert.deepEqual(splitPermissionInput(42), { summary: "", rest: [{ name: null, value: 42 }] });
  assert.deepEqual(splitPermissionInput(false), { summary: "", rest: [{ name: null, value: false }] });
});
