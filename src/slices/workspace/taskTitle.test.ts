/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { messageTitle, promptTitle } from "./taskTitle.ts";

/** Prompts that title nothing, the first as Rust types it, and prompts that are titles. Rust's `return_tests` hold them too. */
const vectors: { title_nothing: string[]; titles: string[] } = JSON.parse(
  readFileSync(new URL("../../../src-tauri/src/slices/surface/typed_line.vectors.json", import.meta.url), "utf8"),
);

test("a turn's prompt titles its terminal by its first line", () => {
  assert.equal(promptTitle("  Fix the login bug\nmore detail"), "Fix the login bug");
  assert.equal(promptTitle("Review every open pull request and label it"), "Review every open pull request and l");
  assert.equal(promptTitle(" \n"), "");
});

test("a message titles the terminal it reaches, without its peer prefix", () => {
  assert.equal(messageTitle("[Peer agent (asker)]: Read package.json"), "Read package.json");
  assert.equal(messageTitle("Read package.json"), "Read package.json");
});

test("a surface's answer that Quay typed in titles nothing", () => {
  assert.ok(vectors.title_nothing.length > 0);
  for (const prompt of vectors.title_nothing) {
    assert.equal(promptTitle(prompt), "", prompt);
    assert.equal(messageTitle(prompt), "", prompt);
  }
});

test("a prompt that only mentions a surface is a title", () => {
  assert.ok(vectors.titles.length > 0);
  for (const prompt of vectors.titles) {
    assert.equal(promptTitle(prompt), prompt);
    assert.equal(messageTitle(prompt), prompt);
  }
});
