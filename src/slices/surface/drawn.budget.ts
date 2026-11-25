/// <reference types="node" />
// How long the calls that would draw the most are checked for, and how long a surface at the limit takes from
// its call to the screen (#765). Not a `*.test.ts` file, so it runs by itself (`test:budget`).
import "../../test-support/dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import type { Told } from "./fixtures/drawnWorker.ts";
import { drawRecord, leavePage, startPage } from "./fixtures/catalogFixtures.ts";
import { acceptedRaw, button, create, EVENT, text, type Component } from "./fixtures/rawFixtures.ts";
import { WORST } from "./fixtures/worstCalls.ts";

/** The budget to check a call, on the test machine. Rust waits five seconds for a verdict. */
const CHECK_MS = 2500;

/** The budget from a call to the drawn surface, on the test machine. It leaves out the webview's layout. */
const DRAWN_MS = 4000;

/** How long the worker may be silent, and how much memory it may use. One that has no limit to stop it is past both. */
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
    for (const message of messages) assert.match(message, /^A surface has at most \d+ components (drawn at once|with every row drawn); this one would have (more than )?\d+\.$|^Circular reference /, name);
    assert.ok(ms < CHECK_MS, `${name}: ${ms.toFixed(0)} ms`);
  }
});

const rows = (count: number, row: unknown = 0): unknown[] => Array.from({ length: count }, () => row);
const list = (id: string, child: string, path: string): Component => ({ id, component: "Column", children: { componentId: child, path } });
const prose = "Some prose that says **what** it has to, in words of a common length. ";

/** Surfaces at the limit, each of another kind, with what they draw at once. */
const AT_LIMIT: Record<string, [Component[], object]> = {
  "Texts": [[list("root", "row", "/rows"), list("row", "leaf", "/cells"), text("leaf", "x")], { rows: rows(99), cells: rows(19) }],
  "forms": [
    [
      list("root", "row", "/rows"),
      { id: "row", component: "Row", children: ["name", "on", "go"] },
      { id: "name", component: "TextField", label: "Name", value: { "@path": "name" } },
      { id: "on", component: "CheckBox", label: "On", value: { "@path": "on" } },
      ...button("go", EVENT, { "@checks": [{ condition: { "@call": "required", args: { value: { "@path": "name" } } }, message: "Needed" }] }),
    ],
    { rows: rows(1980, { name: "a", on: true }) },
  ],
  "long lists": [[list("root", "row", "/rows"), { id: "row", component: "Row", children: ["a", "b", "c"] }, ...["a", "b", "c"].map((id) => text(id, { "@path": id }))], { rows: rows(2450, { a: "One", b: "Two", c: "Three" }) }],
  "options": [[list("root", "leaf", "/rows"), { id: "leaf", component: "ChoicePicker", value: [], options: Array.from({ length: 100 }, (_, i) => ({ label: `Option ${i}`, value: `${i}` })) }], { rows: rows(19) }],
  "steps": [[list("root", "leaf", "/rows"), { id: "leaf", component: "Steps", steps: { "@path": "/steps" } }], { rows: rows(19), steps: rows(100, { label: "Step", state: "done" }) }],
  "prose": [[list("root", "leaf", "/rows"), text("leaf", { "@path": "/said" })], { rows: rows(24), said: prose.repeat(280) }],
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
