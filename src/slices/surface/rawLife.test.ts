/// <reference types="node" />
// A raw surface over its life in the window (#727), with only Tauri's `invoke` and events faked: what an
// update leaves of what the operator put in, and how one that is opened again or withdrawn looks.
import { emitEvent } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { CreateSurface, SurfaceRecord } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import { acceptedAsk, called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";
import { arrives, changed, mount, unmount as unmountPage } from "./fixtures/surfaceFixtures.ts";
import { acceptedRaw, button, column, create, text, type Component } from "./fixtures/rawFixtures.ts";

const { earlierButton, findButton, lockedLine, mountCompanion, openLocked, TERMINAL, typeInto, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");
const { line, strip, opened } = await import("./fixtures/boardFixtures.ts");
const { frame, mountStage, openTab, tab, tabs } = await import("./fixtures/reviewFixtures.ts");
const { formatClock } = await import("../../lib/dates.ts");

const MINUTE = 60_000;
const SENT_AT = Date.UTC(2026, 10, 24, 19, 42, 5);
const REOPENED_AT = Date.UTC(2026, 10, 24, 19, 58, 9);

let list: SurfaceRecord[];
let unsent: unknown[];
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  unsent = [];
  startRust({ surface_list: () => list, surface_checks: () => [], surface_open_page: () => ({ page: 1, unsent }) });
});
afterEach(async () => {
  mock.timers.reset();
  if (mounted) await unmount(mounted);
  mounted = null;
  await unmountPage();
  unloadSurfaces();
});

const FIELD: Component = { id: "name", component: "TextField", label: "Name", value: { "@path": "/name" } };
const NOTE: Component = { id: "note", component: "TextField", label: "Note", value: { "@path": "/note" } };

/** A surface with two fields and a button that sends what is in them, whose text says `said`. */
function form(said: string): Component[] {
  const [go, label] = button("go", { event: { name: "send", context: { name: { "@path": "/name" }, note: { "@path": "/note" } } } });
  return [...column(text("said", said), FIELD, NOTE, go), label];
}

const formRecord = (over: Partial<SurfaceRecord> = {}) => acceptedRaw([create(form("First"), { dataModel: { name: "", note: "" } })], over);

/** `record` as its agent's update left it: it says `said`, and the update set `data`. */
function updated(record: SurfaceRecord, said: string, data: Record<string, unknown> = {}, over: Partial<SurfaceRecord> = {}): SurfaceRecord {
  const revision = record.revision + 1;
  const { createSurface } = record.state;
  const components = createSurface.components.map((component) => (component.id === "said" ? { ...component, text: said } : component));
  const state: CreateSurface = { version: "1.0", createSurface: { ...createSurface, components, dataModel: { ...createSurface.dataModel, ...data } } };
  const set = { ...record.carried.set, ...Object.fromEntries(Object.keys(data).map((key) => [`/${key}`, revision])) };
  return changed(record, { revision, state, carried: { ...record.carried, set }, updated_at: Date.now(), ...over });
}

/** Shows the Surface view, which the companion leaves when nothing asks any more. */
const showSurfaces = (container: HTMLElement) => act(async () => viewEntry(container, "Surface")?.click());

/** Loads the page on the companion's Surface view. */
async function openSurfaces(): Promise<HTMLElement> {
  loadSurfaces();
  mounted = await mountCompanion(TERMINAL);
  const { container } = mounted;
  await showSurfaces(container);
  await until(() => !container.textContent?.includes("Loading"), "the surface was never drawn");
  return container;
}

const regions = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("section[data-surface]")];
const region = (container: HTMLElement, id = "plan") => regions(container).find((section) => section.dataset.surface === id)!;
const content = (container: HTMLElement, id?: string) => region(container, id).querySelector<HTMLElement>("[data-surface-content]")!;
const fields = (container: HTMLElement) => [...content(container).querySelectorAll("input")];
const values = (container: HTMLElement) => fields(container).map(({ value }) => value);
const saves = () => called("surface_save_unsent").map(({ unsent: save }) => save as { order: number; revision: number; values: object });

