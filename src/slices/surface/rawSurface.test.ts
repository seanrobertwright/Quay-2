/// <reference types="node" />
// A raw surface in the window (#725), with only Tauri's `invoke` and events faked: what the operator sees
// and sends in the companion's Surface view and on the pane's strip, live and locked.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import { called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";
import { arrives, changed, mount, unmount as unmountPage } from "./fixtures/surfaceFixtures.ts";
import { acceptedRaw, button, column, create, EVENT, oneButton, text, type Component } from "./fixtures/rawFixtures.ts";

const { earlierButton, findButton, mountCompanion, openLocked, TERMINAL, typeInto, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");
const { line, lines, strip, opened } = await import("./fixtures/boardFixtures.ts");
const { frame, mountStage, openTab, tabs } = await import("./fixtures/reviewFixtures.ts");
const { tabOf } = await import("./fixtures/catalogFixtures.ts");

const MINUTE = 60_000;

let list: SurfaceRecord[];
/** What was unsent when the page loaded. */
let unsent: unknown[];
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  unsent = [];
  startRust({ surface_list: () => list, surface_checks: () => [], surface_open_page: () => ({ page: 1, unsent }) });
});
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  await unmountPage();
  unloadSurfaces();
});

/** Loads the page on `terminal`'s companion. */
async function open(terminal: TerminalInfo = TERMINAL): Promise<HTMLElement> {
  loadSurfaces();
  mounted = await mountCompanion(terminal);
  return mounted.container;
}

/** `open`, on the Surface view. */
async function openSurfaces(): Promise<HTMLElement> {
  const container = await open();
  await act(async () => viewEntry(container, "Surface")?.click());
  await until(() => !container.textContent?.includes("Loading"), "the surface was never drawn");
  return container;
}

const region = (container: HTMLElement, id = "plan") => [...container.querySelectorAll<HTMLElement>("section[data-surface]")].find((section) => section.dataset.surface === id)!;
const content = (container: HTMLElement) => region(container).querySelector<HTMLElement>("[data-surface-content]")!;
const view = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-companion-view]")?.dataset.companionView;

const FIELD: Component = { id: "name", component: "TextField", label: "Name", value: { "@path": "/name" } };

/**
 * Whether `element` is disabled as a browser has it: a native form control is also disabled by a disabled
 * fieldset around it, which happy-dom does not apply.
 */
const isDisabled = (element: Element) =>
  element.matches(":disabled") || (element.matches("button, input, select, textarea") && element.closest("fieldset[disabled]") !== null);

test("a raw companion surface is drawn in its frame, its title the content's first line and as it was written", async () => {
  list = [await acceptedRaw([create(column(text("said", "Hello *there*")))], { title: "A <b>plan</b> *x*" })];
  const container = await openSurfaces();
  assert.equal(region(container).getAttribute("aria-label"), "Surface from fix-75");
  assert.ok(!region(container).querySelector("header")!.textContent!.includes("plan"), "Quay's bar holds no word of the agent's");
  assert.equal(content(container).textContent, "A <b>plan</b> *x*Hello there");
  assert.equal(content(container).querySelectorAll("b").length, 0);
  assert.equal(content(container).querySelectorAll("em").length, 1, "its Text is Markdown");
});

