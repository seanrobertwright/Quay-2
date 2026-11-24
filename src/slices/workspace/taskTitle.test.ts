/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { messageTitle, promptTitle } from "./taskTitle.ts";

/** What Rust types for an answer after the wait, as its `return_tests` have it. */
const TYPED_ANSWER =
  '[Quay surface "Which base should this branch take?" (ask_1)]: {"answers":[{"question":"Which base should this branch take?","chosen":["Yes"],"text":"skip the suite"}]}';

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
  for (const prompt of [TYPED_ANSWER, `\n${TYPED_ANSWER}\n`, `<pasted_content id="62ae">\n${TYPED_ANSWER}\n</pasted_content>`]) {
    assert.equal(promptTitle(prompt), "");
    assert.equal(messageTitle(prompt), "");
  }
  assert.equal(messageTitle('[Quay surface "a)]: {" (ask_2)]: {"dismissed":true}'), "");
});

test("a prompt that only mentions a surface is a title", () => {
  assert.equal(promptTitle("[Quay surface] looks odd"), "[Quay surface] looks odd");
  assert.equal(messageTitle(`Explain ${TYPED_ANSWER}`).startsWith("Explain [Quay surface"), true);
});
