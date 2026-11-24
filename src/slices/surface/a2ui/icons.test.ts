/// <reference types="node" />
// The catalog's Icon (#726), with only Tauri's `invoke` faked: a raw surface that the check accepted, as
// it is drawn.
import "../../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { IconApi } from "@a2ui/web_core/catalogs/basic/v1";
import { text, type Component } from "../fixtures/rawFixtures.ts";
import { drawAll, drawTree, leavePage, one, startPage } from "../fixtures/catalogFixtures.ts";

const { ICON_NAMES } = await import("./icons.ts");

beforeEach(startPage);
afterEach(leavePage);

/** The icon names the engine's own schema takes. */
const NAMES: readonly string[] = IconApi.schema.shape.name.options[0].options;

const icon = (id: string, name: unknown, more: Component = {}): Component => ({ id, component: "Icon", name, ...more });
const hosts = (content: HTMLElement) => [...content.querySelectorAll("a2ui-react-icon")];

test("every icon name of the engine's is drawn, each as an icon of its own, and no other is named", async () => {
  assert.equal(NAMES.length, 59);
  assert.deepEqual([...ICON_NAMES].sort(), [...NAMES].sort());
  const content = await drawAll(NAMES.map((name) => icon(name, name)));
  const drawn = hosts(content).map((host) => (host.querySelectorAll("svg").length === 1 ? host.querySelector("svg")!.innerHTML : ""));
  assert.equal(drawn.length, 59);
  assert.deepEqual(NAMES.filter((_, i) => drawn[i] === ""), []);
  assert.deepEqual(NAMES.filter((_, i) => drawn.indexOf(drawn[i]) !== i), []);
});

test("a bound name draws its icon, and one that is none of them draws nothing", async () => {
  const bound = ["star", "toString", "constructor", "Star", "rocket", "", 4, null, { svg: 1 }, ["star"]];
  const content = await drawAll(
    bound.map((_, i) => icon(`i${i}`, { "@path": `/names/${i}` })),
    { names: bound },
  );
  assert.deepEqual(hosts(content).map((host) => host.childElementCount), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(content.querySelectorAll("svg").length, 1);
});

test("an svgPath draws its shape in the colour of the text, whether it is written or bound", async () => {
  const content = await drawAll([icon("a", { svgPath: "M0 0h24v24H0z" }), icon("b", { svgPath: { "@path": "/shape" } }), icon("c", { svgPath: { "@path": "/none" } })], { shape: "M1 1h2" });
  assert.deepEqual([...content.querySelectorAll("svg > path")].map((path) => path.getAttribute("d")), ["M0 0h24v24H0z", "M1 1h2"]);
  assert.ok([...content.querySelectorAll("svg")].every((svg) => svg.getAttribute("fill") === "currentColor" && svg.getAttribute("viewBox") === "0 0 24 24"));
  assert.ok([...content.querySelectorAll("svg, svg *")].every((el) => el.getAttributeNames().every((name) => !/href|style|^on/.test(name))));
});

test("an icon only decorates, unless its accessibility label names it", async () => {
  const content = await drawAll([icon("a", "check"), icon("b", "check", { "@accessibility": { label: "Passed" } }), icon("c", { svgPath: "M0 0" }, { "@accessibility": { label: { "@path": "/name" } } })], { name: "Bound" });
  const said = [...content.querySelectorAll("svg")].map((svg) => ["role", "aria-label", "aria-hidden"].map((name) => svg.getAttribute(name)));
  assert.deepEqual(said, [
    [null, null, "true"],
    ["img", "Passed", null],
    ["img", "Bound", null],
  ]);
});

test("a button with an icon alone goes by the icon's name, unless it or the icon is named", async () => {
  const go = { event: { name: "go" } };
  const only = (id: string, child: Component, more: Component = {}): Component[] => [
    { id, component: "Button", child: `${id}_icon`, action: go, ...more },
    { ...child, id: `${id}_icon` },
  ];
  const content = await drawTree(
    ["a", "b", "c", "d", "e", "f"],
    [
      ...only("a", icon("", "shoppingCart")),
      ...only("b", icon("", "check", { "@accessibility": { label: "Passed" } })),
      ...only("c", icon("", "check"), { "@accessibility": { label: "Accept" } }),
      ...only("d", icon("", { svgPath: "M0 0" })),
      ...only("e", icon("", { "@path": "/name" })),
      { id: "f", component: "Button", child: "f_row", action: go },
      { id: "f_row", component: "Row", children: ["f_icon", "f_text"] },
      icon("f_icon", "send"),
      text("f_text", "Send it"),
    ],
    { name: "moreVert" },
  );
  const names = [...content.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.querySelector("svg[aria-label]")?.getAttribute("aria-label") ?? button.textContent);
  assert.deepEqual(names, ["shopping cart", "Passed", "Accept", "icon", "more vert", "Send it"]);
  assert.equal(one(content, "button[aria-label]").textContent, "check");
});
