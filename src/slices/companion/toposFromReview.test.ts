/// <reference types="node" />
// A review's file link and the Topos lens it opens over the stage (#772), drawn as Quay's window draws
// them: the stage with the review on its tab, the companion's Topos view, the Topos lens and the real
// Topos in its own layer, all on the one overlay stack. Only Tauri's `invoke` is faked. It also checks
// where the focus goes as a Topos diff closes (#792), in the lens and in the companion's Topos view.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fakeInvoke } from "../../test-support/dom.ts";
import { calls, called, loadSurfaces, settle, unloadSurfaces, until } from "../surface/fixtures/fakeRust.ts";
import type { SurfaceRecord } from "../surface/surfaceTypes.ts";
import type { ToposTarget } from "../git/topos/Topos.tsx";
import type { OpState } from "../git/topos/operation.ts";
import type { FileDiffRequest } from "../git/fileDiffRequest.ts";
import type { StatusEntry } from "../git/topos/stagingLists.ts";
import type { ConflictFile } from "../git/topos/useConflictResolver.ts";

/** How Rust showed a file, as `surface_show_file` answers. */
type Shown = { kind: "diff" } & Omit<FileDiffRequest, "terminalId">;

const { acceptedReview, openTab, REVIEW, stageProps, TERMINAL } = await import("../surface/fixtures/reviewFixtures.ts");
const { Stage } = await import("../stage/Stage.tsx");
const { useSurfaceTabs } = await import("../surface/useSurfaceTabs.tsx");
const { useToposDock, ToposLens, ToposLayer } = await import("./ToposDock.tsx");
const { useToposFile } = await import("./useToposFile.ts");
const { Topos } = await import("../git/topos/Topos.tsx");

const noop = () => {};
const OWN: ToposTarget = { path: "E:/alpha", name: "Alpha", repoPath: "E:/alpha" };
const NO_OPERATION: OpState = { kind: "none", leftLabel: null, rightLabel: null, message: null, conflicts: [], conflictsTotal: 0 };
const MERGING: OpState = {
  kind: "merge",
  leftLabel: { role: "HEAD", name: "main" },
  rightLabel: { role: "MERGE_HEAD", name: "fix" },
  message: "Merge fix",
  conflicts: [{ path: "b.ts", xy: "UU", kind: "bothModified" }],
  conflictsTotal: 1,
};

/** Where Rust says a link to `src/turns.ts:12` leads: the file's unstaged diff. */
const TURNS: Shown = { kind: "diff", worktree: "E:/alpha", path: "src/turns.ts", side: "unstaged", line: 12 };
/** What git status reports when `src/turns.ts` has unstaged changes, so the staging inspector lists it. */
const TURNS_CHANGED: StatusEntry[] = [{ path: "src/turns.ts", xy: ".M", kind: "tracked" }];

let mounted: { root: Root; container: HTMLElement } | null = null;
/** The operation git reports in the worktree. */
let operation: OpState;
/** Where each click on a file link leads, in turn; the last stays. */
let shown: Shown[];
/** The changes git status reports in the worktree, or null when the status read fails. */
let changes: StatusEntry[] | null;
/** More of Rust's answers, past the ones every test has. */
let more: Record<string, (args: Record<string, unknown>) => unknown>;
beforeEach(() => {
  operation = NO_OPERATION;
  shown = [TURNS];
  changes = null;
  more = {};
});
afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
  }
  mounted = null;
  unloadSurfaces();
});

/** Rust for the review and for Topos: a file link leads where `shown` says; what Topos reads beyond git's version, the operation and the `changes` fails. */
async function startRust(): Promise<void> {
  let list: SurfaceRecord[] = [];
  const answers: Record<string, (args: Record<string, unknown>) => unknown> = {
    surface_list: () => list,
    surface_checks: () => [],
    surface_open_page: () => ({ page: 1, unsent: [] }),
    surface_show_file: () => (shown.length > 1 ? shown.shift()! : shown[0]),
    git_version_check: () => ({ status: "ok" }),
    git_operation_state: () => operation,
    git_status: ({ requestId }) => {
      if (changes === null) throw new Error("git_status is not faked");
      return { requestId, entries: changes, total: changes.length, truncated: false };
    },
  };
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    if (Object.hasOwn(more, cmd)) return more[cmd](args);
    if (Object.prototype.hasOwnProperty.call(answers, cmd)) return answers[cmd](args);
    if (cmd.startsWith("surface_")) return null;
    throw new Error(`${cmd} is not faked`);
  });
  calls.length = 0;
  list = [await acceptedReview("review_1")];
  loadSurfaces();
}

