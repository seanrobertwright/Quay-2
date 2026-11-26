/// <reference types="node" />
// A review's file link and the Topos lens it opens over the stage (#772), drawn as Quay's window draws
// them: the stage with the review on its tab, the companion's Topos view, the Topos lens and the real
// Topos in its own layer, all on the one overlay stack. Only Tauri's `invoke` is faked.
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

let mounted: { root: Root; container: HTMLElement } | null = null;
/** The operation git reports in the worktree. */
let operation: OpState;
/** Where each click on a file link leads, in turn; the last stays. */
let shown: Shown[];
beforeEach(() => {
  operation = NO_OPERATION;
  shown = [TURNS];
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

/** Rust for the review and for Topos: a file link leads where `shown` says; what Topos reads beyond git's version and the operation fails. */
async function startRust(): Promise<void> {
  let list: SurfaceRecord[] = [];
  const answers: Record<string, (args: Record<string, unknown>) => unknown> = {
    surface_list: () => list,
    surface_checks: () => [],
    surface_open_page: () => ({ page: 1, unsent: [] }),
    surface_show_file: () => (shown.length > 1 ? shown.shift()! : shown[0]),
    git_version_check: () => ({ status: "ok" }),
    git_operation_state: () => operation,
  };
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
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
const button = (within: Element, name: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name);

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

for (const [where, focus] of [
  ["Topos, where the lens puts it", () => {}],
  ["the diff view", (container: HTMLElement) => button(diff(container)!, "Back to graph")!.focus()],
  ["the review's file link, under the lens", (_: HTMLElement, review: HTMLElement) => review.querySelector<HTMLElement>('[role="link"]')!.focus()],
] as const) {
  test(`with the focus in ${where}, Escape closes the diff a review's file link opened, then the Topos lens, and Approve answers`, async () => {
    const { container, review } = await draw();
    await clickFileLink(container, review);
    await until(() => diff(container) !== null, "the diff view never opened");
    await act(async () => focus(container, review));

    assert.equal(await escape(), false, "the first Escape reached past the overlay stack");
    assert.deepEqual([diff(container) !== null, lens(container) !== null], [false, true], "the first Escape goes back to the graph");
    assert.equal(await escape(), false, "the second Escape reached past the overlay stack");
    assert.equal(lens(container) !== null, false, "the second Escape closes the lens");
    // The terminal is covered by the review's tab, so the focus goes back to the link that opened the lens
    assert.equal(document.activeElement === review.querySelector('[role="link"]'), true, "the focus is back on the review's file link");

    await act(async () => button(review, "Approve")!.click());
    await until(() => called("surface_answer").length === 1, "Approve sent nothing");
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
