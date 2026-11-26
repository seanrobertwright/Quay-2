/// <reference types="node" />
// The catalog's inputs (#726), with only Tauri's `invoke` faked: a raw surface that the check accepted, as
// it is drawn, and what is put in it.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { text, type Component } from "./fixtures/rawFixtures.ts";
import { click, describedBy, drawAll, drawTree, labelOf, leavePage, one, put, startPage, texts } from "./fixtures/catalogFixtures.ts";

beforeEach(startPage);
afterEach(leavePage);

const at = (path: string) => ({ "@path": path });
const inputs = (content: HTMLElement) => [...content.querySelectorAll<HTMLInputElement>("input, textarea")];
/** Shows what the data model holds at `path`, as JSON. */
const shows = (path: string): Component => text("shown", { "@call": "formatString", args: { value: `\${${path}}` } });
const shown = (content: HTMLElement) => texts(content, "a2ui-react-text").pop();

const checked = (value: unknown, message: string) => ({ "@checks": [{ condition: { "@call": "required", args: { value } }, message }] });

test("a TextField takes what its variant says, and shows its placeholder", async () => {
  const field = (id: string, more: Component): Component => ({ id, component: "TextField", label: id, value: at(`/${id}`), ...more });
  const content = await drawAll([
    field("plain", { placeholder: "Ann" }),
    field("number", { variant: "number", placeholder: at("/hint") }),
    field("obscured", { variant: "obscured" }),
    field("long", { variant: "longText", placeholder: "Say more" }),
  ], { hint: "0.00", number: "4" });
  const drawn = inputs(content).map((input) => [input.tagName, input.type, input.placeholder, input.value, labelOf(input)]);
  assert.deepEqual(drawn, [
    ["INPUT", "text", "Ann", "", "plain"],
    ["INPUT", "number", "0.00", "4", "number"],
    ["INPUT", "password", "", "", "obscured"],
    ["TEXTAREA", "textarea", "Say more", "", "long"],
  ]);
  assert.equal(inputs(content)[2].getAttribute("autocomplete"), "off");
});

/** One of each input, its value bound under `/<id>` and required, with nothing in it. */
const EMPTY: Component[] = [
  { id: "field", component: "TextField", label: "Name", value: at("/field"), ...checked(at("/field"), "A name is needed.") },
  { id: "long", component: "TextField", variant: "longText", label: "Notes", value: at("/long"), ...checked(at("/long"), "Notes are needed.") },
  { id: "box", component: "CheckBox", label: "I agree", value: at("/box"), "@checks": [{ condition: at("/box"), message: "Agree first." }] },
  { id: "slider", component: "Slider", label: "Size", max: 10, value: at("/slider"), ...checked(at("/slider"), "A size is needed.") },
  { id: "when", component: "DateTimeInput", label: "When", value: at("/when"), ...checked(at("/when"), "A day is needed.") },
];

test("a failed check is told under its input, describes it and marks it, until it holds", async () => {
  const content = await drawAll(EMPTY);
  const said = () => inputs(content).map((input) => [describedBy(input), input.getAttribute("aria-invalid")]);
  assert.deepEqual(said(), [
    [["A name is needed."], "true"],
    [["Notes are needed."], "true"],
    [["Agree first."], "true"],
    [["A size is needed."], "true"],
    [["A day is needed."], "true"],
  ]);
  const [field, long, box, slider, when] = inputs(content);
  await put(field, "Ann");
  await put(long, "None");
  await click(box);
  await put(slider, "4");
  await put(when, "2026-10-21");
  assert.deepEqual(said().map(([words, invalid]) => [words?.length, invalid]), Array(5).fill([0, null]));
  assert.ok(!content.textContent!.includes("needed"));
});

