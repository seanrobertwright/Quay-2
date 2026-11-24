/// <reference types="node" />
// What the operator has put in a question and not sent (#719), with only Tauri's `invoke` faked: when
// the webview sends it to Rust, and that it is there again when the question is.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { GivenVerdict, Mounted } from "./fixtures/askFixtures.ts";

const { startSurfaces } = await import("./surfaceHost.ts");
const { acceptedAsk, companion, findButton: button, mountCompanion, settle, TERMINAL, typeInto, unmount, until, viewEntry } = await import("./fixtures/askFixtures.ts");

/** A save, as the webview sends it. */
interface Save {
  terminalId: string;
  id: string;
  unsent: { page: number; save: number; order: number; revision: number; values: Record<string, unknown> };
}

let list: SurfaceRecord[];
/** What Rust holds for a page that loads. */
let held: object[];
let pages: number;
let verdicts: GivenVerdict[];
let saves: Save[];
/** What `surface_open_page` waits for. */
let opening: Promise<void>;
let stop: (() => void) | null = null;
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  held = [];
  pages = 0;
  verdicts = [];
  saves = [];
  opening = Promise.resolve();
  fakeInvoke(async (cmd, args) => {
    if (cmd === "surface_verdict") verdicts.push(args as GivenVerdict);
    if (cmd === "surface_save_unsent") saves.push(structuredClone(args) as unknown as Save);
    if (cmd === "surface_open_page") return opening.then(() => ({ page: (pages += 1), unsent: structuredClone(held) }));
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

const BASE = {
  question: "Which base should this branch take?",
  options: [{ label: "Rebase onto master", recommended: true }, { label: "Merge master in", recommended: false }],
  multiple: false,
};
const NAME = { question: "What should the branch be called?", options: [], multiple: false };

/** The surface `id` that asks `questions`, as Rust holds it once the webview has accepted it. */
async function asked(id: string, questions: unknown[], over: { terminal?: string; order?: number } = {}): Promise<SurfaceRecord> {
  stop ??= startSurfaces();
  await settle();
  return acceptedAsk({ questions }, verdicts, { id, ...over });
}

/** Loads the page on `terminal`'s Surface view, with `records` in Rust's list. */
async function load(records: SurfaceRecord[], terminal = TERMINAL): Promise<void> {
  if (mounted) await unmount(mounted);
  stop?.();
  list = structuredClone(records);
  stop = startSurfaces();
  mounted = await mountCompanion(terminal);
  await view("Surface");
  await until(() => region() !== null && !region()!.textContent?.includes("Loading"), "the surface was never drawn");
}

const region = () => mounted!.container.querySelector<HTMLElement>("[data-surface]");
const box = () => region()!.querySelector("textarea")!;
const type = (text: string) => typeInto(box(), text);
const click = (element: HTMLElement | undefined) => act(async () => element!.click());

/** Shows the companion view `name`. */
async function view(name: string): Promise<void> {
  await act(async () => viewEntry(mounted!.container, name)?.click());
  await settle();
}

/** From here on time passes only as `pass` says, but for `settle` and `until`. Drawing a question begins a pause, so it comes first. */
const stopTheClock = () => mock.timers.enable({ apis: ["setTimeout"] });
const pass = (ms: number) => act(async () => mock.timers.tick(ms));

test("what is typed is sent 400 ms after the last change, as what differs from the accepted state", async () => {
  const record = await asked("ask_1", [BASE], { order: 7 });
  stopTheClock();
  await load([record]);

  await type("half a");
  await pass(399);
  await type("half a thought");
  await pass(399);
  assert.deepEqual(saves, []);
  await pass(1);
  assert.deepEqual(saves, [
    { terminalId: "t1", id: "ask_1", unsent: { page: 2, save: 1, order: 7, revision: 1, values: { "/answers/0/text": "half a thought" } } },
  ]);
  await pass(5_000);
  assert.equal(saves.length, 1, "once");
});

test("leaving the screen sends it at once, and nothing is sent after", async () => {
  stopTheClock();
  await load([await asked("ask_1", [BASE])]);
  await type("half a thought");
  await act(async () => viewEntry(mounted!.container, "Repository")!.click());
  assert.deepEqual(saves.map(({ unsent }) => unsent.values), [{ "/answers/0/text": "half a thought" }]);
  await pass(5_000);
  assert.equal(saves.length, 1, "the timer went with it");
});

test("a page that goes sends it at once", async () => {
  stopTheClock();
  await load([await asked("ask_1", [BASE])]);
  await type("half a thought");
  window.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(saves.map(({ unsent }) => unsent.values), [{ "/answers/0/text": "half a thought" }]);
});

test("a question nothing was put in sends nothing, and one that is as it was sends that", async () => {
  stopTheClock();
  await load([await asked("ask_1", [BASE, NAME])]);
  await pass(5_000);
  await act(async () => viewEntry(mounted!.container, "Repository")!.click());
  assert.equal(saves.length, 0);

  await act(async () => viewEntry(mounted!.container, "Surface")!.click());
  await type("half a thought");
  await pass(400);
  await type("");
  await pass(400);
  await act(async () => viewEntry(mounted!.container, "Repository")!.click());
  assert.deepEqual(saves.map(({ unsent }) => [unsent.save - saves[0].unsent.save, unsent.values]), [[0, { "/answers/0/text": "half a thought" }], [1, {}]]);
});

/** What Rust holds of the saves it was sent: the last of each surface. */
const heldOfSaves = () =>
  [...new Map(saves.map((save) => [`${save.terminalId} ${save.id}`, save])).values()].map(({ terminalId, id, unsent: { order, revision, values } }) => ({ terminal_id: terminalId, id, order, revision, values }));

const rows = () => [...region()!.querySelectorAll<HTMLButtonElement>("li > button[aria-expanded]")];
const picked = () => [...region()!.querySelectorAll<HTMLInputElement>("input")].filter((input) => input.checked).map((input) => input.labels?.[0]?.textContent);
const send = () => button(region()!, "Send")!;

test("a reload draws the question with what was chosen, typed and opened, and the same one open", async () => {
  const record = await asked("ask_1", [BASE, NAME, BASE]);
  await load([record]);
  await click(region()!.querySelectorAll<HTMLInputElement>("input")[1]);
  await type("after CI");
  await click(rows()[2]);
  await click(region()!.querySelectorAll<HTMLInputElement>("input")[0]);
  await click(rows()[1]);
  await type("fix/719");
  window.dispatchEvent(new Event("pagehide"));
  held = heldOfSaves();
  saves = [];

  await load([record]);
  assert.deepEqual(rows().map((row) => row.getAttribute("aria-expanded")), ["false", "true", "false"]);
  assert.equal(box().value, "fix/719");
  assert.ok(region()!.textContent?.includes("3 of 3 answered") && !send().disabled);
  await click(rows()[0]);
  assert.deepEqual([picked(), box().value], [["Merge master in"], "after CI"]);
  await click(rows()[2]);
  assert.deepEqual([picked(), box().value], [["Rebase onto master"], ""]);

  // A change after the reload is saved as this page's, with all that was there before
  await view("Repository");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].unsent.page, pages);
  assert.equal(saves[0].unsent.values["/answers/1/text"], "fix/719");
});