/** `arrives`, with what a surface just drawn holds back drawn as well. */
async function arrivesAndIsDrawn(record: SurfaceRecord): Promise<void> {
  await arrives(record);
  await until(() => regions(mounted!.container).length > 0, "nothing is drawn");
  await heldBack();
}

/** Lets a surface that has just been drawn be drawn again. */
async function heldBack(): Promise<void> {
  for (let i = 0; i < 16; i += 1) await settle();
}

test("an update is drawn in place, and the field the operator is in keeps what they typed and the focus", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  const [name] = fields(container);
  name.focus();
  await typeInto(name as never, "Ad");

  await arrivesAndIsDrawn(updated(record, "Second", { note: "from the agent" }));
  assert.ok(content(container).textContent!.includes("Second") && !content(container).textContent!.includes("First"));
  assert.deepEqual(values(container), ["Ad", "from the agent"]);
  assert.equal(document.activeElement === name && name.isConnected, true, "the operator types on");
  await typeInto(name as never, "Ada");
  await act(async () => findButton(content(container), "Press go")!.click());
  await settle();
  const [sent] = called("surface_answer") as { revision: number; answer: { action: { context: object } } }[];
  assert.deepEqual([sent.revision, sent.answer.action.context], [2, { name: "Ada", note: "from the agent" }]);
});

test("an update that takes away the tab the operator picked draws the first one, and any other pick stays", async () => {
  const tabs = (...ids: string[]): Component => ({ id: "tabs", component: "Tabs", tabs: ids.map((id) => ({ title: `Tab ${id}`, child: id })) });
  const parts = (shown: string[], rest: string[]): Component[] => [
    { id: "root", component: "Column", children: ["tabs", ...rest] },
    tabs(...shown),
    ...["a", "b", "c"].map((id) => text(id, `In ${id}`)),
  ];
  const [go, label] = button("go", { event: { name: "send", context: {} } });
  const withButton = ([root, ...others]: Component[]): Component[] => [{ ...root, children: [...(root.children as string[]), "go"] }, ...others, go, label];
  const pressed = (container: HTMLElement) => [...content(container).querySelectorAll('[aria-pressed="true"]')].map(({ textContent }) => textContent);
  for (const [pick, drawn, gone] of [["Tab c", "Tab a", "In b"], ["Tab b", "Tab b", "In a"]]) {
    const record = await acceptedRaw([create(withButton(parts(["a", "b", "c"], [])))]);
    list = [record];
    const container = await openSurfaces();
    await act(async () => findButton(content(container), pick)!.click());
    const { createSurface } = (await acceptedRaw([create(withButton(parts(["a", "b"], ["c"])))])).state;
    await arrivesAndIsDrawn(changed(record, { revision: 2, state: { version: "1.0", createSurface } }));
    assert.deepEqual(pressed(container), [drawn]);
    const said = content(container).textContent!;
    assert.deepEqual([said.includes(drawn.replace("Tab", "In")), said.includes(gone)], [true, false], pick);
    await unmount(mounted!);
    mounted = null;
  }
});

