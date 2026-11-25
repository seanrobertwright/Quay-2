/// <reference types="node" />
// What Rust is told, for the surface record, of each function the operator's click fires (#729), with only
// Tauri's `invoke` and the clipboard faked.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { called, calls, settle, until } from "./fixtures/fakeRust.ts";
import { acceptedRaw, create, text, type Component } from "./fixtures/rawFixtures.ts";
import { arrives, changed, mount, redraw } from "./fixtures/surfaceFixtures.ts";
import { buttonOf, click, drawRecord, drawTree, leavePage, put, startPage, TERMINAL, type Data } from "./fixtures/catalogFixtures.ts";

const { SurfaceView } = await import("./SurfaceView.tsx");
const { surfacesByTerminal } = await import("./surfaceHost.ts");

const FIRED = "surface_function_fired";

beforeEach(async () => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
  await startPage();
});
afterEach(leavePage);

const at = (path: string) => ({ "@path": path });

/** A Button that reads `id`, and calls `name`. */
const calling = (id: string, name: string, args: Data): Component[] => [
  { id, component: "Button", child: `${id}_label`, action: { functionCall: { "@call": name, args } } },
  text(`${id}_label`, id),
];

/** What Rust was told of the functions that fired, each in the surface `id` of `t1`: its name, its target, and whether what was typed is part of it. */
function fired(of = "plan"): unknown[] {
  return called(FIRED).map(({ terminalId, id, function: name, target, targetTyped }) => {
    assert.deepEqual([terminalId, id], ["t1", of]);
    assert.equal(typeof targetTyped, "boolean");
    return targetTyped ? [name, target, "typed"] : [name, target];
  });
}

const call = (name: string, args: Data) => ({ "@call": name, args });
const formatted = (value: string) => call("formatString", { value });

/** Clicks each link in `content`, and the Buttons `names`. */
async function clickAll(content: HTMLElement, ...names: string[]): Promise<void> {
  for (const link of content.querySelectorAll<HTMLElement>('[role="link"]')) await click(link);
  for (const name of names) await click(buttonOf(content, name));
  await settle();
}

test("each function a Button fires is told with its target as it was written, but for a text that is copied", async () => {
  const content = await drawTree(
    ["a", "b", "c", "d"],
    [
      ...calling("a", "openUrl", { url: "https://Example.com?q=1" }),
      ...calling("b", "showFile", { path: "src/a.ts", line: 3 }),
      ...calling("c", "focusTerminal", { terminal: at("/terminal") }),
      ...calling("d", "copyText", { text: "planted" }),
    ],
    { terminal: "fix-76" },
  );
  assert.equal(calls.length, 0, "drawing fires nothing");
  for (const name of ["a", "b", "c", "d"]) await click(buttonOf(content, name));
  await settle();
  assert.deepEqual(fired(), [
    ["openUrl", "https://Example.com?q=1"],
    ["showFile", "src/a.ts"],
    ["focusTerminal", "fix-76"],
    ["copyText", null],
  ]);
});

test("a link in a text and a FileLink are told as what they open", async () => {
  const content = await drawTree(
    ["said", "file"],
    [text("said", "[web](https://Example.com) and [local](docs/a.md)"), { id: "file", component: "FileLink", path: "src/b.ts", line: 9 }],
  );
  for (const link of content.querySelectorAll<HTMLElement>('[role="link"]')) await click(link);
  await settle();
  assert.deepEqual(fired(), [
    ["openUrl", "https://example.com/"],
    ["showFile", "docs/a.md"],
    ["showFile", "src/b.ts"],
  ]);
});

test("a Button that is held fires nothing, and one click is told once", async () => {
  const content = await drawTree(
    ["field", "a"],
    [
      { id: "field", component: "TextField", label: "Address", value: at("/url") },
      ...calling("a", "openUrl", { url: at("/url") }).map((component) =>
        component.id === "a" ? { ...component, "@checks": [{ condition: { "@call": "required", args: { value: at("/url") } }, message: "Needed" }] } : component,
      ),
    ],
  );
  await click(buttonOf(content, "a"));
  assert.deepEqual(fired(), []);
  await put(content.querySelector("input")!, "https://b.example/");
  await click(buttonOf(content, "a"));
  assert.deepEqual(fired(), [["openUrl", "", "typed"]]);
});