test("a question a reload draws as it was is not saved again", async () => {
  const record = await asked("ask_1", [BASE]);
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "half a thought" } }];
  await load([record]);
  assert.equal(box().value, "half a thought");
  await view("Repository");
  assert.deepEqual(saves, []);
});

/** Rust sends `record`, changed by `over`. */
const changes = (record: SurfaceRecord, over: Partial<SurfaceRecord>) => act(async () => emitEvent("surface-changed", { ...record, change: record.change + 100, ...over }));
const leaves = ({ terminal_id, id }: SurfaceRecord) => act(async () => emitEvent("surface-removed", { terminal_id, id }));

test("nothing is sent for a question that was answered or has left meanwhile", async () => {
  const record = await asked("ask_1", [BASE]);
  stopTheClock();
  for (const over of [() => changes(record, { answer: { answers: [] }, answered_at: 1 }), () => leaves(record)]) {
    await load([record]);
    await type("half a thought");
    await over();
    await pass(5_000);
    window.dispatchEvent(new Event("pagehide"));
  }
  assert.deepEqual(saves, []);
});

test("a question with the id of one that left starts empty", async () => {
  const record = await asked("ask_1", [BASE]);
  await load([record]);
  await type("half a thought");
  await view("Repository");
  await leaves(record);
  await changes(record, { order: 50 });
  await view("Surface");
  assert.equal(box().value, "");

  // The same when its going was never heard of
  await type("the other half");
  await view("Repository");
  await changes(record, { order: 60, change: 900 });
  await view("Surface");
  assert.equal(box().value, "");
});