test("what the operator typed at a path the update sets is gone, also at one under it or that holds it", async () => {
  const record = await acceptedRaw([create([...column(text("said", "First"), FIELD, { ...NOTE, value: { "@path": "/deep/note" } })], { dataModel: { name: "", deep: { note: "" } } })]);
  const cases: [Record<string, number>, string[]][] = [
    [{ "/name": 2 }, ["agent's", "typed note"]],
    [{ "/deep": 2 }, ["typed name", "agent's"]],
    [{ "/deep/note/more": 2 }, ["typed name", "agent's"]],
    [{ "/dee": 2, "/nam": 2, "/deep/not": 2 }, ["typed name", "typed note"]],
    [{ "/": 2 }, ["agent's", "agent's"]],
    [{ "/name": 1 }, ["typed name", "typed note"]],
  ];
  for (const [set, kept] of cases) {
    list = [record];
    const container = await openSurfaces();
    await typeInto(fields(container)[0] as never, "typed name");
    await typeInto(fields(container)[1] as never, "typed note");
    const { createSurface } = record.state;
    const state = { version: "1.0" as const, createSurface: { ...createSurface, dataModel: { name: "agent's", deep: { note: "agent's" } } } };
    await arrivesAndIsDrawn(changed(record, { revision: 2, state, carried: { from: 1, set } }));
    assert.deepEqual(values(container), kept, JSON.stringify(set));
    await unmount(mounted!);
    mounted = null;
  }
});

test("what was typed up to an update is sent as of the revision it was typed in, and what is typed on as of the new one", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  await typeInto(fields(container)[0] as never, "Ada");
  await arrivesAndIsDrawn(updated(record, "Second", { note: "x" }));
  assert.deepEqual(saves().map(({ revision, values: saved }) => [revision, saved]), [[1, { "/name": "Ada" }]]);

  await typeInto(fields(container)[1] as never, "y");
  window.dispatchEvent(new Event("pagehide"));
  const last = saves()[saves().length - 1];
  assert.deepEqual([last.order, last.revision, last.values], [record.order, 2, { "/name": "Ada", "/note": "y" }]);
});

test("an update that comes while the surface is off the screen keeps what was typed", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  await typeInto(fields(container)[0] as never, "Ada");
  await act(async () => viewEntry(container, "Repository")!.click());
  await arrives(updated(record, "Second", { note: "x" }));
  await act(async () => viewEntry(container, "Surface")!.click());
  await settle();
  assert.deepEqual([values(container), content(container).textContent!.includes("Second")], [["Ada", "x"], true]);
});

test("updates that come fast are drawn a few times a second, end on the last, and drop what any of them set", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  await typeInto(fields(container)[0] as never, "Ada");
  await typeInto(fields(container)[1] as never, "a note");
  let last = record;
  for (let i = 1; i <= 20; i += 1) {
    last = updated(last, `Take ${i}`, i === 7 ? { note: "seven" } : {});
    await act(async () => emitEvent("surface-changed", last));
  }
  const early = content(container).textContent!;
  assert.ok(early.includes("Take 1") && !early.includes("Take 20"), early.slice(0, 80));
  await until(() => content(container).textContent!.includes("Take 20"), "it does not end on the last");
  assert.deepEqual(values(container), ["Ada", "seven"]);
  assert.equal(saves().length, 1, "what was typed is sent once, as of what it was typed in");
});

test("an answer that settles a surface is drawn at once, though an update has just been", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  const second = updated(record, "Second");
  await arrives(second);
  await arrives(updated(second, "Third"));
  const answer = { version: "1.0", action: { name: "send", surfaceId: "plan", sourceComponentId: "go", timestamp: "", context: {} } };
  await arrives(changed(second, { answer, answered_at: SENT_AT }));
  await showSurfaces(container);
  assert.equal(earlierButton(container)?.textContent, "Earlier (1)");
  await heldBack();
  assert.equal(earlierButton(container)?.textContent, "Earlier (1)", "the update that was held back is older");
});

/** Loads the page on the Surface view while what is unsent is still read, has `meanwhile` come, and lets that finish. */
async function openMeanwhile(held: unknown[], meanwhile: SurfaceRecord): Promise<HTMLElement> {
  unloadSurfaces();
  let opened = () => {};
  const opening = new Promise<void>((resolve) => (opened = resolve));
  startRust({ surface_list: () => list, surface_checks: () => [], surface_open_page: () => opening.then(() => ({ page: 1, unsent: held })) });
  loadSurfaces();
  await settle();
  await arrives(meanwhile);
  opened();
  mounted = await mountCompanion(TERMINAL);
  const { container } = mounted;
  await showSurfaces(container);
  await until(() => region(container) !== undefined && fields(container).length > 0, "the surface was never drawn");
  return container;
}