const FIELD: Component = { id: "field", component: "TextField", label: "Note", value: at("/note") };

test("nothing typed is told, whatever a target makes of it and whatever else the surface says", async () => {
  const content = await drawTree(
    ["field", "a", "b", "c", "d", "said", "linked", "file"],
    [
      FIELD,
      ...calling("a", "openUrl", { url: formatted("https://example.com/search?q=${/note}") }),
      ...calling("b", "showFile", { path: at("/note") }),
      ...calling("c", "focusTerminal", { terminal: at("/note") }),
      ...calling("d", "openUrl", { url: formatted("https://${/note}.example/") }),
      text("said", "planted is in production. [it](planted) https://example.com/search?q=planted"),
      text("linked", formatted("[mine](${/note}) and [theirs](a.ts)")),
      { id: "file", component: "FileLink", path: at("/note") },
    ],
    { note: "" },
  );
  await put(content.querySelector("input")!, "planted");
  await clickAll(content, "a", "b", "c", "d");
  assert.deepEqual(fired(), [
    ["showFile", "planted"],
    ["showFile", null, "typed"],
    ["showFile", "a.ts"],
    ["showFile", "", "typed"],
    ["openUrl", "https://example.com/search?q=", "typed"],
    ["showFile", "", "typed"],
    ["focusTerminal", "", "typed"],
    ["openUrl", "https://.example/", "typed"],
  ]);
});

test("a target the agent's own data makes is told whole, and so is one that is spelled otherwise in Markdown", async () => {
  const content = await drawTree(
    ["field", "said", "rows", "a"],
    [
      FIELD,
      text("said", "100% done, [notes](my%20notes.md), [entity](a&amp;b.md) and [escaped](a\\_b.md)"),
      { id: "rows", component: "List", children: { componentId: "row", path: "/rows" } },
      { id: "row", component: "FileLink", path: at("path"), label: "row" },
      ...calling("a", "openUrl", { url: formatted("https://example.com/${/branch}?q=${/note}") }),
    ],
    { note: "seed", branch: "main", rows: [{ path: "src/a.ts" }, { path: "src/b.ts" }] },
  );
  await clickAll(content, "a");
  assert.deepEqual(fired(), [
    ["showFile", "my notes.md"],
    ["showFile", "a&b.md"],
    ["showFile", "a_b.md"],
    ["showFile", "src/a.ts"],
    ["showFile", "src/b.ts"],
    ["openUrl", "https://example.com/main?q=seed"],
  ]);
});

test("a target made of what the operator picked is told whole, without what they typed", async () => {
  const content = await drawTree(
    ["field", "pick", "box", "a", "b"],
    [
      FIELD,
      { id: "pick", component: "ChoicePicker", label: "Where", options: [{ label: "Staging", value: "stage" }, { label: "Production", value: "prod" }], value: at("/pick") },
      { id: "box", component: "CheckBox", label: "All", value: at("/all") },
      ...calling("a", "openUrl", { url: formatted("https://example.com/${/pick/0}?all=${/all}") }),
      ...calling("b", "openUrl", { url: formatted("https://example.com/${/pick/0}?q=${/note}") }),
    ],
    { note: "", pick: ["stage"], all: false },
  );
  await click(content.querySelector<HTMLInputElement>('input[value="prod"]') ?? content.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]);
  await click(content.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await put(content.querySelector<HTMLInputElement>('input[type="text"]')!, "planted");
  await clickAll(content, "a", "b");
  assert.deepEqual(fired(), [
    ["openUrl", "https://example.com/prod?all=true"],
    ["openUrl", "https://example.com/prod?q=", "typed"],
  ]);
});

