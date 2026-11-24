/// <reference types="node" />
// Boards on a pane's strip (#724), with only Tauri's `invoke` and events faked: what the operator sees
// of them and does with them.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, useEffect, type FC, type ReactNode } from "react";
import { companionPrefs } from "../companion/companionPrefs.ts";
import { memoryStorage } from "../companion/fixtures/companionFixtures.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { arrives, changed, mount, redraw, removed, settle, surface, unmount } from "./fixtures/surfaceFixtures.ts";
import { board, ended, line, lines, opened, redrawn, sentAgain, settled, SEVEN, strip, TERMINAL } from "./fixtures/boardFixtures.ts";

const { Companion, COMPANION_VIEWS } = await import("../companion/Companion.tsx");
const { startSurfaces } = await import("./surfaceHost.ts");
const { openBoard } = await import("./strip/openBoards.ts");
const { SurfaceChips, SurfaceDot } = await import("./SurfaceChips.tsx");

const MINUTE = 60_000;

/** The surfaces Rust holds when the page loads. */
let list: SurfaceRecord[];
let dismissals: Record<string, unknown>[];
let onDismiss: () => Promise<void>;

beforeEach(() => {
  list = [];
  dismissals = [];
  onDismiss = async () => {};
  fakeInvoke(async (cmd, args) => {
    if (cmd === "surface_open_page") return { page: 1, unsent: [] };
    if (cmd === "surface_list") return list;
    if (cmd !== "surface_dismiss") return cmd === "surface_checks" ? [] : null;
    dismissals.push(args);
    return onDismiss();
  });
});
afterEach(unmount);

/** What is drawn while the page keeps surfaces. */
const Page: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(startSurfaces, []);
  return createElement(Fragment, null, children);
};
const page = (...children: ReactNode[]) => createElement(Page, null, ...children);

async function open(container: HTMLElement, id: string): Promise<HTMLElement> {
  await act(async () => line(container, id)!.click());
  for (let i = 0; i < 100 && opened(container)?.textContent?.includes("Loading"); i += 1) await settle();
  return opened(container)!;
}

test("a board arrives as a line: its title, the current step, how far it is, its clock and a bar", async () => {
  const container = await mount(page(strip()));
  assert.equal(container.textContent, "");

  await arrives(board("board", { steps: SEVEN }, { title: "Migrating *call* sites", started_at: Date.now() - (4 * MINUTE + 12_000) }));

  const text = line(container, "board")!.textContent!;
  assert.match(text, /^Board: Migrating \*call\* sitesChange call sites3 of 704:1\d$/);
  const bar = line(container, "board")!.querySelector<HTMLElement>("[data-bar]")!;
  assert.equal(Math.round(parseFloat(bar.style.width)), 43);
  assert.equal(line(container, "board")!.getAttribute("aria-expanded"), "false");
  assert.equal(opened(container), null, "it arrives folded");
});

test("a quiet board says when it was last updated, and one that has just been does not", async () => {
  const ago = (ms: number) => ({ started_at: Date.now() - 20 * MINUTE, updated_at: Date.now() - ms });
  list = [board("quiet", {}, ago(6 * MINUTE)), board("busy", {}, ago(MINUTE))];
  const container = await mount(page(strip()));
  assert.ok(line(container, "quiet")!.textContent!.includes("updated 6 min ago"));
  assert.ok(!line(container, "busy")!.textContent!.includes("updated"));

  await redrawn(sentAgain(list[0]));
  assert.ok(!line(container, "quiet")!.textContent!.includes("updated"), "an update ends it");
  await redrawn(changed(list[1], { board: { ...list[1].board!, ...ago(6 * MINUTE), status: "done", stopped_at: Date.now() - 5 * MINUTE } }));
  assert.ok(!line(container, "busy")!.textContent!.includes("updated"), "a settled board is not quiet");
});

test("what is counted drives the bar, and stands for the steps where there are none", async () => {
  list = [board("both", { steps: SEVEN, progress: { done: 1, total: 4 } }), board("counted", { progress: { done: 30, total: 40 } }), board("neither")];
  const container = await mount(page(strip()));
  const bar = (id: string) => line(container, id)!.querySelector<HTMLElement>("[data-bar]")?.style.width;
  assert.deepEqual([bar("both"), bar("counted"), bar("neither")], ["25%", "75%", undefined]);
  assert.ok(line(container, "both")!.textContent!.includes("3 of 7"));
  assert.ok(line(container, "counted")!.textContent!.includes("30 of 40"));
  assert.ok(!line(container, "neither")!.textContent!.includes(" of "));
});

