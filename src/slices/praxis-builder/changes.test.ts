/// <reference types="node" />
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "./changes.ts";

describe("diffLines", () => {
  test("marks each line of git's unified diff as a header, a hunk, an addition, a removal or context", () => {
    const diff = [
      "diff --git a/.praxis/grants/a.json b/.praxis/grants/a.json",
      "index 1b2c3d4..5e6f7a8 100644",
      "--- a/.praxis/grants/a.json",
      "+++ b/.praxis/grants/a.json",
      "@@ -1,3 +1,3 @@",
      " {",
      '-  "limit": "5"',
      '+  "limit": "50"',
      " }",
      "",
    ].join("\n");
    assert.deepEqual(diffLines(diff), [
      { kind: "header", text: "diff --git a/.praxis/grants/a.json b/.praxis/grants/a.json" },
      { kind: "header", text: "index 1b2c3d4..5e6f7a8 100644" },
      { kind: "header", text: "--- a/.praxis/grants/a.json" },
      { kind: "header", text: "+++ b/.praxis/grants/a.json" },
      { kind: "hunk", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", text: "{" },
      { kind: "removed", text: '  "limit": "5"' },
      { kind: "added", text: '  "limit": "50"' },
      { kind: "context", text: "}" },
    ]);
  });

  test("inside a hunk, a line that starts like a header is still a change", () => {
    const diff = "--- a/x.json\n+++ b/x.json\n@@ -1 +1 @@\n--- old\n+++ new\n\\ No newline at end of file\r\n";
    assert.deepEqual(diffLines(diff), [
      { kind: "header", text: "--- a/x.json" },
      { kind: "header", text: "+++ b/x.json" },
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "removed", text: "-- old" },
      { kind: "added", text: "++ new" },
      { kind: "header", text: "\\ No newline at end of file" },
    ]);
  });
});
