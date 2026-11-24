/// <reference types="node" />
// Tests for what a file link's diff request does to Topos (#721): which worktree Topos works on while
// its lens is open on the file, and when it goes back to the selected terminal's.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { requestFileDiff } from "../git/fileDiffRequest.ts";
import type { ToposTarget } from "../git/topos/Topos.tsx";
import type { ToposDock } from "./ToposDock.tsx";
import type { ToposFile } from "./useToposFile.ts";

const { useToposDock, ToposLens } = await import("./ToposDock.tsx");
const { useToposFile } = await import("./useToposFile.ts");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

const projects = [
  { path: "E:/alpha", name: "Alpha" },
  { path: "E:/beta", name: "Beta" },
];
const worktrees = {
  "E:/alpha": [
    { path: "E:/alpha", head: "a1", branch: "main", is_main: true, is_bare: false, is_locked: false },
    { path: "E:/alpha/.wt/fix", head: "a2", branch: "fix", is_main: false, is_bare: false, is_locked: false },
  ],
};
const OWN: ToposTarget = { path: "E:\\alpha", name: "Alpha", repoPath: "E:/alpha" };

/** The app's wiring of the dock and the request, with the state of both at hand. */
function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  let now!: { dock: ToposDock; file: ToposFile };
  const Shell = ({ terminalId }: { terminalId: string }) => {
    const dock = useToposDock(terminalId);
    const file = useToposFile({ dock, terminalId, own: OWN, projects, projectWorktrees: worktrees });
    now = { dock, file };
    return dock.wide ? createElement(ToposLens, { dock, terminalId, title: file.target?.name, replyStrip: null }) : null;
  };
  const select = (terminalId: string) => act(() => root.render(createElement(Shell, { terminalId })));
  select("t1");
  return { now: () => now, select };
}

/** Asks for the diff of `path` in `worktree`, as a click in terminal `t1`'s surface does. */
function ask(worktree: string, path = "src/a.ts"): boolean {
  let taken = false;
  act(() => {
    taken = requestFileDiff({ terminalId: "t1", worktree, path, side: "unstaged", line: null });
  });
  return taken;
}

test("a file in the selected terminal's own worktree opens the Topos lens there, however its path is spelled", () => {
  const { now } = render();
  assert.equal(ask("e:/alpha/"), true);
  assert.equal(now().dock.wide, true);
  assert.equal(now().file.target, OWN);
  assert.equal(now().file.request?.path, "src/a.ts");
});

test("a file in another worktree or project has the lens work on that one, under its own name", () => {
  const { now } = render();
  ask("E:/alpha/.wt/fix");
  assert.deepEqual(now().file.target, { path: "E:/alpha/.wt/fix", name: "Alpha · fix", repoPath: "E:/alpha" });
  ask("E:\\beta");
  assert.deepEqual(now().file.target, { path: "E:\\beta", name: "Beta", repoPath: "E:/beta" });
  ask("E:/gamma");
  assert.deepEqual(now().file.target, { path: "E:/gamma", name: "gamma", repoPath: "E:/gamma" });
});

test("Topos goes back to the terminal's worktree when the lens closes, and when something else asks for Topos", () => {
  const { now } = render();
  ask("E:/beta");
  act(() => now().dock.dismiss());
  assert.equal(now().file.target, OWN);
  assert.equal(now().file.request, null);
  act(() => now().dock.companion.openWide());
  assert.equal(now().file.target, OWN, "Wide is for the terminal's own");

  ask("E:/beta");
  act(() => now().file.release());
  assert.equal(now().file.target, OWN);
  assert.equal(now().dock.wide, true);
});

test("the same file asked for again is a new request, also after the lens closed", () => {
  const { now } = render();
  const seen = new Set<number | undefined>();
  ask("E:/beta");
  seen.add(now().file.request?.seq);
  ask("E:/beta");
  seen.add(now().file.request?.seq);
  act(() => now().dock.dismiss());
  ask("E:/beta");
  seen.add(now().file.request?.seq);
  assert.equal(seen.size, 3);
});

test("a request for a terminal that is not selected is not taken, and selecting another one ends it", () => {
  const { now, select } = render();
  select("t2");
  assert.equal(ask("E:/beta"), false);
  assert.equal(now().dock.wide, false);
  select("t1");
  ask("E:/beta");
  select("t2");
  assert.equal(now().file.target, OWN);
  assert.equal(now().file.request, null);
});
