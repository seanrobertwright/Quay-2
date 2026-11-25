/// <reference types="node" />
// How much a surface may have drawn (#765): what the check that Rust asks for rejects. Each call here is one
// that a check without the limit would accept in a bounded time. The worst calls are in
// `drawnWorst.budget.ts`.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Accepted } from "./surfaceTypes.ts";
import { create, errorsIn, text, told, verdictOnRaw, type Component } from "./fixtures/rawFixtures.ts";
import { startRust, unloadSurfaces, verdictOn, verdicts } from "./fixtures/fakeRust.ts";

beforeEach(() => startRust({ surface_list: () => [], surface_checks: () => [] }));
afterEach(() => unloadSurfaces());

const rows = (count: number, row: unknown = 0): unknown[] => Array.from({ length: count }, () => row);

/** A container of one `child` for each item at `path`. */
const list = (id: string, child: string, path: string): Component => ({ id, component: "Column", children: { componentId: child, path } });

test("a template in a template over one short list, three deep, is rejected by how much it would draw", async () => {
  const nested = [list("root", "outer", "/rows"), list("outer", "inner", "/rows"), list("inner", "leaf", "/rows"), text("leaf", "x")];
  // 1 + 30 + 900 + 27000
  assert.deepEqual(told(await errorsIn([create(nested, { dataModel: { rows: rows(30) } })])), [
    ["VALIDATION_FAILED", "/messages/0/createSurface", "A surface has at most 2000 components drawn at once; this one would have 27931."],
    ["VALIDATION_FAILED", "/messages/0/createSurface", "A surface has at most 10000 components with every row drawn; this one would have 27931."],
  ]);
});

/** A container of these children, which may be named more than once. */
const holds = (id: string, ...children: string[]): Component => ({ id, component: "Column", children });

const named = (count: number, child: string): string[] => Array.from({ length: count }, () => child);

const tooMany = (count: number | string) => `A surface has at most 2000 components drawn at once; this one would have ${count}.`;
const tooManyRows = (count: number | string) => `A surface has at most 10000 components with every row drawn; this one would have ${count}.`;

/** What these components are rejected for, over these data. */
const said = async (components: Component[], dataModel: object = {}) => told(await errorsIn([create(components, { dataModel })])).map(([, , message]) => message);

/** Whether a surface of these components is accepted, over these data. */
async function accepts(components: Component[], dataModel: object = {}): Promise<boolean> {
  return "state" in (await verdictOnRaw([create(components, { dataModel })]));
}

test("a component that several parents name, many levels deep, counts each time it is drawn", async () => {
  const shared = Array.from({ length: 14 }, (_, i) => holds(i === 0 ? "root" : `c${i}`, ...named(2, `c${i + 1}`)));
  // Two of each at every level: 2^0 + 2^1 + ... + 2^14
  assert.deepEqual(await said([...shared, text("c14", "x")]), [tooMany(32767), tooManyRows(32767)]);
  // Past what is counted
  const deepest = Array.from({ length: 40 }, (_, i) => holds(i === 0 ? "root" : `c${i}`, ...named(2, `c${i + 1}`)));
  const farthest = await said([...deepest, text("c40", "x")]);
  assert.deepEqual(farthest, [tooMany("at least 1000000000"), tooManyRows("at least 1000000000")]);
  // By two parents, and not twice by one
  const crossed = Array.from({ length: 10 }, (_, i) => [holds(`a${i}`, `a${i + 1}`, `b${i + 1}`), holds(`b${i}`, `a${i + 1}`, `b${i + 1}`)]).flat();
  assert.deepEqual(await said([holds("root", "a0", "b0"), ...crossed, text("a10", "x"), text("b10", "x")]), [tooMany(4095)]);
});

test("a surface at the limit is accepted, and one component past it is rejected", async () => {
  // A root, 37 lists of 53 Texts, and a Text: 1 + 37 * 54 + 1
  const most = (...last: string[]) => [holds("root", ...named(37, "list"), ...last), list("list", "leaf", "/rows"), text("leaf", "x"), text("last", "x")];
  assert.equal(await accepts(most("last"), { rows: rows(53) }), true);
  assert.deepEqual(await said(most("last", "last"), { rows: rows(53) }), [tooMany(2001)]);
});