test("what Rust held before an update that comes while the page loads is drawn, but for what the update set", async () => {
  const record = await formRecord();
  const second = updated(record, "Second", { note: "x" });
  list = [second];
  const held = [{ terminal_id: "t1", id: "plan", order: record.order, revision: 1, values: { "/name": "Ada", "/note": "gone" } }];
  assert.deepEqual(values(await openMeanwhile(held, second)), ["Ada", "x"]);
});

test("what Rust holds of a later revision than the one that came while the page loads is drawn with it", async () => {
  const record = await formRecord();
  list = [updated(record, "Second", { note: "x" })];
  const held = [{ terminal_id: "t1", id: "plan", order: record.order, revision: 2, values: { "/name": "Ada" } }];
  const container = await openMeanwhile(held, record);
  assert.deepEqual([values(container), content(container).textContent!.includes("Second")], [["Ada", "x"], true]);
});

test("a surface that was replaced whole starts with nothing of what was typed in the one before it", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  await typeInto(fields(container)[0] as never, "Ada");
  await arrivesAndIsDrawn(updated(record, "Second", {}, { carried: { from: 2, set: {} } }));
  assert.deepEqual([values(container), content(container).textContent!.includes("Second")], [["", ""], true]);
});

test("a replacement with components of its own is drawn, and what it left out is gone", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  const state: CreateSurface = { version: "1.0", createSurface: { ...record.state.createSurface, components: column(text("new", "All new")) as never, dataModel: {} } };
  await arrivesAndIsDrawn(changed(record, { revision: 2, state, carried: { from: 2, set: {} } }));
  assert.equal(content(container).textContent, "Migration planAll new");
});

test("an update may change what a component is, add some, and name an image", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  await typeInto(fields(container)[1] as never, "a note");
  const { createSurface } = record.state;
  const components = createSurface.components.map((component) => {
    if (component.id === "name") return { id: "name", component: "Text", text: "No field now" };
    return component.id === "root" ? { ...component, children: ["said", "name", "note", "go", "more"] } : component;
  });
  const state = { ...record.state, createSurface: { ...createSurface, components: [...components, { id: "more", component: "Text", text: "And more" }] } };
  await arrivesAndIsDrawn(changed(record, { revision: 2, state }));
  const said = content(container).textContent!;
  assert.ok(said.includes("No field now") && said.includes("And more"), said);
  assert.deepEqual(values(container), ["a note"]);
});

const answerOf = (name: string) => ({ version: "1.0", action: { name: "send", surfaceId: "plan", sourceComponentId: "go", timestamp: "2026-11-24T19:42:05Z", context: { name } } });

/** `record`, answered. */
const settled = (record: SurfaceRecord, name = "Ada") => changed(record, { answer: answerOf(name), answered_at: SENT_AT });

/** `record`, which was answered, as its agent's update opened it again. */
function reopened(record: SurfaceRecord, said = "Again"): SurfaceRecord {
  const next = updated(record, said, {}, { answer: null, answered_at: null, reopened: { at: REOPENED_AT, answer: answerOf("Ada"), answered_at: SENT_AT } });
  return { ...next, order: next.change, carried: { from: next.revision, set: {} } };
}

