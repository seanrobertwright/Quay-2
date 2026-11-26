/// <reference types="node" />
// Quay's catalog as a whole (#726): what is in it, what no component of it may have, and that Quay's parts
// are all that draws.
import "../../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { ALL_CHILDREN, ALL_COMPONENTS, ALL_DATA } from "../fixtures/allComponents.ts";
import { click, drawTree, leavePage, startPage } from "../fixtures/catalogFixtures.ts";

const { catalog } = await import("./catalog.ts");

beforeEach(startPage);
afterEach(leavePage);

const KEPT = "Text Image Icon Row Column List Card Tabs Divider Button TextField CheckBox ChoicePicker Slider DateTimeInput".split(" ");
const OWN = "Progress Steps Stat FileLink".split(" ");
const PURE = "required regex length numeric email formatString formatNumber formatCurrency formatDate pluralize and or not".split(" ");
const EFFECTS = "openUrl showFile focusTerminal copyText".split(" ");

/** The properties a component's schema names. */
const propertiesOf = (component: { schema: unknown }): string[] => Object.keys((component.schema as { shape: Record<string, unknown> }).shape);

test("the catalog is the components and functions of the spec", () => {
  assert.equal(catalog.id, "urn:quay:a2ui:catalog:v1");
  assert.deepEqual([...catalog.components.keys()].sort(), [...KEPT, ...OWN].sort());
  assert.deepEqual([...catalog.functions.keys()].sort(), [...PURE, ...EFFECTS].sort());
});

test("a kept component takes every property the standard gives it", () => {
  for (const name of KEPT) {
    const own = new Set(propertiesOf(catalog.components.get(name)!));
    assert.deepEqual(propertiesOf(basicCatalog.components.get(name)!).filter((property) => !own.has(property)), [], name);
  }
});

test("no component has a property that 1.0 spells with an @", () => {
  for (const [name, component] of catalog.components) {
    const taken = propertiesOf(component).filter((property) => ["accessibility", "checks", "catalogId", "metadata"].includes(property));
    assert.deepEqual(taken, [], name);
  }
});

test("the agent may call no function, and the functions with an effect need the operator's click", () => {
  const functions = [...catalog.functions.values()] as { name: string; allowedCallers?: string; requiresUserActivation?: boolean }[];
  assert.deepEqual(functions.filter(({ allowedCallers }) => allowedCallers !== undefined && allowedCallers !== "rendererOnly").map(({ name }) => name), []);
  assert.deepEqual(functions.filter(({ requiresUserActivation }) => requiresUserActivation).map(({ name }) => name).sort(), [...EFFECTS].sort());
});

test("no stock element is ever drawn, whatever a surface holds", async () => {
  const content = await drawTree(ALL_CHILDREN, ALL_COMPONENTS, ALL_DATA);
  const types = new Set(ALL_COMPONENTS.map(({ component }) => String(component)));
  assert.deepEqual([...KEPT, ...OWN].filter((name) => !types.has(name)), [], "every component is in the surface");
  const custom: Element[] = [];
  const stock: Element[] = [];
  // Each tab's, as it is drawn
  for (const tab of content.querySelectorAll<HTMLElement>('[role="button"][aria-pressed]')) {
    await click(tab);
    custom.push(...[...document.querySelectorAll("*")].filter(({ localName }) => localName.includes("-")));
    stock.push(...content.querySelectorAll('[class*="a2ui-"], [class*="material-"], style, link, script'));
  }
  // The engine's own box around each component, which has no look
  const boxes = new Set(custom.map(({ localName }) => localName));
  assert.deepEqual([...boxes].sort(), [...KEPT, ...OWN].map((name) => `a2ui-react-${name.toLowerCase()}`).sort());
  assert.deepEqual(custom.filter((box) => box.shadowRoot !== null || box.getAttribute("style")?.replace(/[\s;]/g, "") !== "display:contents").map(({ localName }) => localName), []);
  assert.equal(stock.length, 0);
  // None of them is even known to the page
  const known = [...basicCatalog.components.values()].flatMap((component) => ("tagName" in component && customElements.get(component.tagName) ? [component.tagName] : []));
  assert.deepEqual(known, []);
});

test("nothing is drawn wider than the surface by its own making, so each component fits the narrowest place", async () => {
  const content = await drawTree(ALL_CHILDREN, ALL_COMPONENTS, ALL_DATA);
  const wide = [...content.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
    const name = element.getAttribute("class") ?? "";
    const widths = [...name.matchAll(/(?:^|\s)(?:min-)?w-(\d+)(?=\s|$)/g)].map(([, size]) => Number(size) * 4);
    return widths.some((px) => px > 300) || /(?:^|\s)(?:whitespace-nowrap|w-screen)(?:\s|$)/.test(name) ? [name] : [];
  });
  assert.deepEqual(wide, []);
  const loose = [...content.querySelectorAll("fieldset")].filter((box) => !box.className.split(" ").includes("min-w-0"));
  assert.equal(loose.length, 0, "a fieldset is as wide as what is in it, unless it is told not to be");
});