test("of a long list, a hundred rows and what shows more are drawn at once, and all of its rows are counted too", async () => {
  const lists = (count: number) => [holds("root", ...named(count, "list")), list("list", "leaf", "/rows"), text("leaf", "x")];
  assert.equal(await accepts(lists(1), { rows: rows(9998) }), true);
  assert.deepEqual(await said(lists(1), { rows: rows(9999) }), [tooManyRows(10001)]);
  assert.equal(await accepts(lists(19), { rows: rows(101) }), true);
  assert.deepEqual(await said(lists(20), { rows: rows(101) }), [tooMany(1 + 20 * 102)]);
  // As is one whose components are named one by one
  assert.equal(await accepts([holds("root", ...named(9999, "leaf")), text("leaf", "x")]), true);
  assert.deepEqual(await said([holds("root", ...named(10_000, "leaf")), text("leaf", "x")]), [tooManyRows(10001)]);
});

test("a row that holds a list of its own counts by its own data, also one that is drawn only once more are shown", async () => {
  const ofRows = [list("root", "row", "/rows"), list("row", "leaf", "items"), text("leaf", "x")];
  // Nothing in the first hundred rows, and 25 in each of the next: their page is 100 rows of 26 and what shows more
  const late = [...rows(100, {}), ...rows(100, { items: rows(25) })];
  assert.deepEqual(await said(ofRows, { rows: late }), [tooMany(1 + 1 + 100 * 26)]);
  assert.equal(await accepts(ofRows, { rows: [...rows(100, {}), ...rows(100, { items: rows(18) })] }), true);
  // Rows in rows, by a path through both: 100 rows of 100 cells
  const nested = { rows: rows(100, { items: rows(100) }) };
  assert.deepEqual(await said(ofRows, nested), [tooManyRows("more than 10000")]);
});

test("of a Tabs one is drawn at a time, the largest counted, and all of them with every row", async () => {
  const tabs = (...children: string[]): Component => ({ id: "tabs", component: "Tabs", tabs: children.map((child) => ({ title: child, child })) });
  const sheets = [list("a", "leaf", "/a"), list("b", "leaf", "/b"), text("leaf", "x")];
  const data = (a: number, b: number) => ({ a: rows(a), b: rows(b) });
  const inner = [holds("root", "tabs"), tabs("a", "b")];
  assert.equal(await accepts([...inner, ...sheets], data(99, 90)), true);
  assert.deepEqual(await said([...inner, ...sheets], data(9000, 1000)), [tooManyRows(1 + 1 + 2 + 9001 + 1001)]);
});

test("each option, step and tab that a component draws counts, a hundred options or steps at once", async () => {
  const options = (count: number): Component => ({ id: "leaf", component: "ChoicePicker", value: [], options: Array.from({ length: count }, (_, i) => ({ label: "x", value: `${i}` })) });
  const steps = (written: unknown): Component => ({ id: "leaf", component: "Steps", steps: written });
  const step = { label: "x", state: "done" };
  const each = (leaf: Component) => [list("root", "leaf", "/rows"), leaf];
  for (const leaf of [options(120), steps(rows(120, step)), steps({ "@path": "/steps" })]) {
    const data = (count: number) => ({ rows: rows(count), steps: rows(120, step) });
    assert.equal(await accepts(each(leaf), data(19)), true, String(leaf.component));
    // Each is itself, a hundred of what it draws, and what shows more
    assert.deepEqual(await said(each(leaf), data(20)), [tooMany(1 + 20 * 102)], String(leaf.component));
  }
  const ofRow = each(steps({ "@path": "steps" }));
  // And the data the rows are told apart by: 20 of 1805 characters
  assert.deepEqual(await said(ofRow, { rows: rows(20, { steps: rows(120, step) }) }), [tooMany(1 + 20 * 102 + 3)]);
  assert.equal(await accepts(ofRow, { rows: [...rows(19, { steps: rows(120, step) }), {}, { steps: 5 }] }), true);
});

test("text counts by its length where it is drawn again and again, or comes from the data", async () => {
  // Eleven times 250 characters, and some more
  const big = "Some prose of a common kind. ".repeat(100);
  const twice = (leaf: Component) => [holds("root", "a", "b"), list("a", "leaf", "/rows"), list("b", "leaf", "/rows"), leaf];
  const all = 1 + 2 * (1 + 90 * 12);
  for (const leaf of [
    text("leaf", big),
    text("leaf", { "@path": "/big" }),
    text("leaf", { "@call": "formatString", args: { value: "${/big}" } }),
    text("leaf", { "@call": "formatString", args: { value: "${formatString(value:'${/big}')}" } }),
    { id: "leaf", component: "Stat", label: "x", value: { "@path": "/big" } },
  ]) {
    assert.deepEqual(await said(twice(leaf), { big, rows: rows(90) }), [tooMany(all)], JSON.stringify(leaf).slice(0, 80));
  }
  assert.deepEqual(await said(twice(text("leaf", { "@path": "text" })), { rows: rows(88, { text: big }) }), [tooMany(1 + 2 * (1 + 88 * 12 + 25))]);
  // What an action is sent with is not drawn
  const button: Component[] = [{ id: "leaf", component: "Button", child: "label", action: { event: { name: "go", context: { big: { "@path": "/big" } } } } }, text("label", "x")];
  assert.equal(await accepts([...twice(button[0]), button[1]], { big, rows: rows(90) }), true);
});

