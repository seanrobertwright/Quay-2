/// <reference types="node" />
// The catalog's components that arrange others (#726), with only Tauri's `invoke` faked: a raw surface
// that the check accepted, as it is drawn.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { acceptedRaw, create, text, type Component } from "./fixtures/rawFixtures.ts";
import { mount, settle } from "./fixtures/surfaceFixtures.ts";
import { buttonOf, click, drawAll, drawTree, leavePage, one, put, startPage, texts, type Data } from "./fixtures/catalogFixtures.ts";
import type { LayoutProps, SurfaceData } from "./layout.ts";
import { loadA2ui } from "./surfaceHost.ts";

beforeEach(startPage);
afterEach(leavePage);

const classes = (element: Element) => element.className.split(" ");

/** The nearest element around the Text that reads `said` that has `name` as a class. */
function around(content: HTMLElement, said: string, name: string): Element {
  const host = [...content.querySelectorAll("a2ui-react-text")].find((text) => text.textContent === said);
  for (let up = host?.parentElement; up && up !== content; up = up.parentElement) if (classes(up).includes(name)) return up;
  assert.fail(`nothing around "${said}" is ${name}`);
}

test("a Row puts its children beside each other, and wraps them where there is no room", async () => {
  const content = await drawTree(["row"], [{ id: "row", component: "Row", children: ["a", "b"] }, text("a", "One"), text("b", "Two")]);
  const row = around(content, "One", "flex-row");
  for (const name of ["flex", "flex-wrap", "min-w-0"]) assert.ok(classes(row).includes(name), name);
  assert.equal(row.textContent, "OneTwo");
});

test("a Row and a Column arrange their children as their justify and align say", async () => {
  const cases: [Component, string[]][] = [
    [{ component: "Row" }, ["justify-start", "items-stretch"]],
    [{ component: "Row", justify: "spaceBetween", align: "center" }, ["justify-between", "items-center"]],
    [{ component: "Row", justify: "spaceEvenly", align: "end" }, ["justify-evenly", "items-end"]],
    [{ component: "Column", justify: "spaceAround", align: "start" }, ["justify-around", "items-start"]],
    [{ component: "Column", justify: "center" }, ["justify-center", "items-stretch"]],
    [{ component: "Column", justify: "end" }, ["justify-end"]],
    [{ component: "Row", justify: "stretch" }, ["justify-stretch", "[&>*>*]:grow"]],
  ];
  for (const [props, expected] of cases) {
    const content = await drawTree(["box"], [{ id: "box", children: ["a"], ...props }, text("a", "One")]);
    const box = around(content, "One", props.component === "Row" ? "flex-row" : "flex-col");
    for (const name of expected) assert.ok(classes(box).includes(name), `${JSON.stringify(props)}: ${name} of ${box.className}`);
    await leavePage();
    await startPage();
  }
});

test("a weight is how much of a Row's or Column's room a component takes, whatever it is", async () => {
  const content = await drawTree(
    ["row"],
    [
      { id: "row", component: "Row", children: ["a", "b", "c"] },
      { ...text("a", "One"), weight: 2 },
      { id: "b", component: "TextField", label: "Name", value: "", weight: 1 },
      text("c", "Three"),
    ],
  );
  const grow = [...content.querySelectorAll<HTMLElement>("[data-weight]")].map((box) => box.style.flexGrow);
  assert.deepEqual(grow, ["2", "1"]);
});

test("a List is a list of its children, down or across", async () => {
  const items = { items: [{ name: "One" }, { name: "Two" }] };
  const row = text("row", { "@path": "name" });
  const down = await drawTree(["list"], [{ id: "list", component: "List", children: { componentId: "row", path: "/items" } }, row], items);
  assert.deepEqual(texts(down, "ul > li"), ["One", "Two"]);
  assert.ok(classes(one(down, "ul")).includes("flex-col"));
  await leavePage();
  await startPage();
  const across = await drawTree(["list"], [{ id: "list", component: "List", direction: "horizontal", align: "center", children: ["a", "b"] }, text("a", "One"), text("b", "Two")]);
  assert.deepEqual(texts(across, "ul > li"), ["One", "Two"]);
  for (const name of ["flex-row", "items-center", "overflow-x-auto", "max-w-full"]) assert.ok(classes(one(across, "ul")).includes(name), name);
});

