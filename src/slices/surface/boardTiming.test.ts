/// <reference types="node" />
// A board in time (#724), with Tauri's `invoke` and events and the timers faked: how often one that is
// sent often is drawn, and what its clock draws as it ticks.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, useEffect, type FC, type ReactNode } from "react";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { changed, mount, surface, unmount } from "./fixtures/surfaceFixtures.ts";
import { board, ended, line, lines, sentAgain, settled, SEVEN, strip } from "./fixtures/boardFixtures.ts";

const { startSurfaces, subscribeToSurfaces, useSurfacesOf } = await import("./surfaceHost.ts");

/** The surfaces a test starts with. */
let list: SurfaceRecord[];
/** How many times anything that draws surfaces was told to, since the timers were faked. */
let draws = 0;
let running: Set<unknown>;
let stopCounting = () => {};
const { setInterval: realSetInterval, clearInterval: realClearInterval } = globalThis;

beforeEach(() => {
  list = [];
  fakeInvoke(async (cmd) => {
    if (cmd === "surface_open_page") return { page: 1, unsent: [] };
    return cmd === "surface_list" || cmd === "surface_checks" ? [] : null;
  });
});
afterEach(async () => {
  stopCounting();
  await unmount();
  mock.timers.reset();
  Object.assign(globalThis, { setInterval: realSetInterval, clearInterval: realClearInterval });
});

/** Keeps surfaces while it is drawn, and draws `strip` as a pane does. It counts the draws of its own. */
let paneDraws = 0;
const Pane: FC<{ strip: ReactNode }> = ({ strip }) => {
  paneDraws += 1;
  return createElement("div", { "data-terminal": "" }, strip, "$ claude");
};
const Page: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(startSurfaces, []);
  return createElement(Fragment, null, children);
};

/** The page with the surfaces of `list`, which arrive once the timers are faked, so each timer is. */
async function start(...children: ReactNode[]): Promise<HTMLElement> {
  const container = await mount(createElement(Page, null, createElement(Pane, { strip: strip() }), ...children));
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.now() });
  countIntervals();
  for (const record of list) await sent(record);
  // Past what was drawn as they arrived
  await tick(1000);
  draws = 0;
  stopCounting = subscribeToSurfaces(() => void (draws += 1));
  return container;
}

const sent = (record: SurfaceRecord) => act(async () => emitEvent("surface-changed", record));
const tick = (ms: number) => act(async () => mock.timers.tick(ms));
const titleOf = (container: HTMLElement, id: string) => line(container, id)!.title;

test("a hundred updates in a second are drawn a few times, from the first to the last", async () => {
  list = [board("board", {}, { title: "Before" })];
  const container = await start();
  let record = list[0];
  for (let i = 1; i <= 100; i += 1) {
    record = sentAgain(record, {}, { title: `Call ${i}` });
    await sent(record);
    if (i === 1) assert.equal(titleOf(container, "board"), "Call 1", "the first is drawn at once");
    await tick(10);
  }
  assert.ok(draws >= 3 && draws <= 5, `${draws} draws in a second`);
  await tick(250);
  assert.equal(titleOf(container, "board"), "Call 100");
  const after = draws;
  await tick(1000);
  assert.equal(draws, after, "nothing is drawn after the last");
});

test("updates that arrive in another order end on the latest", async () => {
  list = [board("board")];
  const container = await start();
  const first = sentAgain(list[0], {}, { title: "First" });
  const second = sentAgain(first, {}, { title: "Second" });
  const third = sentAgain(second, {}, { title: "Third" });
  for (const record of [first, third, second]) await sent(record);
  await tick(250);
  assert.equal(titleOf(container, "board"), "Third");
});

test("one that settles or ends between two draws is drawn so, and one that leaves does not come back", async () => {
  list = [board("done"), board("ended"), board("gone")];
  const container = await start();
  for (const record of list) await sent(sentAgain(record));
  await sent(settled(changed(list[0], { revision: 3 }), "done"));
  await sent(ended(list[1]));
  await sent(sentAgain(list[2], {}, { title: "Held" }));
  await act(async () => emitEvent("surface-removed", { terminal_id: "t1", id: "gone" }));
  await tick(500);
  assert.ok(line(container, "ended")!.textContent!.includes("Stopped: the terminal exited."));
  const fold = [...container.querySelectorAll("button")].find((button) => button.textContent === "1 finished earlier")!;
  await act(async () => fold.click());
  assert.ok(line(container, "done")!.textContent!.includes("Done"));
  assert.equal(line(container, "gone"), undefined);
});

test("a board is not held back by another, nor is a surface of another kind", async () => {
  list = [board("one"), board("two"), surface("ask_1", { asks: false })];
  const Asked: FC = () => createElement("output", null, String(useSurfacesOf("t1").find(({ id }) => id === "ask_1")?.revision));
  const container = await start(createElement(Asked));
  await sent(sentAgain(list[0], {}, { title: "One again" }));
  await sent(sentAgain(list[1], {}, { title: "Two again" }));
  assert.deepEqual([titleOf(container, "one"), titleOf(container, "two")], ["One again", "Two again"]);
  for (const revision of [2, 3, 4]) await sent(changed(list[2], { revision }));
  assert.equal(container.querySelector("output")!.textContent, "4");
});

test("what is held when the page stops keeping surfaces is not drawn", async () => {
  list = [board("board")];
  await start();
  await sent(sentAgain(list[0]));
  await sent(sentAgain(sentAgain(list[0])));
  await unmount();
  const after = draws;
  await tick(1000);
  assert.equal(draws, after);
});

/** Counts the intervals that run. */
function countIntervals(): void {
  running = new Set();
  const { setInterval: set, clearInterval: clear } = globalThis;
  Object.assign(globalThis, {
    setInterval: (...args: Parameters<typeof setInterval>) => {
      const timer = set(...args);
      running.add(timer);
      return timer;
    },
    clearInterval: (timer: Parameters<typeof clearInterval>[0]) => {
      running.delete(timer);
      clear(timer);
    },
  });
}

/** What is drawn but for the clocks. */
function besidesClocks(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-board-clock]").forEach((clock) => clock.remove());
  return copy.innerHTML;
}
const clock = (container: HTMLElement, id = "board") => line(container, id)!.querySelector("[data-board-clock]")!.textContent!;

test("the clock ticks and draws nothing else again, and the quiet board says so by itself", async () => {
  const now = Date.now();
  list = [board("board", { steps: SEVEN }, { started_at: now - 60_000, updated_at: now })];
  const container = await start();
  assert.equal(clock(container), "01:01");
  const [before, pane, kept] = [besidesClocks(container), paneDraws, draws];
  const nodes = lines(container);

  await tick(5000);
  assert.equal(clock(container), "01:06");
  assert.equal(besidesClocks(container) === before, true, "nothing but the clock");
  assert.deepEqual([paneDraws, draws], [pane, kept], "not the pane it is on, nor any surface");
  assert.ok(lines(container).every((button, i) => button === nodes[i]));

  await tick(6 * 60_000);
  assert.equal(clock(container), "updated 6 min ago07:06");
});

test("the timer stops when the board settles or ends, and when its strip leaves the page", async () => {
  list = [board("one"), board("two"), board("three")];
  await start();
  assert.equal(running.size, 3, "a timer a line");
  await sent(settled(list[0], "failed"));
  assert.equal(running.size, 2);
  await sent(ended(list[1]));
  assert.equal(running.size, 1);
  await unmount();
  assert.equal(running.size, 0);
});
