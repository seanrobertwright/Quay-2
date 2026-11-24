/// <reference types="node" />
// The operator's move of a raw companion surface to a stage tab and back (#727), with only Tauri's
// `invoke` and events faked: the control, where the surface is drawn, and what is kept of it.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import type { MountedStage } from "./fixtures/reviewFixtures.ts";
import { acceptedAsk, called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";
import { arrives, changed } from "./fixtures/surfaceFixtures.ts";
import { acceptedRaw, button, column, create, text, type Component } from "./fixtures/rawFixtures.ts";

const { findButton, mountCompanion, TERMINAL, typeInto, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");
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
  onMove = ({ asTab }) => (list = [changed(list[0], { as_tab: asTab as boolean })])[0];
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

/** Loads the page with the companion and the stage on it, on the Surface view, where a request to show a surface shows its tab. */
async function load(): Promise<void> {
  loadSurfaces();
  companion = await mountCompanion(TERMINAL);
  stage = await mountStage([TERMINAL]);
  stopRequests = onSurfaceRequest((key) => {
    requests.push(key.id);
    stage!.openNow(key);
  });
  await act(async () => viewEntry(companion!.container, "Surface")?.click());
  await settle();
}

const inCompanion = () => companion!.container.querySelector<HTMLElement>('section[data-surface="plan"]');
const inTab = () => frame(stage!.container);
const move = (section: HTMLElement | null, label: string) => [...(section?.querySelectorAll("header button") ?? [])].find((b) => b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;

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
  const moved = onMove;
  onMove = (args) => (refuse ? Promise.reject("Not moved: Quay no longer has this surface.") : moved(args));
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
  list = [ask, await acceptedReview("review_1", undefined, "t1", 2), await plan({ id: "tab", place: "tab", title: "A raw tab", order: 3 }), changed(await plan({ id: "locked" }), { ended_at: 1 })];
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