test("a row stays the one it was as the data it is of moves and as it is typed in", async () => {
  // A ChoicePicker's value is a list of texts, so what the operator picks is a live list
  const options = ["a", "b", "c"].map((value) => ({ label: value.toUpperCase(), value }));
  const content = await drawTree(
    ["pick", "list", "names"],
    [
      { id: "pick", component: "ChoicePicker", variant: "multipleSelection", label: "Pick", options, value: { "@path": "/picked" } },
      { id: "list", component: "List", children: { componentId: "row", path: "/picked" } },
      text("row", { "@path": "" }),
      { id: "names", component: "List", children: { componentId: "name", path: "/names" } },
      { id: "name", component: "TextField", label: "Name", value: { "@path": "name" } },
    ],
    { picked: ["a", "b", "c"], names: [{ name: "x" }, { name: "y" }] },
  );
  const [picked, names] = [...content.querySelectorAll("ul")];
  const rows = [...picked.querySelectorAll("li")];
  assert.deepEqual(texts(picked, "li"), ["a", "b", "c"]);
  await click(content.querySelector<HTMLElement>('input[type="checkbox"]')!);
  const left = [...picked.querySelectorAll("li")];
  assert.deepEqual(texts(picked, "li"), ["b", "c"]);
  assert.deepEqual([left[0] === rows[1], left[1] === rows[2]], [true, true], "the rows are still the ones of b and c");

  const [first] = [...names.querySelectorAll("input")];
  await act(async () => first.focus());
  await put(first, "y");
  await put(first, "yy");
  assert.deepEqual([...names.querySelectorAll("input")].map(({ value }) => value), ["yy", "y"]);
  assert.equal(names.querySelector("input") === first && document.activeElement === first, true, "typing in a row leaves the focus in it");
});

/** Draws `part`, which is among `components`, and gives what changes its data model, as an agent's update will. */
async function drawWithData(part: string, components: Component[], dataModel: Data): Promise<{ content: HTMLElement; set: (path: string, value: unknown) => Promise<void> }> {
  const record = await acceptedRaw([create([{ id: "root", component: "Column", children: [part] }, ...components], { dataModel })]);
  const { SurfaceContent } = await loadA2ui();
  let held: SurfaceData | undefined;
  const layout = (props: LayoutProps) => {
    held = props.data;
    return props.part(part);
  };
  const content = await mount(createElement(SurfaceContent, { record, layout }));
  await settle();
  return { content, set: (path, value) => act(async () => held!.set(path, value)) };
}

test("rows put in another order, as many as they were, each stay the one they were", async () => {
  const row: Component[] = [
    { id: "row", component: "Card", child: "tabs" },
    { id: "tabs", component: "Tabs", tabs: [{ title: "Name", child: "name" }, { title: "Form", child: "form" }] },
    text("name", { "@path": "name" }),
    { id: "form", component: "Card", child: "inner" },
    { id: "inner", component: "Column", children: ["field"] },
    { id: "field", component: "TextField", label: "Name", value: { "@path": "name" } },
  ];
  for (const component of ["List", "Row", "Column"]) {
    const { content, set } = await drawWithData("box", [{ id: "box", component, children: { componentId: "row", path: "/rows" } }, ...row], { rows: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    await click([...content.querySelectorAll("button")].filter(({ textContent }) => textContent === "Form")[2]);
    const field = one<HTMLInputElement>(content, "input");
    await act(async () => field.focus());
    assert.equal(field.value, "c", component);

    await set("/rows", [{ name: "c" }, { name: "a" }, { name: "b" }]);
    const moved = one<HTMLInputElement>(content, "input");
    assert.deepEqual([moved.value, moved === field, document.activeElement === field], ["c", true, true], component);
    const pressed = [...content.querySelectorAll('[aria-pressed="true"]')].map(({ textContent }) => textContent);
    assert.deepEqual(pressed, ["Form", "Name", "Name"], component);
    await put(field, "cc");
    assert.deepEqual([one<HTMLInputElement>(content, "input") === field, texts(content, "a2ui-react-text")], [true, ["a", "b"]], component);
    await leavePage();
    await startPage();
  }
});

test("a template's rows are drawn a hundred at a time, and the rest are a press away", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ name: `row ${i}` }));
  for (const component of ["List", "Row", "Column"]) {
    const content = await drawTree(
      ["box"],
      [{ id: "box", component, children: { componentId: "row", path: "/rows" } }, text("row", { "@path": "name" })],
      { rows },
    );
    const drawn = () => texts(content, "a2ui-react-text");
    const more = () => one(content, '[role="button"]');
    const told = () => texts(content, '[role="status"]');
    assert.deepEqual([drawn().length, more().textContent, told()], [100, "Show 100 more", ["100 of 250 shown"]], component);
    await click(more());
    assert.deepEqual([drawn().length, more().textContent, told()], [200, "Show 50 more", ["200 of 250 shown"]], component);
    // A key does what a click does, as it does on a native button
    await act(async () => {
      more().focus();
      more().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    assert.deepEqual([drawn().length, drawn().pop(), told()], [250, "row 249", ["250 of 250 shown"]], component);
    assert.equal(content.querySelectorAll('[role="button"]').length, 0);
    assert.equal(document.activeElement === one(content, '[role="status"]'), true, "the focus has not gone with the button");
    await leavePage();
    await startPage();
  }
});