test("what is typed into a list that a ChoicePicker chooses from is no pick", async () => {
  const content = await drawTree(
    ["pick", "field", "a"],
    [
      { id: "pick", component: "ChoicePicker", label: "Where", options: [{ label: "Staging", value: "stage" }], value: at("/pick") },
      { id: "field", component: "TextField", label: "Note", value: at("/pick/0") },
      ...calling("a", "focusTerminal", { terminal: at("/pick/0") }),
    ],
    { pick: ["stage"] },
  );
  await put(content.querySelector<HTMLInputElement>('input[type="text"]')!, "planted");
  await clickAll(content, "a");
  assert.deepEqual(fired(), [["focusTerminal", "stage", "typed"]]);
});

test("after an update, what was typed before is still told of no target", async () => {
  const before = await acceptedRaw([create([{ id: "root", component: "Column", children: ["field", "a"] }, FIELD, ...calling("a", "showFile", { path: at("/note") })], { dataModel: { note: "" } })]);
  await arrives(before);
  const content = await drawRecord(before);
  await put(content.querySelector("input")!, "planted");
  const after = changed(before, { revision: 2, carried: { from: 1, set: {} } });
  await arrives(after);
  // An update that comes soon after another is held back for a moment
  await until(() => surfacesByTerminal().get("t1")?.[0]?.revision === 2, "the update was not kept");
  await redraw(createElement(SurfaceView, { terminal: TERMINAL, surfaces: [after] }));
  assert.equal(content.querySelector("input")!.value, "planted", "what was typed is carried on");
  await clickAll(content, "a");
  assert.deepEqual(fired(), [["showFile", "", "typed"]]);
});

test("a link in what was reviewed is told whole, as nothing in it is typed", async () => {
  const { acceptedReview } = await import("./fixtures/reviewFixtures.ts");
  const review = await acceptedReview("review_1", { title: "Plan", body: "See [the notes](my%20notes.md)." });
  const { ReviewReviewed } = await import("./looks/ReviewReviewed.tsx");
  const { SurfaceLinksProvider } = await import("./SurfaceLinksProvider.tsx");
  const container = await mount(
    createElement(SurfaceLinksProvider, { terminalId: "t1", id: "review_1", children: createElement(ReviewReviewed, { components: review.state.createSurface.components }) }),
  );
  await until(() => container.querySelector('[role="link"]') !== null, "the review was never drawn");
  await clickAll(container);
  assert.deepEqual(fired("review_1"), [["showFile", "my notes.md"]]);
});

test("a target that cannot be worked out is told of nothing, and the function runs all the same", async () => {
  const { duringClick } = await import("./clickOnly.ts");
  const { surfaceEffects } = await import("./surfaceEffects.ts");
  const effects = surfaceEffects({ terminal_id: "t1", id: "plan" }, () => {});
  const { error } = console;
  let logged = 0;
  console.error = () => void (logged += 1);
  try {
    duringClick("showFile", () => effects.showFile("planted"), () => { throw new Error("no engine"); });
    duringClick("showFile", () => effects.showFile("planted"), () => null);
  } finally {
    console.error = error;
  }
  await settle();
  assert.deepEqual(fired(), [["showFile", null, "typed"], ["showFile", null, "typed"]]);
  assert.equal(called("surface_show_file").length, 2);
  assert.equal(logged, 1);
});

test("what cannot be recorded is fired all the same, and the operator is told nothing", async () => {
  const { startRust, loadSurfaces, unloadSurfaces } = await import("./fixtures/fakeRust.ts");
  unloadSurfaces();
  startRust({ surface_list: () => [], surface_checks: () => [], [FIRED]: () => Promise.reject(new Error("no record")) });
  loadSurfaces();
  const { error } = console;
  const logged: unknown[][] = [];
  console.error = (...args) => void logged.push(args);
  try {
    const content = await drawTree(["a"], calling("a", "openUrl", { url: "https://a.example/" }));
    await click(buttonOf(content, "a"));
    await settle();
    assert.equal(called("plugin:opener|open_url").length, 1);
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(logged.some((args) => String(args[1]).includes("no record")), true);
  } finally {
    console.error = error;
  }
});