test("ids are of the page's own making, and no two are the same", async () => {
  const content = await drawAll([
    ...EMPTY.map((component) => ({ ...component, id: `${String(component.id)}_1` })),
    ...EMPTY.map((component) => ({ ...component, id: `${String(component.id)}_2` })),
    { id: "pick", component: "ChoicePicker", label: "Pick", options: [{ label: "A", value: "a", description: "First" }], value: at("/pick"), ...checked(at("/pick"), "Pick one.") },
  ]);
  const ids = [...content.querySelectorAll("[id]")].map(({ id }) => id);
  assert.ok(ids.length >= 22, String(ids.length));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.filter((id) => /field|slider|when|box|pick|a2ui/.test(id)), []);
  assert.deepEqual(inputs(content).map((input) => labelOf(input)?.trim() !== ""), inputs(content).map(() => true));
});

test("an input's accessibility label and description are its own", async () => {
  const said = { "@accessibility": { label: at("/label"), description: "Told" } };
  const options = [{ label: "A", value: "a" }];
  const components: Component[] = [
    ...EMPTY.map((component) => ({ ...component, "@checks": [], ...said })),
    { id: "pick", component: "ChoicePicker", label: "Pick", options, value: [], ...said },
    { id: "press", component: "Button", child: "press_label", action: { event: { name: "go" } }, ...said },
    { id: "bar", component: "Progress", done: 1, total: 2, label: "Files", ...said },
    { id: "link", component: "FileLink", path: "a.ts", ...said },
    { id: "steps", component: "Steps", steps: [], ...said },
    { id: "said", component: "Stat", label: "passed", value: "4", ...said },
  ];
  const content = await drawTree(components.map(({ id }) => String(id)), [...components, text("press_label", "Press")], { label: "Named" });
  const named = [...content.querySelectorAll('[aria-label="Named"]')];
  assert.deepEqual(
    named.map((element) => element.localName),
    ["input", "textarea", "input", "input", "input", "fieldset", "button", "span", "button", "ol", "a2ui-react-stat"],
  );
  assert.ok(named.every((element) => element.getAttribute("aria-description") === "Told"));
});

const OPTIONS = [
  { label: "Rebase", value: "r", description: "Onto master", recommended: true },
  { label: at("/second"), value: "m" },
  { label: "Squash", value: "s" },
];

test("a ChoicePicker shows its label, and the options it has", async () => {
  const content = await drawAll([{ id: "pick", component: "ChoicePicker", label: at("/label"), options: OPTIONS, value: at("/pick") }], { label: "Which way?", second: "Merge", pick: ["m"] });
  const legend = one(content, "fieldset > legend");
  assert.deepEqual([legend.textContent, legend.className.includes("sr-only")], ["Which way?", false]);
  assert.deepEqual(inputs(content).map((input) => [input.type, input.checked, labelOf(input)]), [["radio", false, "Rebase"], ["radio", true, "Merge"], ["radio", false, "Squash"]]);
});

test("a ChoicePicker of chips is as native and as labelled, with the same marks", async () => {
  const content = await drawAll(
    [{ id: "pick", component: "ChoicePicker", label: "Pick", variant: "multipleSelection", displayStyle: "chips", options: OPTIONS, value: at("/pick") }, shows("/pick")],
    { second: "Merge", pick: [] },
  );
  const chips = inputs(content);
  assert.deepEqual(chips.map((input) => [input.type, input.checked, labelOf(input)]), [["checkbox", false, "Rebase"], ["checkbox", false, "Merge"], ["checkbox", false, "Squash"]]);
  assert.deepEqual(describedBy(chips[0]), ["agent's pick", "Onto master"]);
  const box = chips[0].parentElement!.parentElement!;
  assert.deepEqual(["flex", "flex-wrap"].filter((name) => !box.className.split(" ").includes(name)), []);
  await click(chips[2]);
  assert.equal(shown(content), '["s"]');
});