test("a surface that is opened again says so with the earlier answer and the times, and takes an answer", async () => {
  const record = await formRecord();
  list = [settled(record)];
  const container = await openSurfaces();
  await arrives(reopened(list[0]));
  const band = region(container).querySelector<HTMLElement>("[data-reopened]")!;
  const said = band.textContent!.replace(/\s+/g, " ");
  assert.ok(said.startsWith(`Reopened by the agent, ${formatClock(REOPENED_AT)}. You sent at ${formatClock(SENT_AT)}:`), said);
  assert.ok(said.includes("send") && said.includes("nameAda"), said);
  assert.equal(band.closest("[data-surface-content]") === null, true, "it is Quay's, in no reach of the content");
  assert.equal(earlierButton(container) === undefined || earlierButton(container) === null, true);

  await typeInto(fields(container)[0] as never, "Bob");
  await act(async () => findButton(content(container), "Press go")!.click());
  await settle();
  const [sent] = called("surface_answer") as { revision: number; answer: { action: { context: object } } }[];
  assert.deepEqual([sent.revision, sent.answer.action.context], [2, { name: "Bob", note: "" }]);
});

test("a surface that was never answered has no such band", async () => {
  list = [await formRecord()];
  const container = await openSurfaces();
  assert.equal(container.querySelectorAll("[data-reopened]").length, 0);
});

test("a surface that is opened again asks for attention, at the end of the queue, and moves no question the operator is on", async () => {
  const record = await formRecord();
  const ask = await acceptedAsk("ask_1", { questions: [{ question: "One?", options: [], multiple: false }] }, "t1", record.order + 1);
  list = [record, { ...ask, change: record.change }];
  const container = await openSurfaces();
  // The operator opened it, and answered it
  await act(async () => findButton(region(container, "ask_1"), "One?")?.click());
  await act(async () => region(container, "plan").querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
  await arrives(settled(record));
  assert.equal(region(container, "ask_1").querySelector("header") !== null, true);

  mock.timers.enable({ apis: ["Date"], now: REOPENED_AT + 12 * MINUTE });
  await arrives({ ...reopened(settled(record)), shown_at: SENT_AT - 60 * MINUTE });
  assert.deepEqual(regions(container).map((section) => section.dataset.surface), ["ask_1", "plan"]);
  assert.equal(region(container, "ask_1").querySelector("header") !== null, true, "the question the operator is on stays open");
  const folded = region(container, "plan");
  assert.equal(folded.querySelector("header") === null && /Waiting: 12 min$/.test(folded.textContent!), true, folded.textContent!);
});

test("a companion that shows another view goes to a surface that is opened again", async () => {
  const record = await formRecord();
  list = [settled(record)];
  loadSurfaces();
  mounted = await mountCompanion(TERMINAL);
  const { container } = mounted;
  const view = () => container.querySelector<HTMLElement>("[data-companion-view]")?.dataset.companionView;
  assert.notEqual(view(), "surface");
  await arrives(reopened(list[0]));
  assert.equal(view(), "surface");
});

test("a tab the operator is on stays in front when its surface is opened again", async () => {
  const record = await formRecord({ place: "tab" });
  list = [record];
  loadSurfaces();
  mounted = await mountStage([TERMINAL]);
  const { container } = mounted;
  await openTab(container, "Migration plan");
  const answered = settled(record);
  await arrives(answered);
  assert.ok(frame(container)!.textContent!.includes("Answered and sent to the agent."));

  await arrives(reopened(answered));
  await until(() => frame(container)?.textContent?.includes("Again") ?? false, "its tab is not in front");
  assert.equal(frame(container)!.querySelectorAll("[data-reopened]").length, 1);
  assert.equal(tabs(container).length, 1);
  assert.ok(tab(container, "Migration plan")!.getAttribute("aria-label")!.endsWith(", waiting on you"));
});

test("a tab of a later surface by the same id is another tab", async () => {
  const record = await formRecord({ place: "tab" });
  list = [record];
  loadSurfaces();
  mounted = await mountStage([TERMINAL]);
  await openTab(mounted.container, "Migration plan");
  await act(async () => emitEvent("surface-removed", { terminal_id: "t1", id: "plan" }));
  await arrives(await formRecord({ place: "tab" }));
  assert.equal(frame(mounted.container) === null && tabs(mounted.container).length === 1, true);
});

test("a withdrawn surface says so, keeps what was typed with Copy, and takes nothing", async () => {
  const record = await formRecord();
  list = [record];
  const container = await openSurfaces();
  await typeInto(fields(container)[0] as never, "half a thought");
  await arrives(changed(record, { withdrawn_at: REOPENED_AT }));
  await showSurfaces(container);

  assert.equal(earlierButton(container)?.textContent, "Earlier (1)");
  await openLocked(container, "plan");
  const line = lockedLine(container, "plan")!;
  assert.ok(line.textContent!.startsWith("Withdrawn: Migration plan") && line.textContent!.endsWith(formatClock(REOPENED_AT)), line.textContent!);
  const band = region(container).textContent!;
  assert.ok(band.includes("Withdrawn by the agent before you answered.") && band.includes(formatClock(REOPENED_AT)));
  assert.deepEqual([...content(container).querySelectorAll("dl div")].map((row) => row.textContent), ["Namehalf a thought"]);
  assert.ok(content(container).textContent!.startsWith("Migration plan") && findButton(content(container), "Copy"));
  assert.deepEqual(saves().map(({ values: saved }) => saved), [{ "/name": "half a thought" }]);
  await act(async () => findButton(region(container), "What was shown")!.click());
  await until(() => findButton(region(container), "Press go") !== undefined, "what was shown is gone");
  await act(async () => findButton(region(container), "Press go")!.click());
  await settle();
  assert.equal(called("surface_answer").length, 0);
});

test("a withdrawn question keeps what was typed in it, and its icon is no other state's", async () => {
  const ask = await acceptedAsk("ask_1", { questions: [{ question: "One?", options: [], multiple: false }] });
  const record = await formRecord({ order: 2 });
  list = [changed(ask, { withdrawn_at: 1 }), changed(record, { ended_at: 1 }), changed(settled({ ...record, id: "other" }), { order: 3 })];
  unsent = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "half a thought" } }];
  const container = await openSurfaces();
  await openLocked(container, "ask_1");
  assert.ok(content(container, "ask_1").textContent!.startsWith("One?"));
  assert.deepEqual([...content(container, "ask_1").querySelectorAll("dl div dd")].map((row) => row.textContent), ["half a thought"]);
  const icons = [...container.querySelectorAll("[data-locked] > button svg")].map((icon) => icon.getAttribute("class"));
  assert.equal(new Set(icons).size, 3, String(icons));
});