/** The stage, the companion's Topos view, the Topos lens and Topos, wired as the app wires them. */
const Window = () => {
  const [frontId, setFrontId] = useState<string | null>(null);
  const tabs = useSurfaceTabs({ terminals: [TERMINAL], activeProject: "E:/alpha", frontId, onFront: setFrontId, onSelectTerminal: noop });
  // Each open of the lens moves the focus into Topos, as the app's does.
  const [focusKey, setFocusKey] = useState(0);
  const dock = useToposDock(TERMINAL.id, () => setFocusKey((n) => n + 1));
  const file = useToposFile({ dock, terminalId: TERMINAL.id, own: OWN, projects: [], projectWorktrees: {} });
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { "data-stage-wrapper": "" },
      createElement(Stage, stageProps(tabs, frontId, "E:/alpha")),
      dock.wide ? createElement(ToposLens, { dock, terminalId: TERMINAL.id, title: "Topos · Alpha", replyStrip: null }) : null,
    ),
    createElement("aside", { "data-companion": "" }, createElement("div", { ref: dock.companion.viewSlot })),
    createElement(ToposLayer, {
      dock,
      children: createElement(Topos, {
        isOpen: dock.placement !== null,
        wide: dock.placement === "lens",
        focusKey,
        project: file.target,
        terminals: [TERMINAL],
        fileRequest: file.request,
      }),
    }),
  );
};

/** Quay's window with the review's tab in front, and the review's frame. */
async function draw(): Promise<{ container: HTMLElement; review: HTMLElement }> {
  await startRust();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(Window)));
  await settle();
  return { container, review: await openTab(container, REVIEW.title) };
}

const lens = (container: HTMLElement) => container.querySelector('section[aria-label="Topos lens"]');
const diff = (container: HTMLElement) => container.querySelector('[data-topos-layer] section[aria-label="Unstaged diff of src/turns.ts"]');
/** The graph's commit list, where Topos's `focusGraph` puts the focus. */
const graphList = (container: HTMLElement) => container.querySelector('[data-topos-layer] [role="listbox"][aria-label="Commits"]');
const button = (within: Element, name: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name);
/** The open diff view's Back to graph button. */
const backToGraph = (container: HTMLElement) => button(diff(container)!, "Back to graph")!;

/** Clicks the review's file link, as the operator does, and waits for the lens. */
async function clickFileLink(container: HTMLElement, review: HTMLElement): Promise<void> {
  const link = review.querySelector<HTMLElement>('[role="link"]')!;
  await act(async () => link.focus());
  await act(async () => link.click());
  await until(() => lens(container) !== null, "the file link opened no lens");
}

