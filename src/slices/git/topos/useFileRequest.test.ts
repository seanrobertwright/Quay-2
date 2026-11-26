/// <reference types="node" />
// Tests for how Topos opens the file a link asked for (#721): once it shows the file's worktree, in the
// diff view or, for a conflicted file, in the resolver, and never over a resolver that is open, which
// it says once for each request (#772).
import "../../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFileRequest, type FileRequest, type FileRequestState } from "./useFileRequest.ts";

let mounted: Root | null = null;
afterEach(() => {
  if (mounted) act(() => mounted!.unmount());
  mounted = null;
});

/** Runs the hook with `state`, and gives what it opened and said so far. */
function render(state: Partial<FileRequestState>) {
  const opened: string[] = [];
  const said: string[] = [];
  let now: FileRequestState = {
    ready: true,
    request: null,
    conflicts: [],
    resolving: null,
    openDiff: ({ path, side }) => void opened.push(`${side} ${path}`),
    openResolver: (path) => void opened.push(`resolver ${path}`),
    announce: (text) => void said.push(text),
  };
  const Topos = (state: FileRequestState) => (useFileRequest(state), null);
  mounted = createRoot(document.createElement("div"));
  const set = (change: Partial<FileRequestState>) => {
    now = { ...now, ...change };
    act(() => mounted!.render(createElement(Topos, now)));
  };
  set(state);
  return { opened, said, set };
}

const request = (seq: number, side: FileRequest["side"] = "unstaged"): FileRequest => ({ seq, path: "a.ts", side });

test("a file opens once, when Topos shows its worktree", () => {
  const { opened, set } = render({ ready: false, request: request(1, "staged") });
  assert.deepEqual(opened, []);
  set({ ready: true });
  set({ ready: false });
  set({ ready: true });
  assert.deepEqual(opened, ["staged a.ts"]);
  set({ request: request(2, "staged") });
  assert.deepEqual(opened, ["staged a.ts", "staged a.ts"], "asked for again");
});

test("a conflicted file opens in the resolver once its conflict is read", () => {
  const { opened, set } = render({ conflicts: [], request: request(1, "conflicted") });
  assert.deepEqual(opened, []);
  set({ conflicts: ["b.ts", "a.ts"] });
  assert.deepEqual(opened, ["resolver a.ts"]);
  set({ resolving: "a.ts" });
  set({ resolving: null });
  assert.deepEqual(opened, ["resolver a.ts"], "closing it does not open it again");
});

test("a resolver that is open, which may hold unsaved edits, is kept, and the file opens once it closes", () => {
  const { opened, set } = render({ resolving: "b.ts", conflicts: ["a.ts", "b.ts"], request: request(1) });
  assert.deepEqual(opened, []);
  set({ request: request(2, "conflicted") });
  assert.deepEqual(opened, []);
  set({ resolving: null });
  assert.deepEqual(opened, ["resolver a.ts"]);
});

test("a conflicted file the resolver shows already is not opened again", () => {
  const { opened, set } = render({ resolving: "a.ts", conflicts: ["a.ts"], request: request(1, "conflicted") });
  set({ resolving: null });
  assert.deepEqual(opened, []);
});

test("a file that waits for the open resolver says so once for each request, and opens when it closes", () => {
  const { opened, said, set } = render({ resolving: "b.ts", conflicts: ["a.ts", "b.ts"], request: request(1) });
  assert.deepEqual(said, ["Close the conflict resolver on b.ts to open a.ts."]);
  set({ conflicts: ["b.ts", "a.ts"] });
  set({ resolving: "c.ts" });
  assert.equal(said.length, 1, "drawn again for the same request");
  set({ request: request(2, "conflicted") });
  assert.deepEqual(said.slice(1), ["Close the conflict resolver on c.ts to open a.ts."]);
  set({ resolving: null });
  assert.deepEqual(opened, ["resolver a.ts"]);
  assert.equal(said.length, 2, "nothing is said as it opens");
});

test("nothing is said for a file that opens at once or waits for something other than the resolver", () => {
  const { said, set } = render({ ready: false, resolving: "b.ts", request: request(1) });
  set({ resolving: null, conflicts: [], request: request(2, "conflicted") });
  set({ ready: true });
  set({ resolving: "a.ts", conflicts: ["a.ts"], request: request(3, "conflicted") });
  set({ resolving: null, request: request(4) });
  assert.deepEqual(said, []);
});
