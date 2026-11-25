/// <reference types="node" />
// The operator's move of a raw companion surface to a stage tab and back (#727), with only Tauri's
// `invoke` and events faked: the control, where the surface is drawn, and what is kept of it.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import type { MountedStage } from "./fixtures/reviewFixtures.ts";
import { acceptedAsk, called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";
import { arrives, changed, moved } from "./fixtures/surfaceFixtures.ts";
import { acceptedRaw, button, column, create, text, type Component } from "./fixtures/rawFixtures.ts";

const { companion: companionAsked, earlierButton, findButton, lockedLine, mountCompanion, openLocked, TERMINAL, typeInto, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");
const { acceptedReview, frame, mountStage, openTab, tab, tabs } = await import("./fixtures/reviewFixtures.ts");
const { line, strip, opened } = await import("./fixtures/boardFixtures.ts");
const { mount, unmount: unmountPage } = await import("./fixtures/surfaceFixtures.ts");
const { onSurfaceRequest } = await import("./surfaceRequests.ts");

const TO_TAB = "Open as a stage tab";
const BACK = "Send back to the companion";

let list: SurfaceRecord[];
let unsent: unknown[];
/** What Rust does with a move. */
let onMove: (args: Record<string, unknown>) => unknown;
let companion: Mounted | null = null;
let stage: MountedStage | null = null;
let stopRequests = () => {};
/** The surfaces that were asked to be shown. */
let requests: string[];

beforeEach(() => {
  list = [];
  unsent = [];
  requests = [];
  onMove = ({ asTab }) => (list = [moved(list[0], asTab as boolean)])[0];
  startRust({ surface_list: () => list, surface_checks: () => [], surface_open_page: () => ({ page: 1, unsent }), surface_move: (args) => onMove(args) });
});
afterEach(async () => {
  stopRequests();
  for (const mounted of [companion, stage]) if (mounted) await unmount(mounted);
  companion = null;
  stage = null;
  await unmountPage();
  unloadSurfaces();
});

const FIELD: Component = { id: "name", component: "TextField", label: "Name", value: { "@path": "/name" } };

/** A surface with a field and a button that sends what is in it. */
function plan(over: Partial<SurfaceRecord> = {}): Promise<SurfaceRecord> {
  const [go, label] = button("go", { event: { name: "send", context: { name: { "@path": "/name" } } } });
  return acceptedRaw([create([...column(text("said", "Hello"), FIELD, go), label], { dataModel: { name: "" } })], over);
}

let seq = 0;

/** Shows the surface `id` in the companion, as Quay's window does when it is asked to. */
function showInCompanion(id: string): void {
  seq += 1;
  selectInCompanion(TERMINAL, id);
}

/** Selects `terminal` in the companion, whose last request was for the surface `id`. */
const selectInCompanion = (terminal: TerminalInfo, id: string) =>
  companion!.root.render(companionAsked(terminal, { terminalId: "t1", view: "surface", surfaceId: id, moved: true, seq }));

/** Loads the page with the companion and the stage on it, on the Surface view, where a request to show a surface shows it where it is drawn. */
async function load(): Promise<void> {
  loadSurfaces();
  companion = await mountCompanion(TERMINAL);
  stage = await mountStage([TERMINAL]);
  stopRequests = onSurfaceRequest((key) => {
    requests.push(key.id);
    if (!stage!.openNow(key)) showInCompanion(key.id);
  });
  await act(async () => viewEntry(companion!.container, "Surface")?.click());
  await settle();
}

const inCompanion = () => companion!.container.querySelector<HTMLElement>('section[data-surface="plan"]');
const inTab = () => frame(stage!.container);
const move = (section: HTMLElement | null, label: string) => [...(section?.querySelectorAll("header button") ?? [])].find((b) => b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;

/** The button of the tab bar's menu of locked surfaces, if there are any. */
const earlierTabs = () => [...stage!.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Earlier ("));

async function moveTo(section: HTMLElement | null, label: string): Promise<void> {
  await act(async () => move(section, label)!.click());
  await settle();
}

test("the move icon opens a raw companion surface as a tab and back, with what was typed in it", async () => {
  list = [await plan()];
  await load();
  await until(() => (inCompanion()?.querySelector("input") ?? null) !== null, "it was never drawn");
  await typeInto(inCompanion()!.querySelector("input")! as never, "Ada");
  assert.equal(tabs(stage!.container).length, 0);

  await moveTo(inCompanion(), TO_TAB);
  assert.deepEqual(called("surface_move"), [{ terminalId: "t1", id: "plan", asTab: true }]);
  await until(() => (inTab()?.querySelector("input") ?? null) !== null, "its tab is not in front");
  assert.deepEqual([inTab()!.querySelector("input")!.value, inCompanion() === null], ["Ada", true]);
  assert.equal(inTab()!.contains(document.activeElement), true, "the focus goes with it");
  assert.ok(tab(stage!.container, "Migration plan")!.getAttribute("aria-label")!.includes("waiting on you"));

  await typeInto(inTab()!.querySelector("input")! as never, "Ada L");
  await moveTo(inTab(), BACK);
  assert.deepEqual(called("surface_move")[1], { terminalId: "t1", id: "plan", asTab: false });
  await until(() => (inCompanion()?.querySelector("input") ?? null) !== null, "it is not back");
  assert.deepEqual([inCompanion()!.querySelector("input")!.value, tabs(stage!.container).length], ["Ada L", 0]);
  assert.deepEqual(requests, ["plan", "plan"]);

  await act(async () => findButton(inCompanion()!, "Press go")!.click());
  await settle();
  const [sent] = called("surface_answer") as { revision: number; answer: { action: { context: object } } }[];
  assert.deepEqual([sent.revision, sent.answer.action.context], [1, { name: "Ada L" }]);
  assert.equal(called("surface_dismiss").length, 0);
});

/** Moves the surface back to the companion, which is asked to show it once its tab has gone, as in Quay's window. `between` runs between the two. */
async function sendBack(between: () => void): Promise<void> {
  stopRequests();
  let asked = "";
  stopRequests = onSurfaceRequest(({ id }) => (asked = id));
  await moveTo(inTab(), BACK);
  assert.equal(asked, "plan");
  between();
  await act(async () => showInCompanion(asked));
  await settle();
}

test("the focus goes back with it from the stage, which has taken it as the tab left", async () => {
  list = [await plan({ as_tab: true })];
  await load();
  await openTab(stage!.container, "Migration plan");
  let onStage = false;
  await sendBack(() => (onStage = document.activeElement?.textContent === "Launch Terminal"));
  assert.equal(onStage, true);
  assert.equal(inCompanion()!.contains(document.activeElement), true);
});

test("the focus stays where the operator has taken it while the surface went back", async () => {
  list = [await plan({ as_tab: true })];
  await load();
  await openTab(stage!.container, "Migration plan");
  const elsewhere = companion!.container.querySelector("button")!;
  await sendBack(() => elsewhere.focus());
  assert.equal(document.activeElement === elsewhere, true);
});

test("a surface that is asked for, and was not moved, leaves the focus on the stage", async () => {
  list = [await plan()];
  await load();
  const launch = findButton(stage!.container, "Launch Terminal")!;
  launch.focus();
  await act(async () => companion!.root.render(companionAsked(TERMINAL, { terminalId: "t1", view: "surface", surfaceId: "plan", seq: (seq += 1) })));
  await settle();
  assert.equal(document.activeElement === launch, true);
});

test("what was typed is sent before it moves, and a reload draws it where it was moved to with that", async () => {
  list = [await plan()];
  await load();
  await until(() => (inCompanion()?.querySelector("input") ?? null) !== null, "it was never drawn");
  await typeInto(inCompanion()!.querySelector("input")! as never, "Ada");
  await moveTo(inCompanion(), TO_TAB);
  const [save] = called("surface_save_unsent") as { unsent: { revision: number; values: object } }[];
  assert.deepEqual([save.unsent.revision, save.unsent.values], [1, { "/name": "Ada" }]);

  stopRequests();
  for (const mounted of [companion!, stage!]) await unmount(mounted);
  unsent = [{ terminal_id: "t1", id: "plan", order: list[0].order, revision: 1, values: { "/name": "Ada" } }];
  await load();
  assert.equal(inCompanion() === null, true);
  await openTab(stage!.container, "Migration plan");
  assert.equal(inTab()!.querySelector("input")!.value, "Ada");
});

test("the companion leaves the Surface view when the surface that asks is moved, and a chip opens it in its tab", async () => {
  list = [await plan()];
  await load();
  const view = () => companion!.container.querySelector<HTMLElement>("[data-companion-view]")?.dataset.companionView;
  assert.equal(view(), "surface");
  await moveTo(inCompanion(), TO_TAB);
  assert.notEqual(view(), "surface");
  await stage!.showTerminals();
  assert.equal(await stage!.open({ terminal_id: "t1", id: "plan" }), true);
  assert.equal(inTab() !== null, true);
});

test("a moved surface keeps to its tab through an update", async () => {
  list = [await plan({ as_tab: true })];
  await load();
  await openTab(stage!.container, "Migration plan");
  await arrives(changed(list[0], { revision: 2 }));
  assert.deepEqual([inTab() !== null, inCompanion() === null, move(inTab(), BACK) !== undefined], [true, true, true]);
});

test("a move that is not made says why, and can be tried again", async () => {
  list = [await plan()];
  await load();
  let refuse = true;
  const moves = onMove;
  onMove = (args) => (refuse ? Promise.reject("Not moved: Quay no longer has this surface.") : moves(args));
  await moveTo(inCompanion(), TO_TAB);
  assert.equal(inCompanion()!.querySelector('[role="alert"]')!.textContent, "Not moved: Quay no longer has this surface.");
  assert.deepEqual([requests, tabs(stage!.container).length], [[], 0]);
  refuse = false;
  await moveTo(inCompanion(), TO_TAB);
  assert.equal(inTab() !== null, true);
});

test("a second click while it moves moves nothing more", async () => {
  list = [await plan()];
  await load();
  await act(async () => {
    const control = move(inCompanion(), TO_TAB)!;
    control.click();
    control.click();
  });
  await settle();
  assert.equal(called("surface_move").length, 1);
});

test("no other surface has the control", async () => {
  const ask = await acceptedAsk("ask_1", { questions: [{ question: "One?", options: [], multiple: false }] });
  const controls = (container: HTMLElement) => [...container.querySelectorAll("button")].filter((b) => [TO_TAB, BACK].includes(b.getAttribute("aria-label") ?? "")).length;
  list = [ask, await acceptedReview("review_1", undefined, "t1", 2), await plan({ id: "tab", place: "tab", title: "A raw tab", order: 3 })];
  await load();
  await openTab(stage!.container, "A raw tab");
  assert.equal(controls(stage!.container), 0);
  await openTab(stage!.container, "Plan: pair");
  assert.deepEqual([controls(stage!.container), controls(companion!.container)], [0, 0]);

  list = [await acceptedRaw([create(column(text("said", "Hello")))], { place: "strip" })];
  stopRequests();
  for (const mounted of [companion!, stage!]) await unmount(mounted);
  companion = null;
  stage = null;
  loadSurfaces();
  await settle();
  const pane = await mount(strip());
  await settle();
  await act(async () => line(pane, "plan")!.click());
  await settle();
  assert.deepEqual([opened(pane) !== null, controls(pane)], [true, 0]);
});

test("a moved surface that is answered folds among the tabs", async () => {
  list = [await plan({ as_tab: true })];
  await load();
  const answer = { version: "1.0", action: { name: "send", surfaceId: "plan", sourceComponentId: "go", timestamp: "", context: {} } };
  await arrives(changed(list[0], { answer, answered_at: 1 }));
  assert.equal(tabs(stage!.container).length, 0);
  assert.equal(companion!.container.querySelectorAll("[data-earlier]").length, 0);
  assert.ok([...stage!.container.querySelectorAll("button")].some((b) => b.textContent === "Earlier (1)"));
});

test("a locked surface moves too, with what was typed in it, and comes back open under Earlier", async () => {
  list = [changed(await plan(), { ended_at: 1 })];
  unsent = [{ terminal_id: "t1", id: "plan", order: list[0].order, revision: 1, values: { "/name": "Ada" } }];
  await load();
  await openLocked(companion!.container, "plan");

  await moveTo(inCompanion(), TO_TAB);
  assert.deepEqual(called("surface_move"), [{ terminalId: "t1", id: "plan", asTab: true }]);
  assert.deepEqual([inTab() !== null, inCompanion() === null, earlierButton(companion!.container) === undefined], [true, true, true]);
  assert.equal(inTab()!.textContent!.includes("The terminal exited before this was answered.") && inTab()!.textContent!.includes("Ada"), true);
  assert.equal(inTab()!.contains(document.activeElement), true, "the focus goes with it");

  await moveTo(inTab(), BACK);
  assert.deepEqual(called("surface_move")[1], { terminalId: "t1", id: "plan", asTab: false });
  assert.deepEqual([tabs(stage!.container).length, earlierButton(companion!.container)?.getAttribute("aria-expanded")], [0, "true"]);
  assert.equal(inCompanion()!.textContent!.includes("Ada"), true);
  assert.equal(inCompanion()!.contains(document.activeElement), true, "the focus goes back with it");

  await act(async () => lockedLine(companion!.container, "plan").click());
  assert.equal(inCompanion() === null, true, "it folds again");
  assert.deepEqual(requests, ["plan", "plan"]);
});

test("a move leaves a locked surface where it stood among the locked ones, in the companion and on the tab bar", async () => {
  const older = changed(await plan({ id: "older", title: "Older" }), { ended_at: 1 });
  const newer = changed(await plan({ id: "newer", title: "Newer" }), { ended_at: 2 });
  list = [moved(moved(older, true), false), newer];
  await load();
  await act(async () => earlierButton(companion!.container)!.click());
  const locked = () => [...companion!.container.querySelectorAll<HTMLElement>("[data-locked]")].map(({ dataset }) => dataset.locked);
  assert.deepEqual(locked(), ["newer", "older"]);

  for (const record of [newer, list[0]]) await arrives(moved(record, true));
  const menu = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent!.match(/Older|Newer/)?.[0]);
  await act(async () => earlierTabs()!.click());
  assert.deepEqual(menu(), ["Newer", "Older"]);
});

test("a surface that was asked for while it was live does not open Earlier once it locks", async () => {
  list = [await plan(), await plan({ id: "other", order: 1000 })];
  await load();
  await act(async () => showInCompanion("plan"));
  await settle();
  await arrives(changed(list[0], { answer: { version: "1.0" }, answered_at: 1 }));
  const isEarlierOpen = () => earlierButton(companion!.container)?.getAttribute("aria-expanded");
  assert.equal(isEarlierOpen(), "false");

  for (const terminal of [{ ...TERMINAL, id: "t2" }, TERMINAL]) {
    await act(async () => selectInCompanion(terminal, "plan"));
    await settle();
  }
  assert.equal(isEarlierOpen(), "false", "nor when its terminal is selected again");
});
