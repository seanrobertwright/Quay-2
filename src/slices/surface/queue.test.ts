/// <reference types="node" />
// Several questions from one terminal in the companion's Surface view (#719), with only Tauri's
// `invoke` faked: which of them is open, and what the others show.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import type { CompanionShowRequest } from "../companion/Companion.tsx";
import { companionPrefs } from "../companion/companionPrefs.ts";
import { memoryStorage } from "../companion/fixtures/companionFixtures.ts";
import type { SurfaceRecord, Verdict } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";

const { Companion, COMPANION_VIEWS } = await import("../companion/Companion.tsx");
const { startSurfaces } = await import("./surfaceHost.ts");
const { askCheck, askRecord, mountCompanion, settle, TERMINAL, typeInto, unmount, until, viewEntry } = await import("./fixtures/askFixtures.ts");

const MINUTE = 60_000;

let list: SurfaceRecord[];
let verdicts: { call: number; verdict: Verdict }[];
let stop: (() => void) | null = null;
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  verdicts = [];
  fakeInvoke(async (cmd, args) => {
    if (cmd === "surface_verdict") verdicts.push(args as (typeof verdicts)[number]);
    if (cmd === "surface_open_page") return { page: 1, unsent: [] };
    if (cmd === "surface_list") return list;
    return cmd === "surface_checks" ? [] : null;
  });
});
afterEach(async () => {
  mock.timers.reset();
  if (mounted) await unmount(mounted);
  mounted = null;
  stop?.();
  stop = null;
});

const question = (text: string) => ({ question: text, options: [{ label: "Yes", recommended: false }, { label: "No", recommended: false }], multiple: false });

/** `ask_1` and on, each asking its own questions, as Rust holds them; the first has waited the longest. */
async function asked(...asks: string[][]): Promise<SurfaceRecord[]> {
  stop ??= startSurfaces();
  await settle();
  const records: SurfaceRecord[] = [];
  for (const [i, questions] of asks.entries()) {
    emitEvent("surface-check", { ...askCheck(i + 1, { questions: questions.map(question) }), surface_id: `ask_${i + 1}` });
    await until(() => verdicts.length === i + 1, "no verdict was given");
    const { verdict } = verdicts[i];
    assert.ok("state" in verdict, JSON.stringify(verdict));
    records.push(askRecord(verdict.state, { id: `ask_${i + 1}`, order: i + 1 }));
  }
  return records;
}

/** Draws `records`, as Rust lists them, in the companion's Surface view. */
async function draw(records: SurfaceRecord[]): Promise<void> {
  stop?.();
  // Rust lists them in no order
  list = [...records].reverse();
  stop = startSurfaces();
  mounted = await mountCompanion(TERMINAL);
  await showView();
}

async function showView(): Promise<void> {
  await act(async () => viewEntry(mounted!.container, "Surface")?.click());
  await settle();
  await until(() => !mounted!.container.textContent?.includes("Loading"), "a question was never drawn");
}

const regions = () => [...mounted!.container.querySelectorAll<HTMLElement>("section[data-surface]")];
const region = (id: string) => regions().find((section) => section.dataset.surface === id)!;
/** Which questions are drawn open, and which as a line, in the order they are drawn. */
const queue = () => regions().map((section) => `${section.dataset.surface} ${section.querySelector("input") ? "open" : "line"}`);
const line = (id: string) => region(id).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const open = (id: string) => act(async () => line(id).click());

const changed = (record: SurfaceRecord, over: Partial<SurfaceRecord>) => act(async () => emitEvent("surface-changed", { ...record, change: record.change + 100, ...over }));
const answered = (record: SurfaceRecord) => changed(record, { answer: { answers: [] }, answered_at: 1 });

test("the oldest question is open and the others are lines, oldest first", async () => {
  await draw(await asked(["First?"], ["Second?", "And this?"], ["Third?"]));

  assert.deepEqual(queue(), ["ask_1 open", "ask_2 line", "ask_3 line"]);
  assert.ok(line("ask_2").textContent?.includes("Second?") && !line("ask_2").textContent?.includes("And this?"), "its first question");
  assert.equal(line("ask_2").getAttribute("aria-expanded"), "false");
  assert.deepEqual(regions().map((section) => section.getAttribute("aria-label")), ["Question from fix-75", "Question from fix-75", "Question from fix-75"]);
});

