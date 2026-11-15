/// <reference types="node" />
// Which pull request the diff lens opens on (#640): the companion header, the Files detail and
// chord `d` all ask `diffLensFor`; with no pull request, chord `d` falls back to the repo-wide Diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TerminalLink } from "../terminal/types.ts";
import { diffLensFor } from "./diffLensTarget.ts";

const ticketOnly: TerminalLink = {
  ticket: { repo: null, number: 5, source: "launch", pinned: false, at: 1 },
  pull_request: null,
  candidates: [],
};

test("the lens opens on the terminal's pull request, in its repository, on the file asked for", () => {
  const link: TerminalLink = { ...ticketOnly, pull_request: { repo: "o/r", number: 12, source: "branch", pinned: false, at: 2 } };
  assert.deepEqual(diffLensFor("a", "E:/alpha", link, "src/a.ts"), {
    terminalId: "a",
    repoPath: "E:/alpha",
    repo: "o/r",
    number: 12,
    file: "src/a.ts",
  });
  assert.equal(diffLensFor("a", "E:/alpha", link)?.file, null);
});

test("a terminal with no pull request has no diff lens", () => {
  assert.equal(diffLensFor("a", "E:/alpha", ticketOnly), null);
  assert.equal(diffLensFor("a", "E:/alpha", null), null);
});
