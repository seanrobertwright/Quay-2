/// <reference types="node" />
// The catalog's functions that only work something out (#726), as the engine ships them, with only
// Tauri's `invoke` faked: a raw surface that the check accepted, as it is drawn.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { create, errorsIn, text, told, type Component } from "./fixtures/rawFixtures.ts";
import { click, drawAll, drawTree, leavePage, startPage, texts } from "./fixtures/catalogFixtures.ts";

beforeEach(startPage);
afterEach(leavePage);

const at = (path: string) => ({ "@path": path });
const call = (name: string, args: Record<string, unknown>) => ({ "@call": name, args });

test("the formatting functions, and what they are nested in, are worked out", async () => {
  const cases: [unknown, string][] = [
    [call("formatString", { value: "Hello ${/name}, ${formatNumber(value: ${/count}, decimals: 1)}" }), "Hello Ann, 1,234.5"],
    [call("formatNumber", { value: at("/count"), decimals: 2, grouping: false }), "1234.50"],
    [call("formatCurrency", { value: 12.5, currency: "EUR" }), "€12.50"],
    [call("formatDate", { value: "2026-10-21T14:06:11Z", format: "EEEE, MMM d yyyy, h:mm a" }), "Wednesday, Oct 21 2026, 2:06 PM"],
    [call("formatDate", { value: "2026-02-30", format: "yyyy" }), ""],
    [call("pluralize", { value: 1, one: "file", other: "files" }), "file"],
    [call("pluralize", { value: at("/count"), one: "file", other: "files" }), "files"],
  ];
  const content = await drawAll(cases.map(([value], i) => text(`t${i}`, value)), { name: "Ann", count: 1234.5 });
  assert.deepEqual(texts(content, "a2ui-react-text"), cases.map(([, said]) => said));
});

test("the checking and logic functions hold a button until each holds", async () => {
  const cases: [unknown, boolean][] = [
    [call("required", { value: at("/name") }), true],
    [call("required", { value: at("/none") }), false],
    [call("regex", { value: at("/name"), pattern: "^A" }), true],
    [call("regex", { value: at("/name"), pattern: "^B" }), false],
    [call("length", { value: at("/name"), min: 2, max: 3 }), true],
    [call("length", { value: at("/name"), max: 2 }), false],
    [call("numeric", { value: at("/count"), min: 1, max: 10 }), true],
    [call("numeric", { value: at("/count"), min: 8 }), false],
    [call("email", { value: "ann@quay.example" }), true],
    [call("email", { value: "ann" }), false],
    [call("and", { values: [true, call("required", { value: at("/name") })] }), true],
    [call("and", { values: [true, false] }), false],
    [call("or", { values: [false, call("email", { value: "ann" }), true] }), true],
    [call("or", { values: [false, false] }), false],
    [call("not", { value: false }), true],
    [call("not", { value: call("required", { value: at("/name") }) }), false],
  ];
  const components = cases.flatMap(([condition], i): Component[] => [
    { id: `b${i}`, component: "Button", child: `l${i}`, action: { event: { name: "go" } }, "@checks": [{ condition, message: "no" }] },
    text(`l${i}`, String(i)),
  ]);
  const content = await drawTree(cases.map((_, i) => `b${i}`), components, { name: "Ann", count: 7 });
  assert.deepEqual([...content.querySelectorAll("button")].map(({ disabled }) => !disabled), cases.map(([, holds]) => holds));
});

test("@index is the row a template draws, from an offset", async () => {
  const content = await drawTree(
    ["list"],
    [
      { id: "list", component: "List", children: { componentId: "row", path: "/rows" } },
      { id: "row", component: "Row", children: ["n", "name"] },
      text("n", call("@index", { offset: 1 })),
      text("name", at("")),
    ],
    { rows: ["One", "Two", "Three"] },
  );
  assert.deepEqual(texts(content, "li"), ["1One", "2Two", "3Three"]);
});

test("a function is drawn again as what it reads of changes", async () => {
  const content = await drawAll([{ id: "box", component: "CheckBox", label: "On", value: at("/on") }, text("said", call("not", { value: at("/on") }))], { on: false });
  assert.equal(texts(content, "a2ui-react-text")[0], "true");
  await click(content.querySelector("input")!);
  assert.equal(texts(content, "a2ui-react-text")[0], "false");
});

test("the agent may call none of them, and none the catalog lacks", async () => {
  const [[code, path]] = told(await errorsIn([{ version: "1.0", callRendererFunction: { functionCallId: "1", callRendererFunction: call("required", { value: 1 }) } }]));
  assert.deepEqual([code, path], ["VALIDATION_FAILED", "/messages/0/callRendererFunction"]);
  const [[, , said = ""]] = told(await errorsIn([create([{ id: "root", ...text("root", call("openWindow", {})) }])]));
  assert.ok(said.includes("copyText, email, focusTerminal, formatCurrency"), said);
});