/** Presses Escape where the focus is, and says whether anything past the overlay stack heard it. */
async function escape(): Promise<boolean> {
  let heard = false;
  const hear = (e: KeyboardEvent) => void (heard ||= e.key === "Escape");
  document.addEventListener("keydown", hear);
  const target = document.activeElement ?? document.body;
  await act(async () => void target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await settle();
  document.removeEventListener("keydown", hear);
  return heard;
}

/** Presses Escape with the Topos lens showing the graph, and checks it closes the lens and gives the focus back to the review's file link. */
async function escapeClosesLens(container: HTMLElement, review: HTMLElement): Promise<void> {
  assert.equal(await escape(), false, "the Escape that closes the lens reached past the overlay stack");
  assert.equal(lens(container) !== null, false, "Escape closes the lens");
  // The terminal is covered by the review's tab, so the focus goes back to the link that opened the lens
  assert.equal(document.activeElement === review.querySelector('[role="link"]'), true, "the focus is back on the review's file link");
}

for (const [where, focus, toGraph] of [
  ["Topos, where the lens puts it", () => {}, false],
  ["the diff view", (container: HTMLElement) => backToGraph(container).focus(), true],
  ["the review's file link, under the lens", (_: HTMLElement, review: HTMLElement) => review.querySelector<HTMLElement>('[role="link"]')!.focus(), false],
] as const) {
  test(`with the focus in ${where}, Escape closes the diff a review's file link opened, then the Topos lens, and Approve answers`, async () => {
    const { container, review } = await draw();
    await clickFileLink(container, review);
    await until(() => diff(container) !== null, "the diff view never opened");
    await act(async () => focus(container, review));
    const focused = document.activeElement;

    assert.equal(await escape(), false, "the first Escape reached past the overlay stack");
    assert.deepEqual([diff(container) !== null, lens(container) !== null], [false, true], "the first Escape goes back to the graph");
    if (toGraph) assert.equal(document.activeElement === graphList(container), true, "the focus left in the diff view goes to the graph");
    else assert.equal(document.activeElement === focused, true, "the focus outside the diff view stays where it was");
    await escapeClosesLens(container, review);

    await act(async () => button(review, "Approve")!.click());
    await until(() => called("surface_answer").length === 1, "Approve sent nothing");
  });
}

test("Back to graph in the diff a review's file link opened puts the focus on the graph, and Escape then closes the lens", async () => {
  const { container, review } = await draw();
  await clickFileLink(container, review);
  await until(() => diff(container) !== null, "the diff view never opened");
  const back = backToGraph(container);
  await act(async () => back.focus());
  await act(async () => back.click());
  await settle();

  assert.deepEqual([diff(container) !== null, lens(container) !== null], [false, true], "Back to graph shows the graph in the lens");
  assert.equal(document.activeElement === graphList(container), true, "the focus left in the diff view goes to the graph");
  await escapeClosesLens(container, review);
});

/** Opens `path`'s unstaged diff from the staging inspector, as the operator does: the WIP row shows the inspector, a click on the file's row opens it. */
async function openFromStaging(container: HTMLElement, path: string): Promise<void> {
  const layer = container.querySelector("[data-topos-layer]")!;
  const wip = () => layer.querySelector<HTMLButtonElement>("button[aria-controls]");
  await until(() => wip() !== null, "no WIP row");
  if (wip()!.getAttribute("aria-expanded") !== "true") await act(async () => wip()!.click());
  const row = () =>
    [...layer.querySelectorAll<HTMLElement>('[aria-label="Unstaged changes"] [data-row]')].find((r) => r.textContent?.includes(path));
  await until(() => row() !== undefined, `no staging row for ${path}`);
  await act(async () => row()!.click());
  await until(() => diff(container) !== null, "the diff view never opened");
}

test("in the Topos lens, Escape in a diff opened from staging puts the focus on the graph, and the next Escape closes the lens", async () => {
  changes = TURNS_CHANGED;
  const { container, review } = await draw();
  await clickFileLink(container, review);
  await until(() => diff(container) !== null, "the diff view never opened");
  await act(async () => backToGraph(container).click());
  await openFromStaging(container, "src/turns.ts");
  await act(async () => backToGraph(container).focus());

  assert.equal(await escape(), false, "the first Escape reached past the overlay stack");
  assert.deepEqual([diff(container) !== null, lens(container) !== null], [false, true], "the first Escape goes back to the graph");
  assert.equal(document.activeElement === graphList(container), true, "the focus left in the diff view goes to the graph");
  await escapeClosesLens(container, review);
});

for (const [how, close] of [
  ["Escape", () => escape()],
  ["Back to graph", (container: HTMLElement) => act(async () => backToGraph(container).click())],
] as const) {
  test(`in the companion's Topos view, ${how} in a diff opened from staging puts the focus on the graph`, async () => {
    changes = TURNS_CHANGED;
    const { container } = await draw();
    await openFromStaging(container, "src/turns.ts");
    assert.equal(lens(container) !== null, false, "Topos is in the companion, not the lens");
    await act(async () => backToGraph(container).focus());

    await close(container);
    await settle();
    assert.equal(diff(container) !== null, false, `${how} goes back to the graph`);
    assert.equal(document.activeElement === graphList(container), true, "the focus left in the diff view goes to the graph");
  });
}

test("a review's file link that waits for the open resolver says so once in a Topos toast, and opens when it closes", async () => {
  operation = MERGING;
  shown = [{ kind: "diff", worktree: "E:/alpha", path: "b.ts", side: "conflicted", line: null }, TURNS];
  const { container, review } = await draw();
  const resolverBack = () => button(container, "Back to the graph");
  // A link to the conflicted file opens it in the resolver; Escape closes the lens and leaves the resolver as it was.
  await clickFileLink(container, review);
  await until(() => resolverBack() !== undefined, "the resolver never opened");
  await escape();
  assert.deepEqual([lens(container) !== null, resolverBack() !== undefined], [false, true]);

  await clickFileLink(container, review);
  const toasts = () => [...container.querySelectorAll('[aria-label="Topos notifications"] li p')].map((p) => p.textContent);
  await until(() => toasts().length > 0, "nothing said why the file waits");
  assert.deepEqual(toasts(), ["Close the conflict resolver on b.ts to open src/turns.ts."]);
  assert.deepEqual([diff(container) !== null, resolverBack() !== undefined], [false, true], "the resolver is kept");
  await settle();
  assert.equal(toasts().length, 1, "said again while it waits");

  await act(async () => resolverBack()!.click());
  await until(() => diff(container) !== null, "the diff did not open as the resolver closed");
  assert.equal(toasts().length, 1, "said again as it opened");
});

/** Where a review's link to the conflicted `b.ts` leads: the file, in the conflict resolver. */
const B_CONFLICTED: Shown = { kind: "diff", worktree: "E:/alpha", path: "b.ts", side: "conflicted", line: null };
const resolverBack = (container: HTMLElement) => button(container, "Back to the graph");

/** Draws Quay's window in a merge and opens the conflicted `b.ts` in the resolver from the review's file link. */
async function openResolver(): Promise<{ container: HTMLElement; review: HTMLElement }> {
  operation = MERGING;
  shown = [B_CONFLICTED];
  const drawn = await draw();
  await clickFileLink(drawn.container, drawn.review);
  await until(() => resolverBack(drawn.container) !== undefined, "the resolver never opened");
  await settle();
  return drawn;
}

test("Back to the graph in the conflict resolver, with the focus on it, puts the focus on the graph", async () => {
  const { container } = await openResolver();
  const back = resolverBack(container)!;
  await act(async () => back.focus());
  await act(async () => back.click());
  await settle();

  assert.equal(resolverBack(container), undefined, "Back to the graph closes the resolver");
  assert.equal(document.activeElement === graphList(container), true, "the focus left in the resolver goes to the graph");
});

/** `b.ts` as `git_conflict_open` reads it when the incoming side deleted it: not text to edit, so the resolver draws the side-picker card. */
const B_DELETED_BY_THEM: ConflictFile = {
  path: "b.ts",
  xy: "UD",
  kind: "deletedByThem",
  onDisk: true,
  leftOid: "1111111111111111111111111111111111111111",
  rightOid: null,
  token: "t",
  editable: false,
  reason: "oneSideMissing",
  left: null,
  right: null,
  result: null,
  eol: "lf",
  bom: false,
  markerSize: 7,
};

/** Opens `b.ts` in the resolver as the side-picker card, where Keep modified stages it and leaves the merge with no conflict. */
async function openSidePicker(): Promise<{ container: HTMLElement; keep: HTMLButtonElement }> {
  changes = [];
  more = {
    git_conflict_open: () => B_DELETED_BY_THEM,
    git_conflict_mark_resolved: ({ requestId }) => {
      operation = { ...MERGING, conflicts: [], conflictsTotal: 0 };
      changes = [{ path: "b.ts", xy: "M.", kind: "tracked" }];
      return { requestId, entries: changes, total: changes.length, truncated: false };
    },
  };
  const { container } = await openResolver();
  await until(() => button(container, "Keep modified") !== undefined, "the resolver drew no side-picker card");
  return { container, keep: button(container, "Keep modified")! };
}

test("staging the last conflicted file from the resolver, with the focus on the control used, puts the focus on the graph as the resolver closes", async () => {
  const { container, keep } = await openSidePicker();
  await act(async () => keep.focus());
  await act(async () => keep.click());
  await until(() => called("git_conflict_mark_resolved").length === 1, "Keep modified staged nothing");
  await until(() => resolverBack(container) === undefined, "the resolver stayed open with no conflict left");
  await settle();

  assert.equal(document.activeElement === graphList(container), true, "the focus left in the resolver goes to the graph");
});

for (const [how, close] of [
  ["Back to the graph", (container: HTMLElement) => resolverBack(container)!.click()],
  ["staging the last conflicted file", (container: HTMLElement) => button(container, "Keep modified")!.click()],
] as const) {
  test(`${how} closes the conflict resolver with the focus outside it, and leaves the focus where it was`, async () => {
    const { container } = await openSidePicker();
    const link = container.querySelector<HTMLElement>('[role="link"]')!;
    await act(async () => link.focus());
    assert.equal(document.activeElement === link, true, "the review's file link takes the focus");

    await act(async () => close(container));
    await until(() => resolverBack(container) === undefined, `${how} left the resolver open`);
    await settle();
    assert.equal(document.activeElement === link, true, "the focus outside the resolver stays where it was");
  });
}