test("what is unsent shows in its own question of its own terminal, and nowhere else", async () => {
  const [mine, other] = [await asked("ask_1", [BASE], { order: 1 }), await asked("ask_1", [BASE], { terminal: "t2", order: 2 })];
  const T2 = { ...TERMINAL, id: "t2", name: "docs" };
  await load([mine, other]);
  await type("for t1");
  await act(async () => mounted!.root.render(companion(T2)));
  await settle();
  assert.equal(box().value, "");
  await type("for t2");
  await act(async () => mounted!.root.render(companion(TERMINAL)));
  await settle();
  assert.equal(box().value, "for t1");
  assert.deepEqual(saves.map(({ terminalId, unsent }) => [terminalId, unsent.order, unsent.values]), [
    ["t1", 1, { "/answers/0/text": "for t1" }],
    ["t2", 2, { "/answers/0/text": "for t2" }],
  ]);

  held = heldOfSaves();
  await load([mine, other]);
  assert.equal(box().value, "for t1");
  await load([mine, other], T2);
  assert.equal(box().value, "for t2");
});

test("what is unsent is there when Rust sends the question again while it is off screen", async () => {
  const record = await asked("ask_1", [BASE]);
  await load([record]);
  await type("half a thought");
  await view("Repository");
  await changes(record, {});
  await view("Surface");
  assert.equal(box().value, "half a thought");
});

test("what Rust holds for another surface of that id, or another revision, is not drawn", async () => {
  const record = await asked("ask_1", [BASE], { order: 3 });
  const values = { "/answers/0/text": "another's" };
  for (const read of [{ order: 2, revision: 1 }, { order: 3, revision: 2 }]) {
    held = [{ terminal_id: "t1", id: "ask_1", ...read, values }];
    await load([record]);
    assert.equal(box().value, "");
  }
});

test("a question that comes while the page loads is drawn once what is unsent is known", async () => {
  const record = await asked("ask_1", [BASE]);
  stop!();
  let opened = () => {};
  opening = new Promise((resolve) => (opened = resolve));
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "half a thought" } }];
  list = [record];
  stop = startSurfaces();
  mounted = await mountCompanion(TERMINAL);
  await changes(record, {});
  await view("Surface");
  assert.equal(region()!.querySelectorAll("textarea").length, 0);

  opened();
  await until(() => region()?.querySelector("textarea") !== null, "the question was never drawn");
  assert.equal(box().value, "half a thought");
});

test("a question is drawn, and nothing of it saved, when what is unsent could not be read", async () => {
  const record = await asked("ask_1", [BASE]);
  opening = Promise.reject(new Error("no such command"));
  const logged: unknown[] = [];
  const { error } = console;
  console.error = (...args) => void logged.push(args[0]);
  try {
    await load([record]);
  } finally {
    console.error = error;
  }
  assert.deepEqual(logged, ["[surfaces] What was not sent could not be read"]);
  await type("half a thought");
  await view("Repository");
  await view("Surface");
  assert.equal(box().value, "half a thought");
  assert.equal(saves.length, 0);
});

test("what Rust held of a surface that was replaced while the page loaded does not keep the new one from being saved", async () => {
  const record = await asked("ask_1", [BASE]);
  stop!();
  let opened = () => {};
  opening = new Promise((resolve) => (opened = resolve));
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "for the old one" } }];
  stop = startSurfaces();
  await settle();
  await changes(record, { order: 5 });
  opened();
  mounted = await mountCompanion(TERMINAL);
  await view("Surface");
  await until(() => region()?.querySelector("textarea") !== null, "the question was never drawn");
  assert.equal(box().value, "");
  await type("for the new one");
  await view("Repository");
  assert.deepEqual(saves.map(({ unsent }) => [unsent.order, unsent.values]), [[5, { "/answers/0/text": "for the new one" }]]);
});
