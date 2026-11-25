/// <reference types="node" />
// How long the calls that would draw the most are checked for, and how long a surface at the limit takes from
// its call to the screen (#765). Not a `*.test.ts` file, so it runs by itself (`test:budget`).
import "../../test-support/dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { Worker } from "node:worker_threads";
import type { Told } from "./fixtures/drawnWorker.ts";
import { drawRecord, leavePage, put, startPage, TERMINAL } from "./fixtures/catalogFixtures.ts";
import { acceptedRaw, button, create, EVENT, holds, listOf, rows, text, times, type Component } from "./fixtures/rawFixtures.ts";
import { changed, redraw, settle } from "./fixtures/surfaceFixtures.ts";
import { WORST } from "./fixtures/worstCalls.ts";

const { SurfaceView } = await import("./SurfaceView.tsx");

/** The budget to check a call, on the test machine. Rust waits five seconds for a verdict. */
const CHECK_MS = 2500;

/** The budget from a call to the drawn surface, on the test machine. It leaves out the webview's layout. */
const DRAWN_MS = 3000;

/** How long the worker may be silent, and how much memory it may use. A check that nothing stops is past one of them. */
const SILENT_MS = 10_000;
const MEMORY_MB = 1024;

/** What the worker told of the worst calls, up to one that it could not answer. */
function checkedInWorker(): Promise<{ told: Told[]; broke: string | null }> {
  const worker = new Worker(new URL("./fixtures/drawnWorker.ts", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: MEMORY_MB } });
  const told: Told[] = [];
  return new Promise((resolve) => {
    const end = (broke: string | null) => {
      clearTimeout(silence);
      void worker.terminate().then(() => resolve({ told, broke }));
    };
    const silent = () => end(`no answer in ${SILENT_MS} ms`);
    let silence = setTimeout(silent, SILENT_MS);
    worker.on("message", (one: Told) => {
      told.push(one);
      clearTimeout(silence);
      silence = setTimeout(silent, SILENT_MS);
    });
    worker.on("error", (error) => end(String(error)));
    worker.on("exit", () => end(null));
  });
}

test(`each of the worst calls is rejected within ${CHECK_MS} ms`, { timeout: 120_000 }, async () => {
  const { told, broke } = await checkedInWorker();
  const last = told[told.length - 1];
  assert.equal(broke, null, last !== undefined && "starts" in last ? last.starts : "before the first");
  const checked = told.flatMap((one) => ("starts" in one ? [] : [one]));
  assert.deepEqual(checked.map(({ name }) => name), Object.keys(WORST));
  for (const { name, ms, bytes, messages } of checked) {
    console.log(`${name}: ${ms.toFixed(0)} ms`);
    assert.ok(bytes < 2 * 1024 * 1024, `${name}: ${bytes} bytes`);
    assert.ok(messages.length > 0, `${name}: accepted`);
    for (const message of messages) assert.match(message, /^A surface has at most \d+ components (drawn at once|with every row drawn); this one would have (more than |at least )?\d+\.( Also counted: [\w, ]+\. See quay_surface_guide\.)?$|^formatString fills in a text |^Circular reference /, name);
    assert.ok(ms < CHECK_MS, `${name}: ${ms.toFixed(0)} ms`);
  }
});

/** Containers, one under another, each with the children that `of` makes of the next one. */
const chain = (name: string, depth: number, of: (next: string) => string[]): Component[] => times(depth, (i) => holds(`${name}${i}`, of(`${name}${i + 1}`)));

const prose = "Some prose that says **what** it has to, in words of a common length. ";

/** Surfaces at the limit, each of another kind, with what they draw at once. */
const AT_LIMIT: Record<string, [Component[], object]> = {
  "Texts": [[listOf("root", "row", "/rows"), listOf("row", "leaf", "/cells"), text("leaf", "x")], { rows: rows(99), cells: rows(19) }],
  "forms": [
    [
      listOf("root", "row", "/rows"),
      { id: "row", component: "Row", children: ["name", "on", "go"] },
      { id: "name", component: "TextField", label: "Name", value: { "@path": "name" } },
      { id: "on", component: "CheckBox", label: "On", value: { "@path": "on" } },
      ...button("go", EVENT, { "@checks": [{ condition: { "@call": "required", args: { value: { "@path": "name" } } }, message: "Needed" }] }),
    ],
    { rows: rows(1980, { name: "a", on: true }) },
  ],
  "long lists": [[listOf("root", "row", "/rows"), { id: "row", component: "Row", children: ["a", "b", "c"] }, ...["a", "b", "c"].map((id) => text(id, { "@path": id }))], { rows: rows(2450, { a: "One", b: "Two", c: "Three" }) }],
  "options": [[listOf("root", "leaf", "/rows"), { id: "leaf", component: "ChoicePicker", value: [], options: times(100, (i) => ({ label: `Option ${i}`, value: `${i}` })) }], { rows: rows(19) }],
  "steps": [[listOf("root", "leaf", "/rows"), { id: "leaf", component: "Steps", steps: { "@path": "/steps" } }], { rows: rows(19), steps: rows(100, { label: "Step", state: "done" }) }],
  "prose": [[listOf("root", "leaf", "/rows"), text("leaf", { "@path": "/said" })], { rows: rows(18), said: prose.repeat(280) }],
  "dense Markdown": [[listOf("root", "leaf", "/rows"), text("leaf", { "@path": "/said" })], { rows: rows(13), said: "- a\n".repeat(400) }],
  "links": [[listOf("root", "leaf", "/rows"), text("leaf", { "@path": "/said" })], { rows: rows(8), said: "[a](http://b.c) ".repeat(104) }],
  "calls": [[holds("root", times(99, (i) => `t${i}`)), ...times(99, (i) => text(`t${i}`, { "@call": "formatString", args: { value: "${not(value:1)}".repeat(78) } }))], {}],
};