test("an action is sent once as the A2UI action message, with its context resolved", async () => {
  const [go, label] = button("go", { event: { name: "approve", context: { name: { "@path": "/name" }, plan: 7 } } });
  list = [await acceptedRaw([create(column(FIELD, go).concat(label), { dataModel: { name: "" } })])];
  const container = await openSurfaces();
  await typeInto(container.querySelector("input")! as never, "Ada");
  await act(async () => {
    findButton(container, "Press go")!.click();
    findButton(container, "Press go")!.click();
  });
  await settle();
  const [sent, ...others] = called("surface_answer") as { answer: { version: string; action: Record<string, unknown> } }[];
  assert.equal(others.length, 0);
  const { timestamp, ...action } = sent.answer.action;
  assert.deepEqual({ ...sent, answer: { ...sent.answer, action } }, {
    terminalId: "t1",
    id: "plan",
    revision: 1,
    answer: { version: "1.0", action: { name: "approve", surfaceId: "plan", sourceComponentId: "go", context: { name: "Ada", plan: 7 } } },
  });
  assert.match(String(timestamp), /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
});

test("a raw companion surface that asks nothing does not switch the view, and one that asks does", async () => {
  const said = await acceptedRaw([create(column(text("said", "Hello")))]);
  const asks = await acceptedRaw([create(oneButton(EVENT))], { id: "other" });
  const container = await open();
  const before = view(container);
  assert.notEqual(before, "surface");

  await arrives(said);
  assert.equal(view(container), before);
  assert.ok(viewEntry(container, "Surface"), "it is there to be opened");
  await arrives(asks);
  assert.equal(view(container), "surface");
});

test("a raw question that waits behind another is a line with its title", async () => {
  list = [await acceptedRaw([create(oneButton(EVENT))], { id: "first", title: "First" }), await acceptedRaw([create(oneButton(EVENT))], { id: "second", title: "Second" })];
  const container = await openSurfaces();
  assert.match(region(container, "second").textContent!, /^Second/);
  assert.ok(region(container, "second").querySelector('button[aria-expanded="false"]'));
});

test("a value bound to data of another kind is drawn as what it reads, or as nothing, and never breaks the surface", async () => {
  const bound = (path: string) => ({ "@path": path });
  const choices: Component = { id: "pick", component: "ChoicePicker", variant: "mutuallyExclusive", label: "Pick", options: [{ label: "A", value: "a" }], value: bound("/object") };
  const components = ["/number", "/flag", "/object", "/list", "/none"].flatMap((path, i): Component[] => [
    text(`text${i}`, bound(path)),
    { id: `stat${i}`, component: "Stat", label: bound(path), value: bound(path) },
    { id: `field${i}`, component: "TextField", label: bound(path), value: bound(path) },
    { id: `check${i}`, component: "CheckBox", label: bound(path), value: bound(path) },
    { id: `file${i}`, component: "FileLink", path: "a.ts", label: bound(path) },
    { id: `bar${i}`, component: "Progress", done: bound(path), total: 7, label: bound(path) },
    { id: `image${i}`, component: "Image", url: bound(path), description: bound(path) },
    { id: `steps${i}`, component: "Steps", steps: bound(path) },
  ]);
  list = [await acceptedRaw([create(column(...components, choices), { dataModel: { number: 3, flag: true, object: { a: 1 }, list: [1] } })])];
  const container = await openSurfaces();
  assert.equal(container.querySelectorAll('[role="alert"]').length, 0);
  assert.ok(content(container).textContent!.startsWith("Migration plan3"));
  const values = [...container.querySelectorAll("input")].filter(({ type }) => type === "text").map(({ value }) => value);
  assert.deepEqual(values, ["3", "true", "", "", ""]);
  assert.ok(!content(container).textContent!.includes("[object"));
});

test("a raw tab goes by its title, never takes the stage, and sends its action from there", async () => {
  list = [await acceptedRaw([create(oneButton(EVENT))], { place: "tab" })];
  loadSurfaces();
  mounted = await mountStage([TERMINAL]);
  const { container } = mounted;
  assert.equal(tabs(container)[0].getAttribute("aria-label"), "Migration plan, surface from fix-75, waiting on you");
  assert.equal(frame(container) === null, true);

  await openTab(container, "Migration plan");
  await until(() => !container.textContent?.includes("Loading"), "it was never drawn");
  assert.equal(frame(container)!.querySelector("[data-surface-content]")!.textContent, "Migration planPress go");
  await act(async () => findButton(frame(container)!, "Press go")!.click());
  await settle();
  const [{ answer }] = called("surface_answer") as { answer: { action: { name: string } } }[];
  assert.equal(answer.action.name, "go");
});

/** Draws the pane's strip. */
async function openStrip(): Promise<HTMLElement> {
  loadSurfaces();
  await settle();
  const container = await mount(strip());
  await settle();
  return container;
}

test("a raw strip arrives folded to its title and when it was updated, and opens over the terminal", async () => {
  const opens = { functionCall: { "@call": "openUrl", args: { url: "https://quay.example" } } };
  list = [await acceptedRaw([create(oneButton(opens))], { place: "strip", title: "Nightly *run*", shown_at: Date.now() - 6 * MINUTE })];
  const container = await openStrip();
  const folded = line(container, "plan")!;
  assert.equal(folded.textContent, "Surface: Nightly *run*updated 6 min ago");
  assert.deepEqual([folded.getAttribute("aria-expanded"), opened(container) === null], ["false", true]);

  await act(async () => folded.click());
  await until(() => !container.textContent!.includes("Loading"), "it was never drawn");
  const frame = opened(container)!;
  assert.equal(frame.getAttribute("aria-label"), "Surface from fix-75");
  assert.equal(frame.querySelector("[data-surface-content]")!.textContent, "Nightly *run*Press go");
  await act(async () => line(container, "plan")!.click());
  assert.equal(opened(container) === null, true);
});

test("a raw strip that has just come says so, and its time is kept true", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
  list = [await acceptedRaw([create(column(text("said", "x")))], { place: "strip", shown_at: Date.now() })];
  const container = await openStrip();
  assert.ok(line(container, "plan")!.textContent!.endsWith("updated just now"));
  await act(async () => t.mock.timers.tick(2 * MINUTE));
  assert.ok(line(container, "plan")!.textContent!.endsWith("updated 2 min ago"));
});

test("a raw strip ends with its terminal: its line says so, and opened it keeps what it showed", async () => {
  list = [await acceptedRaw([create(column(text("said", "Hello")))], { place: "strip" })];
  const container = await openStrip();
  await arrives(changed(list[0], { ended_at: Date.now() }));
  assert.match(line(container, "plan")!.textContent!, /^Surface: Migration planStopped: the terminal exited\.$/);
  assert.equal(lines(container).length, 1);
  await act(async () => line(container, "plan")!.click());
  const frame = opened(container)!;
  assert.ok(frame.textContent!.includes("Stopped: the terminal exited.") && frame.textContent!.includes("Migration plan"));
  await act(async () => findButton(frame, "What was shown")!.click());
  await until(() => frame.textContent!.includes("Hello"), "what it showed is gone");
});