test("text that is written once and drawn once does not count, nor does a list of short texts count for more", async () => {
  const pages = Array.from({ length: 400 }, (_, i) => text(`t${i}`, "x".repeat(4000)));
  assert.equal(await accepts([holds("root", ...pages.map(({ id }) => String(id))), ...pages]), true);
  // A whole data model in one Text, and one shown row by row
  assert.equal(await accepts([holds("root", "leaf"), text("leaf", { "@path": "/big" })], { big: "x".repeat(250_000) }), true);
  const found = { rows: rows(100, { text: "x".repeat(2300) }) };
  assert.equal(await accepts([list("root", "leaf", "/rows"), text("leaf", { "@path": "text" })], found), true);
  assert.equal(await accepts([list("root", "row", "/rows"), { id: "row", component: "Row", children: named(19, "leaf") }, text("leaf", "x".repeat(249))], { rows: rows(99) }), true);
});

test("what the engine names each component by counts, and so do the data that a row is told by", async () => {
  const id = "x".repeat(5000);
  // Fifty times a hundred characters, for each of the 201 components under it
  const under = [holds("root", id), list(id, "leaf", "/rows"), text("leaf", "x")];
  assert.deepEqual(await said(under, { rows: rows(201) }), [tooManyRows(1 + 1 + 201 + 50 * 201)]);
  const path = "y".repeat(5000);
  assert.deepEqual(await said([list("root", "leaf", `/${path}`), text("leaf", "x")], { [path]: rows(201) }), [tooManyRows(1 + 201 + 50 * 201)]);
  // Two rows of a hundred thousand characters, in each of a hundred lists
  const large = { lists: rows(100), rows: rows(2, "z".repeat(100_000)) };
  assert.deepEqual(await said([list("root", "list", "/lists"), list("list", "leaf", "/rows"), text("leaf", "x")], large), [tooMany(1 + 100 * (1 + 2 + 20))]);
});

test("what an update would make of a surface is held to the limit, and a rejected one is told by its name", async () => {
  const held = { place: "companion" as const, state: (await verdictOnRaw([create([holds("root", "list"), list("list", "leaf", "/rows"), text("leaf", "x")], { dataModel: { rows: rows(40) } })]) as Accepted).state };
  const told = async (messages: unknown[]) => {
    const verdict = await verdictOn({ call: verdicts().length + 1, tool: "quay_surface", surface_id: "", arguments: { messages }, held: [held] });
    return "errors" in verdict ? verdict.errors : "surfaces" in verdict ? verdict.surfaces.length : verdict;
  };
  const components = [list("list", "more", "/rows"), list("more", "leaf", "/rows")];
  const nest = { version: "1.0", updateComponents: { surfaceId: "plan", components } };
  const data = (count: number) => ({ version: "1.0", updateDataModel: { surfaceId: "plan", path: "/rows", value: rows(count) } });
  // 1 + 1 + 40 * 41
  assert.equal(await told([nest]), 1);
  const error = (path: string, message: string) => ({ code: "VALIDATION_FAILED", surfaceId: "plan", path, message });
  assert.deepEqual(await told([nest, data(50)]), [error("/messages/1/updateDataModel", tooMany(1 + 1 + 50 * 51))]);
  // A step on the way that is past the limit is drawn nowhere
  assert.equal(await told([data(50), nest, data(40)]), 1);
});

test("a template that is its own ancestor is refused by the engine, before anything is counted", async () => {
  const data = { rows: [{ rows: [{ rows: [] }] }] };
  const cycles = [
    [list("root", "root", "rows")],
    [holds("root", "a"), list("a", "b", "rows"), holds("b", "a")],
    [holds("root", "a", "a"), holds("a", "b", "b"), holds("b", "a", "a")],
  ];
  for (const components of cycles) {
    const errors = await errorsIn([create(components, { dataModel: data })]);
    assert.deepEqual(errors.map(({ code }) => code), ["RECURSION_LIMIT_EXCEEDED"], JSON.stringify(components));
  }
});