test("opened, a board drops over the terminal in its frame, with its steps, amount and stats, and folds again", async () => {
  list = [board("board", { steps: SEVEN, progress: { done: 1, total: 4 }, stats: [{ label: "passed", value: "186" }] }, { title: "Migrating" })];
  const container = await mount(page(strip()));
  const region = await open(container, "board");

  assert.equal(region.getAttribute("aria-label"), "Board from fix-75");
  const drop = container.querySelector<HTMLElement>("[data-open-board]")!;
  assert.deepEqual([line(container, "board")!.getAttribute("aria-expanded"), line(container, "board")!.getAttribute("aria-controls")], ["true", drop.id]);
  assert.ok(drop.className.includes("max-h-[60%]") && drop.className.includes("overflow-y-auto"), "it scrolls past 60% of the pane");
  const content = region.querySelector("[data-surface-content]")!.textContent!;
  assert.match(content, /^Migrating3 of 700:0\d1 of 4Done: Read/);
  assert.ok(content.includes("In progress: Change call sites") && content.endsWith("186 passed"));
  assert.ok(region.querySelector("ol")!.className.includes("@lg:columns-2"));

  await act(async () => line(container, "board")!.click());
  assert.equal(opened(container), null);
  assert.equal(line(container, "board")!.getAttribute("aria-controls"), null);
});

test("one board is open at a time, and an update is drawn in the one that is", async () => {
  list = [board("one", { steps: SEVEN }, { title: "One" }), board("two", {}, { title: "Two" })];
  const container = await mount(page(strip()));
  await open(container, "one");
  await open(container, "two");
  assert.equal(container.querySelectorAll("[data-open-board]").length, 1);
  assert.ok(opened(container)!.textContent!.includes("Two"));

  const region = await open(container, "one");
  const dismiss = region.querySelector<HTMLButtonElement>('button[aria-label="Dismiss this board"]')!;
  dismiss.focus();
  await redrawn(sentAgain(list[0], { steps: [{ label: "Only step", state: "done" }] }, { title: "One again" }));
  const after = opened(container)!.textContent!;
  assert.ok(after.includes("One again") && after.includes("Only step") && !after.includes("Release"));
  assert.ok(document.activeElement === dismiss, "the keyboard keeps its place");
});

test("a done board says so and stops, and opened it keeps its steps under a band", async () => {
  list = [board("board", { steps: SEVEN }, { title: "Migrating", started_at: Date.now() - 10 * MINUTE })];
  const container = await mount(page(strip()));
  await open(container, "board");

  const all = SEVEN.map(({ label }) => ({ label, state: "done" }));
  await redrawn(settled(list[0], "done", { steps: all }));

  assert.match(line(container, "board")!.textContent!, /^Board: MigratingDone10:0\d$/);
  const text = opened(container)!.textContent!;
  assert.ok(text.includes("Done.") && text.includes("Done: Release"));
  assert.ok(opened(container)!.querySelector('[role="status"] svg'), "with an icon of its own");
});

test("a failed board shows the failed step in the current one's place", async () => {
  const steps = SEVEN.map((step) => (step.label === "Test" ? { ...step, state: "failed" } : step));
  list = [settled(board("board", { steps }, { title: "Migrating" }), "failed", { steps })];
  const container = await mount(page(strip()));
  assert.match(line(container, "board")!.textContent!, /^Board: MigratingTestFailed00:0\d$/);
  assert.ok((await open(container, "board")).textContent!.includes("Failed."));
});

test("an exit stops a board, which says so and keeps its steps", async () => {
  list = [board("board", { steps: SEVEN }, { title: "Migrating" })];
  const container = await mount(page(strip()));
  await open(container, "board");
  await redrawn(ended(list[0]));
  assert.ok(line(container, "board")!.textContent!.includes("Stopped: the terminal exited."));
  const text = opened(container)!.textContent!;
  assert.ok(text.includes("Stopped: the terminal exited.") && text.includes("In progress: Change call sites"));
});

test("four live boards and the newest finished one have lines, and the rest fold under how many there are", async () => {
  const finished = ["f1", "f2", "f3", "f4", "f5"].map((id) => board(id));
  list = [...finished, ...["l1", "l2", "l3", "l4"].map((id) => board(id))];
  // f2 finishes last
  list = [...["f1", "f3", "f4", "f5", "f2"].map((id) => settled(finished.find((record) => record.id === id)!, "done")), ...list.filter(({ id }) => id.startsWith("l"))];
  const container = await mount(page(strip()));
  const ids = () => lines(container).map((button) => button.closest<HTMLElement>("[data-board-line]")!.dataset.boardLine);
  assert.deepEqual(ids(), ["l1", "l2", "l3", "l4", "f2"]);
  assert.ok(container.querySelector("[data-board-lines]")!.className.includes("@2xl:grid-cols-2"), "two share a row where there is room");

  const fold = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "4 finished earlier")!;
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  await act(async () => fold.click());
  assert.deepEqual(ids(), ["l1", "l2", "l3", "l4", "f2", "f5", "f4", "f3", "f1"]);
  assert.equal((await open(container, "f3")).dataset.surface, "f3");

  await act(async () => fold.click());
  assert.equal(opened(container), null, "what is folded is not left open with no line to fold it by");
  assert.equal(lines(container).length, 5);
});

