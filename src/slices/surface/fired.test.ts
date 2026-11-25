/// <reference types="node" />
// What Rust is told, for the surface record, of each function the operator's click fires (#729), with only
// Tauri's `invoke` and the clipboard faked.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { called, calls, settle } from "./fixtures/fakeRust.ts";
import { text, type Component } from "./fixtures/rawFixtures.ts";
import { buttonOf, click, drawTree, leavePage, put, startPage, type Data } from "./fixtures/catalogFixtures.ts";

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

/** What Rust was told of the functions that fired, each in the surface `plan` of `t1`. */
function fired(): unknown[] {
  return called(FIRED).map(({ terminalId, id, function: name, target }) => {
    assert.deepEqual([terminalId, id], ["t1", "plan"]);
    return [name, target];
  });
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
    ["openUrl", "https://Example.com"],
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
  assert.deepEqual(fired(), [["openUrl", "https://b.example/"]]);
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