test(`a surface at the limit is drawn within ${DRAWN_MS} ms of its call`, { timeout: 120_000 }, async () => {
  const over: string[] = [];
  for (const [name, [components, dataModel]] of Object.entries(AT_LIMIT)) {
    await startPage();
    const started = performance.now();
    const content = await drawRecord(await acceptedRaw([create(components, { dataModel })]));
    const ms = performance.now() - started;
    console.log(`${name}: ${ms.toFixed(0)} ms, ${content.querySelectorAll("*").length} elements`);
    if (ms > DRAWN_MS) over.push(`${name}: ${ms.toFixed(0)} ms`);
    await leavePage();
  }
  assert.deepEqual(over, []);
});

/** The budget to take in what the operator types, and an update, on the test machine. */
const TAKEN_MS = 2000;

/** How long `act` keeps the processor, in milliseconds: what it waits for is left out. */
async function busy(act: () => Promise<void>): Promise<number> {
  const before = process.cpuUsage();
  await act();
  const { user, system } = process.cpuUsage(before);
  return (user + system) / 1000;
}

test(`what is typed in a surface at the limit is taken in within ${TAKEN_MS} ms`, { timeout: 60_000 }, async () => {
  const [[rowList, ...components], data] = AT_LIMIT["long lists"];
  const field: Component = { id: "note", component: "TextField", label: "Note", value: { "@path": "/note" } };
  await startPage();
  const root: Component = { id: "root", component: "Column", children: ["note", "all"] };
  const content = await drawRecord(await acceptedRaw([create([root, field, { ...rowList, id: "all" }, ...components], { dataModel: { ...data, note: "" } })]));
  const ms = await busy(() => put(content.querySelector<HTMLInputElement>("a2ui-react-textfield input")!, "a"));
  console.log(`typed: ${ms.toFixed(0)} ms`);
  await leavePage();
  assert.ok(ms < TAKEN_MS, `${ms.toFixed(0)} ms`);
});

/** Updates of a surface that is drawn, each with how many Texts it ends with. A step on the way would draw far more than either end. */
const UPDATES: Record<string, { from: [Component[], object]; to: [Component[], object]; texts: number }> = {
  "components that would draw too much of the data before them": {
    from: [[listOf("root", "leaf", "/rows"), text("leaf", "x")], { rows: rows(45) }],
    to: [[listOf("root", "a", "/rows"), listOf("a", "b", "/rows"), listOf("b", "leaf", "/rows"), text("leaf", "x")], { rows: rows(3) }],
    texts: 27,
  },
  "lists that would be above others before those are gone": {
    from: [
      [holds("root", ["c1", "c4"]), holds("c1", ["c2", "c3"]), text("c2", "x"), text("c3", "x"), listOf("c4", "c5", "/rows"), listOf("c5", "c6", "/rows"), listOf("c6", "leaf", "/rows"), text("leaf", "x")],
      { rows: rows(7) },
    ],
    to: [
      [holds("root", ["c1", "c5"]), listOf("c1", "c2", "/rows"), listOf("c2", "c3", "/rows"), listOf("c3", "c4", "/rows"), text("c4", "x"), listOf("c5", "c6", "/rows"), listOf("c6", "leaf", "/rows"), text("leaf", "x")],
      { rows: rows(7) },
    ],
    texts: 343 + 49,
  },
  "components that would share others before those share none": {
    from: [
      [holds("root", ["a0", "b0"]), ...chain("a", 7, (next) => [next]), ...chain("b", 8, (next) => [next, next]), text("a7", "x"), text("b8", "x")],
      {},
    ],
    to: [
      [holds("root", ["a0"]), ...chain("a", 7, (next) => [next, next]), holds("a7", ["b0"]), ...chain("b", 8, (next) => [next]), text("b8", "x")],
      {},
    ],
    texts: 128,
  },
};

for (const [name, { from, to, texts }] of Object.entries(UPDATES)) {
  test(`an update is taken in within ${TAKEN_MS} ms: ${name}`, { timeout: 60_000 }, async () => {
    await startPage();
    const before = await acceptedRaw([create(from[0], { dataModel: from[1] })]);
    const { state } = await acceptedRaw([create(to[0], { dataModel: to[1] })]);
    const content = await drawRecord(before);
    const drawn = () => content.querySelectorAll("a2ui-react-text").length;
    const ms = await busy(async () => {
      await redraw(createElement(SurfaceView, { terminal: TERMINAL, surfaces: [changed(before, { state, revision: 2 })] }));
      for (let i = 0; i < 50 && drawn() !== texts; i += 1) await settle();
    });
    console.log(`${name}: ${ms.toFixed(0)} ms`);
    assert.equal(drawn(), texts);
    await leavePage();
    assert.ok(ms < TAKEN_MS, `${ms.toFixed(0)} ms`);
  });
}
