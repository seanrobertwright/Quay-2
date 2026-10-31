/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateView, GIT_DOWNLOAD_URL, parseGitError } from "./gitVersion.ts";

test("a supported git opens Topos with no message", () => {
  assert.deepEqual(gateView({ status: "ok" }), { kind: "open" });
});

test("missing git blocks Topos with the download link", () => {
  assert.deepEqual(gateView({ status: "missing" }), {
    kind: "blocked",
    title: "Git not found on PATH",
    detail: "Install git, then press Retry.",
  });
  assert.equal(GIT_DOWNLOAD_URL, "https://git-scm.com/downloads");
});

test("an old git blocks Topos and names the version found", () => {
  assert.deepEqual(gateView({ status: "tooOld", found: "2.30.1.windows.1" }), {
    kind: "blocked",
    title: "Topos needs git 2.36 or newer. Found 2.30.1.windows.1.",
    detail: "Update git, then press Retry.",
  });
});

test("an unreadable version opens Topos with a one-line warning", () => {
  assert.deepEqual(gateView({ status: "unknown", raw: "git version ???" }), {
    kind: "open",
    warning: "Couldn't read git's version (git version ???). Topos is carrying on, but some features may fail.",
  });
});

test("a rejected command's GitError parses into its typed kind", () => {
  assert.deepEqual(parseGitError({ kind: "stagingBusy" }), { kind: "stagingBusy" });
  assert.deepEqual(parseGitError({ kind: "hookFailed", hook: "pre-commit", output: "boom" }), {
    kind: "hookFailed",
    hook: "pre-commit",
    output: "boom",
  });
  assert.deepEqual(parseGitError({ kind: "changedSinceDiscard", paths: ["a.txt", 2] }), {
    kind: "changedSinceDiscard",
    paths: ["a.txt", "2"],
  });
  assert.deepEqual(parseGitError({ kind: "other", stderr: "fatal: x" }), { kind: "other", stderr: "fatal: x" });
});

test("anything that isn't a known GitError parses to null", () => {
  assert.equal(parseGitError("boom"), null);
  assert.equal(parseGitError(null), null);
  assert.equal(parseGitError({ kind: "somethingNew" }), null);
  assert.equal(parseGitError({ kind: 3 }), null);
  assert.equal(parseGitError(Object.create({ kind: "cancelled" })), null);
});