test("a ChoicePicker that can be filtered shows what matches, and keeps what is chosen", async () => {
  const content = await drawAll(
    [{ id: "pick", component: "ChoicePicker", label: "Pick", variant: "multipleSelection", filterable: true, options: OPTIONS, value: at("/pick") }, shows("/pick")],
    { second: "Merge", pick: ["r"] },
  );
  const filter = one<HTMLInputElement>(content, 'input[type="search"]');
  assert.equal(labelOf(filter), "Filter the options");
  const boxes = () => inputs(content).filter(({ type }) => type === "checkbox");
  await put(filter, " mASTER ");
  assert.deepEqual(boxes().map(labelOf), ["Rebase"], "an option's description matches too");
  await put(filter, "quas");
  assert.deepEqual(boxes().map(labelOf), ["Squash"]);
  await click(boxes()[0]);
  assert.equal(shown(content), '["r","s"]');
  await put(filter, "zzz");
  assert.deepEqual([boxes().length, texts(content, '[role="status"]')], [0, ["No option matches."]]);
  await put(filter, "");
  assert.deepEqual(boxes().map(({ checked: on }) => on), [true, false, true]);
});

test("a ChoicePicker's failed check describes the group it is of", async () => {
  const content = await drawAll([
    { id: "pick", component: "ChoicePicker", label: "Pick", options: [{ label: "A", value: "a" }], value: at("/pick"), ...checked(at("/pick"), "Pick one.") },
  ]);
  const group = one(content, "fieldset");
  assert.deepEqual([describedBy(group), group.getAttribute("aria-invalid"), group.getAttribute("role")], [["Pick one."], "true", "radiogroup"]);
  await click(inputs(content)[0]);
  assert.deepEqual([describedBy(group), group.getAttribute("aria-invalid")], [[], null]);
});

test("options that share a value are each drawn", async () => {
  const content = await drawAll([{ id: "pick", component: "ChoicePicker", options: [{ label: "A", value: "x" }, { label: "B", value: "x" }], value: [] }]);
  assert.deepEqual(inputs(content).map(labelOf), ["A", "B"]);
});

test("a Slider is a labelled native range that says its value and writes a number", async () => {
  const slider = (id: string, more: Component): Component => ({ id, component: "Slider", label: id, max: 100, value: at(`/${id}`), ...more });
  const content = await drawAll(
    [slider("a", {}), slider("b", { min: 10, max: 20, steps: 4 }), slider("c", { max: 1 }), slider("d", { label: undefined, value: 7 }), shows("/a")],
    { a: 40, b: 15, c: "none" },
  );
  const ranges = inputs(content);
  assert.deepEqual(ranges.map(({ type, min, max, step, value }) => [type, min, max, step, value]), [
    ["range", "0", "100", "1", "40"],
    ["range", "10", "20", "2.5", "15"],
    ["range", "0", "1", "0.01", "0"],
    ["range", "0", "100", "1", "7"],
  ]);
  assert.deepEqual(ranges.map(labelOf), ["a", "b", "c", "Value"]);
  assert.deepEqual(texts(content, "output"), ["40", "15", "0", "7"]);
  await put(ranges[0], "62");
  assert.deepEqual([shown(content), texts(content, "output")[0]], ["62", "62"]);
});