test("a withdrawn tab folds under Earlier on the tab bar with its state", async () => {
  const record = await formRecord({ place: "tab" });
  list = [record];
  loadSurfaces();
  mounted = await mountStage([TERMINAL]);
  const { container } = mounted;
  await arrives(changed(record, { withdrawn_at: REOPENED_AT }));
  assert.equal(tabs(container).length, 0);
  const earlier = [...container.querySelectorAll("button")].find((b) => b.textContent === "Earlier (1)")!;
  await act(async () => earlier.click());
  assert.ok(document.body.textContent!.includes("Withdrawn"));
});

test("a raw strip says when it was last updated, and opened it shows the latest", async () => {
  const record = await acceptedRaw([create(column(text("said", "First")))], { place: "strip", shown_at: Date.now() - 60 * MINUTE });
  list = [record];
  loadSurfaces();
  await settle();
  const container = await mount(strip());
  await settle();
  assert.ok(line(container, "plan")!.textContent!.endsWith("updated 1 h ago"));
  await act(async () => line(container, "plan")!.click());
  await until(() => opened(container)?.textContent?.includes("First") ?? false, "it was never drawn");
  await arrives(updated(record, "Second"));
  assert.ok(line(container, "plan")!.textContent!.endsWith("updated just now"));
  await until(() => opened(container)?.textContent?.includes("Second") ?? false, "the update was never drawn");
});