test("a click on a line opens it, which takes the focus and folds the other in place, with what was typed kept", async () => {
  await draw(await asked(["First?"], ["Second?"], ["Third?"]));
  await typeInto(region("ask_1").querySelector("textarea")!, "half a thought");
  await open("ask_3");
  assert.deepEqual(queue(), ["ask_1 line", "ask_2 line", "ask_3 open"]);
  assert.ok(document.activeElement === region("ask_3"), "the focus is on the one that opened");
  assert.equal(region("ask_3").querySelector("textarea")!.value, "");

  await open("ask_1");
  assert.deepEqual(queue(), ["ask_1 open", "ask_2 line", "ask_3 line"]);
  assert.equal(region("ask_1").querySelector("textarea")!.value, "half a thought");
});

test("a question that comes leaves the open one open, and the oldest left opens when that settles", async () => {
  const [first, second, third] = await asked(["First?"], ["Second?"], ["Third?"]);
  await draw([first, second]);
  await open("ask_2");
  await changed(third, {});
  assert.deepEqual(queue(), ["ask_1 line", "ask_2 open", "ask_3 line"]);

  await answered(second);
  await showView();
  assert.deepEqual(queue().filter((drawn) => !drawn.startsWith("ask_2")), ["ask_1 open", "ask_3 line"]);
  await answered(first);
  await showView();
  assert.deepEqual(queue().filter((drawn) => drawn.startsWith("ask_3")), ["ask_3 open"]);
});

test("a question that leaves opens the next", async () => {
  const records = await asked(["First?"], ["Second?"]);
  await draw(records);
  await act(async () => emitEvent("surface-removed", { terminal_id: "t1", id: "ask_1" }));
  await settle();
  assert.deepEqual(queue(), ["ask_2 open"]);
});

test("the question a chip or the pane's button asks for opens, and the operator can open another after", async () => {
  await draw(await asked(["First?"], ["Second?"], ["Third?"]));
  const props = { projects: [], projectWorktrees: {}, views: COMPANION_VIEWS, prefs: companionPrefs(memoryStorage()) };
  const show = async (surfaceId: string, seq: number) => {
    const showRequest: CompanionShowRequest = { terminalId: "t1", view: "surface", seq, surfaceId };
    await act(async () => mounted!.root.render(createElement(Companion, { ...props, selectedTerminal: TERMINAL, showRequest })));
    await settle();
  };
  await show("ask_2", 1);
  assert.deepEqual(queue(), ["ask_1 line", "ask_2 open", "ask_3 line"]);
  await open("ask_3");
  assert.deepEqual(queue(), ["ask_1 line", "ask_2 line", "ask_3 open"]);
  await show("ask_2", 2);
  assert.deepEqual(queue(), ["ask_1 line", "ask_2 open", "ask_3 line"]);
});

test("a line says how long its question has waited, and keeps saying so while it is drawn", async () => {
  const [first, second] = await asked(["First?"], ["Second?"]);
  await draw([first, { ...second, shown_at: Date.now() }]);
  const said = () => line("ask_2").textContent?.replace("Second?", "");
  assert.equal(said(), "Waiting: just now");
  await unmount(mounted!);

  mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
  await draw([first, { ...second, shown_at: Date.now() - 4 * MINUTE }]);
  assert.equal(said(), "Waiting: 4 min");
  await act(async () => mock.timers.tick(MINUTE));
  assert.equal(said(), "Waiting: 5 min");
});

test("a line that leaves the screen stops counting its wait", async () => {
  const timers = new Set<unknown>();
  const [start, end] = [globalThis.setInterval, globalThis.clearInterval];
  const started = mock.method(globalThis, "setInterval", (run: () => void, ms: number) => {
    const timer = start(run, ms);
    timers.add(timer);
    return timer;
  });
  const ended = mock.method(globalThis, "clearInterval", (timer: ReturnType<typeof setInterval>) => {
    timers.delete(timer);
    end(timer);
  });
  try {
    await draw(await asked(["First?"], ["Second?"], ["Third?"]));
    assert.equal(timers.size, 2);
    await open("ask_2");
    assert.equal(timers.size, 2);
    await act(async () => viewEntry(mounted!.container, "Repository")!.click());
    assert.equal(timers.size, 0);
  } finally {
    started.mock.restore();
    ended.mock.restore();
  }
});

const WAITING = "4 questions waiting, the most one terminal may have.";

test("four waiting say that they are the most one terminal may have, and fewer do not", async () => {
  const records = await asked(["1?"], ["2?"], ["3?"], ["4?"]);
  await draw(records);
  assert.ok(mounted!.container.textContent?.includes(WAITING));
  assert.deepEqual(queue(), ["ask_1 open", "ask_2 line", "ask_3 line", "ask_4 line"]);

  await answered(records[0]);
  await showView();
  assert.ok(!mounted!.container.textContent?.includes("questions waiting"));
  assert.equal(regions().length, 4);
});