test("a DateTimeInput is a labelled native input of the parts it takes", async () => {
  const when = (id: string, more: Component): Component => ({ id, component: "DateTimeInput", value: at(`/${id}`), ...more });
  const content = await drawAll(
    [
      when("a", { label: "Day", enableDate: true, min: "2026-01-01", max: at("/last") }),
      when("b", { label: "Time", enableTime: true, min: "08:00:00" }),
      when("c", { label: "Both", enableDate: true, enableTime: true }),
      when("d", {}),
      when("e", { enableTime: true }),
      when("f", { enableDate: true, enableTime: true }),
      when("g", { enableDate: true, enableTime: true, min: "2026-01-01", max: "2026-12-31" }),
      when("h", { enableDate: true, enableTime: true, max: "2026-12-31T08:00" }),
    ],
    { a: "2026-10-21", b: "14:06:11", c: "2026-10-21T14:06:11", d: "2026-02-30", e: "tomorrow", f: 4, last: "2026-12-31" },
  );
  assert.deepEqual(inputs(content).map(({ type, value, min, max }) => [type, value, min, max]), [
    ["date", "2026-10-21", "2026-01-01", "2026-12-31"],
    ["time", "14:06", "08:00", ""],
    ["datetime-local", "2026-10-21T14:06", "", "9999-12-31T23:59"],
    ["date", "", "", "9999-12-31"],
    ["time", "", "", ""],
    ["datetime-local", "", "", "9999-12-31T23:59"],
    // The last day it takes is all of that day
    ["datetime-local", "", "2026-01-01T00:00", "2026-12-31T23:59"],
    ["datetime-local", "", "", "2026-12-31T08:00"],
  ]);
  assert.deepEqual(inputs(content).map(labelOf), ["Day", "Time", "Both", "Date", "Time", "Date and time", "Date and time", "Date and time"]);
});

test("an empty DateTimeInput of each type takes all the width it is given, with no cap, so its placeholder has room in a narrow pane", async () => {
  const content = await drawAll([
    { id: "d", component: "DateTimeInput", enableDate: true, value: at("/d") },
    { id: "t", component: "DateTimeInput", enableTime: true, value: at("/t") },
    { id: "b", component: "DateTimeInput", enableDate: true, enableTime: true, value: at("/b") },
  ]);
  const looks = inputs(content).map((input) => {
    const names = input.className.split(" ");
    return [input.type, names.includes("w-full"), names.some((name) => /^max-w-/.test(name))];
  });
  assert.deepEqual(looks, [
    ["date", true, false],
    ["time", true, false],
    ["datetime-local", true, false],
  ]);
});

test("a DateTimeInput shows and writes the digits of its zone, and says which zone that is", async () => {
  const cases: [unknown, string | null | undefined, string, string, string][] = [
    ["2026-10-21T14:06:11Z", "When (UTC)", "2026-10-21T14:06", "2026-10-22T09:30", "2026-10-22T09:30Z"],
    ["2026-10-21T14:06+02:00", "When (UTC+02:00)", "2026-10-21T14:06", "2026-10-22T09:30", "2026-10-22T09:30+02:00"],
    ["2026-10-21T14:06", "When", "2026-10-21T14:06", "2026-10-22T09:30", "2026-10-22T09:30"],
    ["2026-10-21", "When", "2026-10-21T00:00", "0002-10-22T09:30", "0002-10-22T09:30"],
    ["", "When", "", "2026-10-22T09:30", "2026-10-22T09:30"],
    ["2026-10-21T14:06:11Z", "When (UTC)", "2026-10-21T14:06", "", ""],
  ];
  for (const [value, label, drawn, typed, written] of cases) {
    const content = await drawAll([{ id: "when", component: "DateTimeInput", label: "When", enableDate: true, enableTime: true, value: at("/when") }, shows("/when")], { when: value });
    const [input] = inputs(content);
    assert.deepEqual([labelOf(input), input.value], [label, drawn], String(value));
    await put(input, typed);
    assert.deepEqual([shown(content), inputs(content)[0].value], [written, typed], String(value));
    await leavePage();
    await startPage();
  }
});

test("a DateTimeInput keeps its zone while it is empty, as a native input is for a moment when its year is typed", async () => {
  const content = await drawAll([{ id: "when", component: "DateTimeInput", label: "When", enableDate: true, enableTime: true, value: at("/when") }, shows("/when")], { when: "2026-10-21T14:06+02:00" });
  const [input] = inputs(content);
  await put(input, "");
  assert.deepEqual([shown(content), labelOf(input)], ["", "When (UTC+02:00)"]);
  await put(input, "2027-01-02T03:04");
  assert.deepEqual([shown(content), labelOf(input)], ["2027-01-02T03:04+02:00", "When (UTC+02:00)"]);
});
