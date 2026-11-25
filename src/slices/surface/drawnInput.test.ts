/// <reference types="node" />
// What the operator puts in a surface, and what an update makes of one that is drawn, held to what a surface
// may have drawn (#765), with only Tauri's `invoke` and events faked. Each is bounded: without the limit it is
// drawn in a few seconds, and the test fails.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { CreateSurface, SurfaceRecord } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import { loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";
import { click, put } from "./fixtures/catalogFixtures.ts";
import { acceptedRaw, button, create, EVENT, listOf, rows, text, times, type Component } from "./fixtures/rawFixtures.ts";
import { arrives, changed, unmount as unmountPage } from "./fixtures/surfaceFixtures.ts";

const { mountCompanion, TERMINAL, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");

const NOT_PUT_IN = "Not put in: the surface would have more components than Quay draws.";

let list: SurfaceRecord[];
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

/** Loads the page on the companion's Surface view, with the surface `record` that `its` is unsent in. */
async function open(record: SurfaceRecord, its: Record<string, unknown> | null = null): Promise<HTMLElement> {
  list = [record];
  unsent = its ? [{ terminal_id: record.terminal_id, id: record.id, order: record.order, revision: record.revision, values: its }] : [];
  loadSurfaces();
  mounted = await mountCompanion(TERMINAL);
  const { container } = mounted;
  await act(async () => viewEntry(container, "Surface")?.click());
  await until(() => container.querySelector("a2ui-react-button") !== null, "the surface was never drawn");
  return container;
}

/** `record` as its agent's update left it, with other components and data. */
function updated(record: SurfaceRecord, components: Component[], dataModel: Record<string, unknown>): SurfaceRecord {
  const revision = record.revision + 1;
  const state = { version: "1.0", createSurface: { ...record.state.createSurface, components, dataModel } } as CreateSurface;
  return changed(record, { revision, state });
}

/** Lets a surface that has just been drawn be drawn again. */
async function redrawn(): Promise<void> {
  for (let i = 0; i < 16; i += 1) await settle();
}

const asks = button("go", EVENT);
const root = (...children: string[]): Component => ({ id: "root", component: "Column", children: [...children, "go"] });

const drawn = (container: HTMLElement, type: string): number => container.querySelectorAll(`a2ui-react-${type}`).length;
const notice = (container: HTMLElement): string | null => container.querySelector("section[data-surface] [role=alert]")?.textContent ?? null;

const picker: Component = { id: "pick", component: "ChoicePicker", variant: "multipleSelection", value: { "@path": "/picked" }, options: times(9, (i) => ({ label: `Option ${i}`, value: `${i}` })) };

/** A list of what is picked, in a list of it, four deep. */
const ofPicked = [root("pick", "l1"), picker, listOf("l1", "l2", "/picked"), listOf("l2", "l3", "/picked"), listOf("l3", "l4", "/picked"), listOf("l4", "leaf", "/picked"), text("leaf", "x"), ...asks];

const boxes = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
const ticked = (container: HTMLElement) => boxes(container).filter((box) => box.checked).length;

test("a choice that a list is drawn of is not taken once there would be more than Quay draws, and that is said", { timeout: 60_000 }, async () => {
  const container = await open(await acceptedRaw([create(ofPicked, { dataModel: { picked: [] } })]));
  for (let i = 0; i < 6; i += 1) await click(boxes(container)[i]);
  // The Texts of six in six in six in six, and the button's label
  assert.deepEqual([ticked(container), drawn(container, "text"), notice(container)], [6, 1297, null]);
  await click(boxes(container)[6]);
  await settle();
  assert.deepEqual([ticked(container), drawn(container, "text"), notice(container)], [6, 1297, NOT_PUT_IN]);
  await click(boxes(container)[0]);
  await settle();
  assert.deepEqual([ticked(container), drawn(container, "text"), notice(container)], [5, 626, null]);
});

test("a text that is drawn again and again is held to the limit by its length", { timeout: 60_000 }, async () => {
  const field: Component = { id: "name", component: "TextField", label: "Name", value: { "@path": "/name" } };
  const container = await open(await acceptedRaw([create([root("name", "all"), field, listOf("all", "leaf", "/rows"), text("leaf", { "@path": "/name" }), ...asks], { dataModel: { name: "Ada", rows: rows(99) } })]));
  const input = container.querySelector<HTMLInputElement>("a2ui-react-textfield input")!;
  const said = () => container.querySelector("a2ui-react-column a2ui-react-column a2ui-react-text")?.textContent;
  await put(input, "x".repeat(4000));
  assert.deepEqual([input.value.length, said()?.length, notice(container)], [4000, 4000, null]);
  await put(input, "x".repeat(6000));
  await settle();
  assert.deepEqual([input.value.length, said()?.length, notice(container)], [4000, 4000, NOT_PUT_IN]);
});

test("what is unsent is put back where the surface can be drawn with it, and left out where it cannot", { timeout: 60_000 }, async () => {
  const accepted = () => acceptedRaw([create(ofPicked, { dataModel: { picked: [] } })]);
  const container = await open(await accepted(), { "/picked": ["0", "1", "2"] });
  assert.deepEqual([ticked(container), drawn(container, "text")], [3, 82]);
  await unmount(mounted!);
  mounted = null;
  unloadSurfaces();
  const other = await open(await accepted(), { "/picked": ["0", "1", "2", "3", "4", "5", "6"] });
  assert.deepEqual([ticked(other), drawn(other, "text")], [0, 1]);
});

test("an update is drawn as it is accepted, with what the operator put in where there is room for it", { timeout: 60_000 }, async () => {
  const plain = [root("pick", "l1"), picker, listOf("l1", "leaf", "/picked"), text("leaf", "x"), ...asks];
  const record = await acceptedRaw([create(plain, { dataModel: { picked: [] } })]);
  const container = await open(record);
  for (const box of boxes(container)) await click(box);
  assert.deepEqual([ticked(container), drawn(container, "text")], [9, 10]);
  await arrives(updated(record, ofPicked, { picked: [] }));
  await redrawn();
  assert.deepEqual([ticked(container), drawn(container, "text")], [0, 1]);
});

test("an update leaves the rows of a long list that were shown as they are, also where its components cannot be replaced in steps", { timeout: 60_000 }, async () => {
  const table = (last: unknown): Component[] => [
    root("all"),
    listOf("all", "row", "/rows"),
    { id: "row", component: "Row", children: ["a", "b", "c"] },
    text("a", { "@path": "a" }),
    text("b", { "@path": "b" }),
    text("c", last),
    ...asks,
  ];
  // 9600 components in its rows, each drawn by the data of its row
  const data = (c: string) => ({ rows: times(2400, (i) => ({ a: `a${i}`, b: "b", c })) });
  const record = await acceptedRaw([create(table({ "@path": "c" }), { dataModel: data("first") })]);
  const container = await open(record);
  await click(container.querySelector<HTMLElement>("section[data-surface] span[role=button]")!);
  const row = container.querySelector("a2ui-react-row")!;
  const seen = (said: string) => [drawn(container, "row"), row.isConnected, container.textContent!.includes(`a0b${said}`)];
  assert.deepEqual(seen("first"), [200, true, true]);
  const later = updated(record, table({ "@path": "c" }), data("second"));
  await arrives(later);
  await redrawn();
  assert.deepEqual(seen("second"), [200, true, true]);
  await arrives(updated(later, table("third"), data("second")));
  await redrawn();
  assert.deepEqual(seen("third"), [200, true, true]);
});

test("a list that an input would make longer, by where in it the input is, is held to the limit", { timeout: 60_000 }, async () => {
  const box = (id: string, at: number): Component => ({ id, component: "CheckBox", label: id, value: { "@path": `/rows/${at}/on` } });
  const components = [root("near", "far", "l1"), box("near", 20), box("far", 9000), listOf("l1", "l2", "/rows"), listOf("l2", "leaf", "/rows"), text("leaf", { "@path": "on" }), ...asks];
  const container = await open(await acceptedRaw([create(components, { dataModel: { rows: [] } })]));
  const [near, far] = boxes(container);
  await click(far);
  await settle();
  assert.deepEqual([far.checked, notice(container)], [false, NOT_PUT_IN]);
  await click(near);
  await settle();
  assert.deepEqual([near.checked, notice(container)], [true, null]);
});