test("an answered raw surface keeps the answer, and folds what was asked with nothing in it to act on", async () => {
  const [go, label] = button("go", { event: { name: "approve", context: { name: { "@path": "/name" }, dropped: ["a", "b"] } } });
  const opens = { "@call": "openUrl", args: { url: "https://quay.example" } };
  const [page, pageLabel] = button("page", { functionCall: opens });
  const components = [...column(FIELD, go, page, text("link", "[x](https://quay.example)")), label, pageLabel, { id: "unused", component: "Text", text: "x" }];
  components[0].children = ["name", "go", "page", "link", "unused"];
  const answer = { version: "1.0", action: { name: "approve", surfaceId: "plan", sourceComponentId: "go", timestamp: "2026-11-24T20:00:00Z", context: { name: "Ada", dropped: ["a", "b"] } } };
  const record = await acceptedRaw([create(components)], { answer, answered_at: 1 });
  list = [record];
  const container = await open();
  await act(async () => viewEntry(container, "Surface")!.click());
  assert.equal(earlierButton(container)?.textContent, "Earlier (1)");
  await openLocked(container, "plan");

  const said = content(container).textContent!;
  assert.ok(said.startsWith("Migration planapprovenameAdadropped[\"a\",\"b\"]"), said);
  assert.ok(region(container).textContent!.includes("Answered and sent to the agent."));
  await act(async () => findButton(region(container), "What was shown")!.click());
  await until(() => findButton(region(container), "Press go") !== undefined, "what was asked is gone");
  const inside = region(container).querySelector("fieldset")!;
  assert.equal(inside.disabled, true);
  assert.equal(inside.querySelectorAll('[role="link"]').length, 0, "no link is left to click");
  await act(async () => findButton(region(container), "Press page")!.click());
  await settle();
  assert.equal(called("plugin:opener|open_url").length + called("surface_answer").length, 0);
});

test("a locked raw surface's tabs still switch, so what each held can be read, and nothing in them can be put in or sent", async () => {
  const [go, label] = button("go", EVENT);
  const tabs: Component = { id: "tabs", component: "Tabs", tabs: [{ title: "Tab a", child: "a" }, { title: "Tab b", child: "b" }] };
  const inB: Component = { id: "b", component: "Column", children: ["name", "go"] };
  const record = await acceptedRaw([create([{ id: "root", component: "Column", children: ["tabs"] }, tabs, text("a", "In a"), inB, FIELD, go, label], { dataModel: { name: "" } })], {
    ended_at: 1,
  });
  list = [record];
  const container = await open();
  await act(async () => viewEntry(container, "Surface")!.click());
  await openLocked(container, "plan");
  await act(async () => findButton(region(container), "What was shown")!.click());
  await until(() => region(container).textContent!.includes("In a"), "what was shown is gone");
  const tab = (name: string) => tabOf(region(container), name);
  assert.equal(isDisabled(tab("Tab b")), false);

  await act(async () => tab("Tab b").click());
  const said = content(container).textContent!;
  assert.deepEqual([said.includes("In a"), said.includes("Press go"), tab("Tab b").getAttribute("aria-pressed")], [false, true, "true"]);
  await act(async () => void tab("Tab a").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.ok(content(container).textContent!.includes("In a"), "a tab is picked by the keyboard too");

  await act(async () => tab("Tab b").click());
  const field = content(container).querySelector("input")!;
  const press = findButton(region(container), "Press go")!;
  assert.deepEqual([isDisabled(field), isDisabled(press)], [true, true]);
  await act(async () => press.click());
  await settle();
  assert.equal(called("surface_answer").length, 0);
});

test("a raw surface that ended keeps what was typed in it, by the field's label", async () => {
  const live = await acceptedRaw([create(column(FIELD), { dataModel: { name: "" } })], { asks: true });
  list = [changed(live, { ended_at: 1 })];
  unsent = [{ terminal_id: "t1", id: "plan", order: live.order, revision: 1, values: { "/name": "Ada", "/pick": ["a"] } }];
  const container = await open();
  await act(async () => viewEntry(container, "Surface")!.click());
  await openLocked(container, "plan");
  assert.deepEqual(
    [...content(container).querySelectorAll("dl div")].map((row) => row.textContent),
    ["NameAda"],
  );
  assert.ok(content(container).textContent!.startsWith("Migration plan"));
});

test("the companion draws a raw surface again from Rust's list after a reload, with what was typed in it", async () => {
  const live = await acceptedRaw([create(column(FIELD), { dataModel: { name: "" } })]);
  list = [live];
  unsent = [{ terminal_id: "t1", id: "plan", order: live.order, revision: 1, values: { "/name": "Ada" } }];
  const container = await openSurfaces();
  assert.equal(container.querySelector("input")!.value, "Ada");
});