test("an open board that folds away with the finished ones keeps its line", async () => {
  list = [board("one"), board("two")];
  const container = await mount(page(strip()));
  await open(container, "one");
  await redrawn(settled(list[0], "done"));
  await redrawn(settled(list[1], "done"));
  assert.equal(opened(container)!.dataset.surface, "one");
  assert.equal(line(container, "one")!.getAttribute("aria-expanded"), "true");
});

test("a dismissal leaves, with the keyboard's place moved to what is left and then to the terminal", async () => {
  list = [board("one"), board("two")];
  const container = await mount(page(strip()));
  const asked: string[] = [];
  const onFocus = (e: Event) => void asked.push((e as CustomEvent<{ terminalId: string }>).detail.terminalId);
  window.addEventListener("quay:focus-terminal", onFocus);
  try {
    for (const [i, id] of ["one", "two"].entries()) {
      const region = await open(container, id);
      const button = region.querySelector<HTMLButtonElement>('button[aria-label="Dismiss this board"]')!;
      button.focus();
      await act(async () => button.click());
      assert.deepEqual(dismissals[i], { terminalId: "t1", id });
      await removed(list[i]);
      assert.equal(line(container, id), undefined);
      if (i === 0) assert.ok(document.activeElement === line(container, "two"));
    }
  } finally {
    window.removeEventListener("quay:focus-terminal", onFocus);
  }
  assert.deepEqual(asked, ["t1"]);
  assert.equal(container.textContent, "");
});

test("a dismissal that is refused says why and stays", async () => {
  onDismiss = () => Promise.reject("Not dismissed: no.");
  list = [board("one")];
  const container = await mount(page(strip()));
  const region = await open(container, "one");
  await act(async () => region.querySelector<HTMLButtonElement>('button[aria-label="Dismiss this board"]')!.click());
  await settle();
  assert.ok(opened(container)!.textContent!.includes("Not dismissed: no."));
});

test("another terminal's boards and what is in another place are not on the strip", async () => {
  list = [board("mine"), board("theirs", {}, {}, { terminal_id: "t2" }), surface("ask_1")];
  const container = await mount(page(strip()));
  assert.equal(lines(container).length, 1);
  assert.ok(line(container, "mine"));
});

test("a board has a chip and no waiting flag, and opens from it wherever its strip is", async () => {
  list = [board("one", {}, { title: "One" }), surface("ask_1", { terminal_id: "t2" })];
  const opens: boolean[] = [];
  const chips = createElement(SurfaceChips, { terminalId: "t1", terminalName: "fix-75", onOpen: (key) => void opens.push(openBoard(key)) });
  const container = await mount(page(strip(), createElement("div", { "data-row": "" }, chips, createElement(SurfaceDot, { terminalId: "t1" }))));
  const row = container.querySelector("[data-row]")!;
  assert.equal(row.textContent, "Board");
  assert.equal(row.querySelectorAll("[data-waiting-dot], [data-surface-dot]").length, 0);

  await act(async () => row.querySelector("button")!.click());
  assert.deepEqual(opens, [true]);
  assert.equal(opened(container)!.dataset.surface, "one");
  await act(async () => row.querySelector("button")!.click());
  assert.ok(opened(container), "a second click leaves it open");
  await act(async () => void opens.push(openBoard({ terminal_id: "t2", id: "ask_1" }), openBoard({ terminal_id: "t9", id: "one" })));
  assert.deepEqual(opens.slice(2), [false, false], "a surface elsewhere is opened elsewhere");

  await redrawn(settled(list[0], "done"));
  assert.equal(row.textContent, "", "a finished board has no chip");
});

test("a board stays open while another terminal's strip is shown in its place, and a later board of its id is not open", async () => {
  list = [board("one")];
  const container = await mount(page(strip()));
  await open(container, "one");
  await redraw(page());
  await redraw(page(strip()));
  assert.ok(opened(container), "it is as it was left");

  await redrawn(board("one"));
  assert.equal(opened(container), null);
});

test("the companion has no Surface view for a terminal that only has boards", async () => {
  list = [board("one")];
  const props = { projects: [], projectWorktrees: {}, views: COMPANION_VIEWS, prefs: companionPrefs(memoryStorage()) };
  const container = await mount(page(createElement(Companion, { ...props, selectedTerminal: TERMINAL })));
  const views = () => [...container.querySelectorAll('[aria-label="Companion view"] [role="radio"]')].map((entry) => entry.textContent);
  assert.ok(views().length > 0 && !views().includes("Surface"));
  await arrives(surface("ask_1", { asks: false }));
  assert.ok(views().includes("Surface"));
  await act(async () => [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((entry) => entry.textContent === "Surface")!.click());
  assert.equal(container.querySelectorAll("[data-surface]").length, 1, "the board is not in it");
});