test("steps and options are drawn a hundred at a time too, and what is filtered for is found among all", async () => {
  const names = Array.from({ length: 150 }, (_, i) => `item ${i}`);
  const content = await drawTree(
    ["steps", "pick"],
    [
      { id: "steps", component: "Steps", steps: { "@path": "/steps" } },
      { id: "pick", component: "ChoicePicker", label: "Pick", filterable: true, options: names.map((name) => ({ label: name, value: name })), value: { "@path": "/pick" } },
    ],
    { steps: names.map((label) => ({ label, state: "pending" })) },
  );
  const drawn = () => [content.querySelectorAll("ol > li").length, content.querySelectorAll('input[type="radio"]').length];
  assert.deepEqual(drawn(), [100, 100]);
  for (const more of content.querySelectorAll<HTMLElement>('[role="button"]')) await click(more);
  assert.deepEqual(drawn(), [150, 150]);
  await put(one<HTMLInputElement>(content, 'input[type="search"]'), "item 14");
  assert.deepEqual(drawn(), [150, 11]);
});

test("a template of a hundred rows has nothing more to show", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ name: `row ${i}` }));
  const content = await drawTree(["list"], [{ id: "list", component: "List", children: { componentId: "row", path: "/rows" } }, text("row", { "@path": "name" })], { rows });
  assert.deepEqual([texts(content, "li").length, content.querySelectorAll('[role="status"], [role="button"]').length], [100, 0]);
});

test("a Card is a box around its child", async () => {
  const content = await drawTree(["card"], [{ id: "card", component: "Card", child: "a" }, text("a", "One")]);
  const card = around(content, "One", "border");
  for (const name of ["min-w-0", "rounded-md"]) assert.ok(classes(card).includes(name), name);
});

test("a Divider is a separator, across or down", async () => {
  const content = await drawAll([
    { id: "a", component: "Divider" },
    { id: "b", component: "Divider", axis: "vertical" },
  ]);
  assert.deepEqual(
    [...content.querySelectorAll("hr")].map((rule) => rule.getAttribute("aria-orientation")),
    ["horizontal", "vertical"],
  );
});

const TABS: Component[] = [
  {
    id: "tabs",
    component: "Tabs",
    tabs: [
      { title: "Plan", child: "a" },
      { title: { "@path": "/second" }, child: "b" },
      { title: "Plan", child: "c" },
    ],
    "@accessibility": { label: "Parts" },
  },
  text("a", "The plan"),
  text("b", "The risks"),
  text("c", "The other plan"),
];

test("Tabs are toggle buttons, of which the pressed one's child is drawn", async () => {
  const content = await drawTree(["tabs"], TABS, { second: "Risks" });
  const buttons = () => [...content.querySelectorAll("button")].map((button) => [button.textContent, button.getAttribute("aria-pressed")]);
  assert.deepEqual(buttons(), [["Plan", "true"], ["Risks", "false"], ["Plan", "false"]]);
  assert.equal(content.querySelectorAll('[role="tab"], [role="tablist"]').length, 0);
  assert.deepEqual([content.textContent!.includes("The plan"), content.textContent!.includes("The risks")], [true, false]);
  const group = one(content, '[role="group"][aria-label="Parts"]');
  assert.equal(group.querySelectorAll("button").length, 3);
  for (const name of ["overflow-x-auto", "max-w-full"]) assert.ok(classes(group).includes(name), name);

  await click(buttonOf(content, "Risks"));
  assert.deepEqual(buttons().map(([, pressed]) => pressed), ["false", "true", "false"]);
  assert.deepEqual([content.textContent!.includes("The plan"), content.textContent!.includes("The risks")], [false, true]);
  await click([...content.querySelectorAll("button")][2]);
  assert.deepEqual(buttons().map(([, pressed]) => pressed), ["false", "false", "true"], "two tabs of one title are two tabs");
  assert.ok(content.textContent!.includes("The other plan"));
});

test("what was typed in a tab is there when the operator comes back to it", async () => {
  const content = await drawTree(
    ["tabs"],
    [
      { id: "tabs", component: "Tabs", tabs: [{ title: "Form", child: "a" }, { title: "Help", child: "b" }] },
      { id: "a", component: "TextField", label: "Name", value: { "@path": "/name" } },
      text("b", "How to"),
    ],
  );
  await put(one<HTMLInputElement>(content, "input"), "Ann");
  await click(buttonOf(content, "Help"));
  assert.equal(content.querySelectorAll("input").length, 0);
  await click(buttonOf(content, "Form"));
  assert.equal(one<HTMLInputElement>(content, "input").value, "Ann");
});
