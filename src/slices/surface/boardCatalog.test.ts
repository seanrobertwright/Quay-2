/// <reference types="node" />
// What the webview makes of a quay_board call, and the catalog's components that draw it (#724), at
// the check and at what is drawn of an accepted state.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, Suspense } from "react";
import type { CreateSurface, SurfaceRecord, Verdict } from "./surfaceTypes.ts";
import { startRust, until, unloadSurfaces, verdictOn } from "./fixtures/fakeRust.ts";
import { mount, surface, unmount } from "./fixtures/surfaceFixtures.ts";

const { SurfaceContent } = await import("./a2ui/index.ts");

beforeEach(() => startRust({}));
afterEach(async () => {
  await unmount();
  unloadSurfaces();
});

let call = 0;
const checkBoard = (args: unknown, id = "board"): Promise<Verdict> => verdictOn({ call: (call += 1), tool: "quay_board", surface_id: id, arguments: args });

async function stateOf(args: unknown, id?: string): Promise<CreateSurface> {
  const verdict = await checkBoard(args, id);
  assert.ok("state" in verdict, JSON.stringify(verdict));
  return verdict.state;
}

/** Draws a surface of `state` as the catalog draws it, with no layout of the frame's. */
async function draw(state: CreateSurface): Promise<HTMLElement> {
  const record: SurfaceRecord = surface("plain", { tool: "plain", state });
  const content = createElement(SurfaceContent, { record, layout: null, onAction: async () => {} });
  const container = await mount(createElement(Suspense, { fallback: null }, content));
  await until(() => container.textContent !== "", "nothing was drawn");
  return container;
}

/** A surface of one component that is drawn from `dataModel`. */
const one = (component: Record<string, unknown>, dataModel: Record<string, unknown> = {}): CreateSurface => ({
  version: "1.0",
  createSurface: { surfaceId: "plain", catalogId: "urn:quay:a2ui:catalog:v1", components: [{ id: "root", ...component } as never], dataModel },
});

const FULL = {
  title: "Migrating call sites",
  steps: [
    { label: "Find *them*", state: "done", note: "41 <b>files</b>" },
    { label: "Change them", state: "active" },
    { label: "Change them", state: "failed" },
    { label: "Run the suite", state: "pending" },
  ],
  progress: { done: 3, total: 7 },
  stats: [
    { label: "passed", value: "186" },
    { label: "passed", value: "186" },
  ],
  status: "running",
};

test("a board is accepted as one createSurface of its parts, which asks for nothing", async () => {
  const verdict = await checkBoard(FULL);
  assert.ok("state" in verdict, JSON.stringify(verdict));
  assert.equal(verdict.asks, false);
  const { surfaceId, components } = verdict.state.createSurface;
  assert.equal(surfaceId, "board");
  assert.deepEqual(
    components.map(({ component }) => component),
    ["Column", "Steps", "Progress", "Stat", "Stat"],
  );
});

test("a board of a title alone is accepted, and so is any id an agent may choose", async () => {
  for (const id of ["nightly-run 2", "é/~1", "root", "board"]) {
    const { createSurface } = await stateOf({ title: "One", steps: [], stats: [], status: "running" }, id);
    assert.equal(createSurface.surfaceId, id);
  }
});

test("a board at every limit is accepted", async () => {
  const steps = Array.from({ length: 30 }, () => ({ label: "x".repeat(80), state: "done", note: "y".repeat(120) }));
  const stats = Array.from({ length: 6 }, () => ({ label: "x".repeat(20), value: "y".repeat(20) }));
  await stateOf({ title: "x".repeat(80), steps, stats, progress: { done: 0.5, total: 1e9 }, status: "failed" });
});

test("Steps says each step, its state and its note as they were written", async () => {
  const container = await draw(one({ component: "Steps", steps: FULL.steps }));
  const items = [...container.querySelectorAll("li")].map((item) => item.textContent);
  assert.deepEqual(items, ["Done: Find *them*41 <b>files</b>", "In progress: Change them", "Failed: Change them", "Not started: Run the suite"]);
  assert.equal(container.querySelectorAll("b, em").length, 0, "no markup of the agent's is drawn");
  assert.equal(container.querySelectorAll("li svg[aria-hidden]").length, 4, "each state has an icon");
});

test("Steps takes a binding, and leaves out what is no step", async () => {
  const bound = [{ label: "One", state: "done" }, { label: "Two", state: "dancing" }, null, { state: "done" }, { label: "Three", state: "pending", note: 4 }];
  const container = await draw(one({ component: "Steps", steps: { "@path": "/steps" } }, { steps: bound }));
  assert.deepEqual(
    [...container.querySelectorAll("li")].map((item) => item.textContent),
    ["Done: One", "Not started: Three"],
  );
});

test("Progress is a labelled progress bar that says how much is done", async () => {
  const container = await draw(one({ component: "Progress", done: { "@path": "/done" }, total: 7, label: "Files" }, { done: 3 }));
  const bar = container.querySelector('[role="progressbar"]');
  const attributes = ["aria-label", "aria-valuemin", "aria-valuemax", "aria-valuenow"].map((name) => bar?.getAttribute(name));
  assert.deepEqual(attributes, ["Files", "0", "7", "3"]);
  assert.equal(container.textContent, "Files3 of 7");
});

test("Progress with no label says what it is, and more than all of it is all of it", async () => {
  const container = await draw(one({ component: "Progress", done: { "@path": "/done" }, total: 7 }, { done: 9 }));
  const bar = container.querySelector('[role="progressbar"]');
  assert.deepEqual([bar?.getAttribute("aria-label"), bar?.getAttribute("aria-valuenow"), container.textContent], ["Progress", "7", "7 of 7"]);
});

test("Progress of what is no amount draws its label and no bar", async () => {
  const container = await draw(one({ component: "Progress", done: { "@path": "/done" }, total: 7, label: "Files" }, { done: "three" }));
  assert.deepEqual([container.textContent, container.querySelectorAll('[role="progressbar"]').length], ["Files", 0]);
});

test("Stat is a value with its label", async () => {
  const container = await draw(one({ component: "Stat", label: "passed", value: { "@path": "/passed" } }, { passed: "186" }));
  assert.equal(container.textContent, "186 passed");
});

test("the engine refuses a step of another state, a property no component has and one that is missing", async () => {
  const step = { label: "One", state: "done" };
  const refused = [
    { steps: [{ ...step, state: "dancing" }] },
    { steps: [{ ...step, href: "x" }] },
    { steps: [{ state: "done" }] },
    { progress: { done: 3 } },
    { stats: [{ label: "passed" }] },
  ];
  for (const [i, args] of refused.entries()) {
    const verdict = await checkBoard({ ...FULL, ...args });
    assert.deepEqual("errors" in verdict && verdict.errors.map(({ code }) => code), ["VALIDATION_FAILED"], `case ${i}`);
  }
});
