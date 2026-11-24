/// <reference types="node" />
// What the engine's check and the post-check reject a raw call for (#725), at the check Rust asks for.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { CheckError } from "./surfaceTypes.ts";
import { startRust, unloadSurfaces } from "./fixtures/fakeRust.ts";
import { button, column, create, errorsIn, EVENT, oneButton, text, told, verdictOnCall, verdictOnRaw, type Component } from "./fixtures/rawFixtures.ts";

beforeEach(() => startRust({ surface_list: () => [], surface_checks: () => [] }));
afterEach(() => unloadSurfaces());

const update = (components: Component[]) => ({ version: "1.0", updateComponents: { surfaceId: "plan", components } });
const setData = (value: object) => ({ version: "1.0", updateDataModel: { surfaceId: "plan", ...value } });

/** Each error's code and path. */
const where = (errors: readonly CheckError[]) => errors.map(({ code, path }) => [code, path]);

test("the engine's path is put after the message's own, and the engine's words are told as they are", async () => {
  const [error, ...others] = await errorsIn([create(column({ ...text("said", "x"), variant: "h2" }))]);
  assert.equal(others.length, 0);
  assert.deepEqual([error.code, error.surfaceId, error.path], ["VALIDATION_FAILED", "plan", "/messages/0/createSurface/components/1/variant"]);
  assert.match(error.message, /^Validation failed for component 'Text' \(said\): variant: /);

  const later = await errorsIn([create(column(text("said", "x"))), update([{ ...text("said", "x"), colour: "red" }])]);
  assert.deepEqual(where(later), [["VALIDATION_FAILED", "/messages/1/updateComponents/components/0/colour"]]);
});

test("an error the engine gives no path is told at the message, or at the component the engine names", async () => {
  const said = text("said", "x");
  const cases: [unknown[], [string, string][]][] = [
    // No root
    [[create([said])], [["INTEGRITY_ERROR", "/messages/0/createSurface"]]],
    [[create([])], [["VALIDATION_FAILED", "/messages/0/createSurface/components"]]],
    [[{ version: "1.0", createSurface: { surfaceId: "plan" } }], [["INTEGRITY_ERROR", "/messages/0/createSurface"]]],
    // A dangling child
    [[create(column(said).concat({ id: "more", component: "Column", children: ["nowhere"] }))], [["INTEGRITY_ERROR", "/messages/0/createSurface/components/2"]]],
    // An orphan
    [[create([...column(said), text("lost", "x")])], [["INTEGRITY_ERROR", "/messages/0/createSurface/components/2"]]],
    [[create(column(said)), update([text("lost", "x")])], [["INTEGRITY_ERROR", "/messages/1/updateComponents/components/0"]]],
    // A cycle
    [[create([{ id: "root", component: "Column", children: ["in"] }, { id: "in", component: "Column", children: ["root"] }])], [["RECURSION_LIMIT_EXCEEDED", "/messages/0/createSurface/components/1"]]],
    [[create([{ id: "root", component: "Column", children: ["root"] }])], [["RECURSION_LIMIT_EXCEEDED", "/messages/0/createSurface/components/0"]]],
    // A path through a value, which the engine tells by where in the data it is
    [[create(column(said), { dataModel: { a: 1 } }), setData({ path: "/a/b", value: 1 })], [["DATA_ERROR", "/messages/1/updateDataModel"]]],
    [[create(column(said)), setData({ path: "a", value: 1 })], [["VALIDATION_FAILED", "/messages/1/updateDataModel/path"]]],
    [[create("x")], [["VALIDATION_FAILED", "/messages/0/createSurface/components"]]],
    [[{ version: "1.0", createSurface: { surfaceId: "plan", components: column(said), extra: 1 } }], [["VALIDATION_FAILED", "/messages/0/createSurface/extra"]]],
  ];
  for (const [messages, expected] of cases) assert.deepEqual(where(await errorsIn(messages)), expected, JSON.stringify(messages));
});

test("an update that leaves the surface broken is no less rejected when the create was whole", async () => {
  const errors = await errorsIn([create(column(text("said", "x"))), update([{ id: "root", component: "Column", children: [] }])]);
  assert.deepEqual(where(errors), [["INTEGRITY_ERROR", "/messages/0/createSurface/components/1"]]);
});

test("a data model that is no object is rejected at the value", async () => {
  for (const value of [5, "x", [1]]) {
    assert.deepEqual(told(await errorsIn([create(column(text("said", "x"))), setData({ value })])), [["VALIDATION_FAILED", "/messages/1/updateDataModel/value", "A surface's data model is an object."]]);
  }
});

test("errors that only follow from a failed create are left out, and others are told", async () => {
  const bad = create(column({ ...text("said", "x"), variant: "h2" }));
  assert.deepEqual(where(await errorsIn([bad, setData({ path: "/a", value: 1 })])), [["VALIDATION_FAILED", "/messages/0/createSurface/components/1/variant"]]);
  assert.deepEqual(
    where(await errorsIn([{ ...create(column(text("said", "x"))), version: "v0.9" }, update([{ ...text("said", "x"), checks: [] }]), setData({ path: "/a", value: 1 })])),
    [["VALIDATION_FAILED", "/messages/0/version"], ["VALIDATION_FAILED", "/messages/1/updateComponents/components/0/checks"]],
  );
});

test("each message's error is told, in the order of the messages, and whether the surface is whole is then not asked", async () => {
  const errors = await errorsIn([
    create([{ id: "root", component: "Column", children: ["said"] }]),
    update([{ ...text("said", "x"), variant: "h2" }]),
    setData({ path: "/frame", value: 1 }),
    update([{ id: "more", component: "Nothing" }]),
  ]);
  assert.deepEqual(
    errors.map(({ path }) => path),
    ["/messages/1/updateComponents/components/0/variant", "/messages/2/updateDataModel/path", "/messages/3/updateComponents/components/0/component"],
  );
});

test("more than ten errors are the first ten and how many are left", async () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ ...text(`t${i}`, "x"), checks: [] }));
  const verdict = await verdictOnRaw([create(column(...many))]);
  assert.ok("errors" in verdict);
  assert.deepEqual([verdict.errors.length, verdict.more], [10, 4]);
});

test("an unknown component is told with the catalog's names, and with advice for what Quay does not draw", async () => {
  const media = " Quay plays no media. Link the file with FileLink.";
  const advice: [string, string][] = [["Carousel", ""], ["Modal", " Quay draws no modal. Put the content in the surface, or use place tab."], ["Video", media], ["AudioPlayer", media]];
  for (const [component, said] of advice) {
    const [error, ...others] = await errorsIn([create(column({ id: "x", component }))]);
    assert.equal(others.length, 0);
    assert.deepEqual([error.code, error.path], ["VALIDATION_FAILED", "/messages/0/createSurface/components/1/component"]);
    const [, listed, rest] = /^Unknown component type '\w+' not found in catalog 'urn:quay:a2ui:catalog:v1'\. The catalog's components are ([\w, ]+)\.(.*)$/.exec(error.message)!;
    assert.equal(rest, said);
    for (const name of ["Button", "ChoicePicker", "Column", "FileLink", "Image", "Progress", "Stat", "Steps", "Text", "TextField"]) assert.ok(listed.split(", ").includes(name), name);
    assert.ok(!listed.includes(component));
  }
});

test("an unknown function is told with the catalog's names", async () => {
  assert.deepEqual(told(await errorsIn([create(column(text("said", { "@call": "shout", args: {} })))])), [
    ["VALIDATION_FAILED", "/messages/0/createSurface/components/1/text", "Unrecognized function 'shout'. The catalog's functions are openUrl, showFile."],
  ]);
});

const open = { "@call": "openUrl", args: { url: "https://quay.example" } };

test("an effect anywhere but a Button's action is rejected, at the call", async () => {
  const show = { "@call": "showFile", args: { path: "a.ts" } };
  const cases: [Component[], string][] = [
    [column(text("said", open)), "1/text"],
    [column({ ...text("said", "x"), "@accessibility": { label: open } }), "1/@accessibility/label"],
    [oneButton(EVENT, { "@checks": [{ condition: open, message: "x" }] }), "1/@checks/0/condition"],
    [oneButton({ functionCall: { "@call": "openUrl", args: { url: open } } }), "1/action/functionCall/args/url"],
    [oneButton({ event: { name: "go", context: { a: open } } }), "1/action/event/context/a"],
    [[{ id: "root", component: "Column", children: { componentId: "row", path: "/rows" } }, text("row", open)], "1/text"],
    [column({ id: "name", component: "TextField", value: "", label: open }), "1/label"],
  ];
  for (const [components, place] of cases) {
    assert.deepEqual(told(await errorsIn([create(components)])), [["VALIDATION_FAILED", `/messages/0/createSurface/components/${place}`, "openUrl runs only as a Button's action."]], place);
  }
  assert.deepEqual(told(await errorsIn([create(column(text("said", show)))])).map(([, , message]) => message), ["showFile runs only as a Button's action."]);
  assert.deepEqual(where(await errorsIn([create(column(text("said", "x"))), update([text("said", open)])])), [["VALIDATION_FAILED", "/messages/1/updateComponents/components/0/text"]]);
});

test("an effect as a Button's action is accepted, in a template too", async () => {
  const [go, label] = button("go", { functionCall: open });
  const rows = { id: "root", component: "Column", children: { componentId: "go", path: "/rows" } };
  for (const components of [oneButton({ functionCall: open }), [rows, go, label]]) {
    const verdict = await verdictOnRaw([create(components)]);
    assert.equal("asks" in verdict && verdict.asks, false, JSON.stringify(verdict));
  }
});

test("a strip surface with an action to its agent is rejected at the action, and one that opens a page is not", async () => {
  const message = "A strip surface cannot send an action to its agent. Use place companion or tab.";
  assert.deepEqual(told(await errorsIn([create(oneButton(EVENT))], "strip")), [["VALIDATION_FAILED", "/messages/0/createSurface/components/1/action", message]]);
  const opens = await verdictOnRaw([create(oneButton({ functionCall: open }))], "strip");
  assert.ok("state" in opens, JSON.stringify(opens));
});

test("a surface at every limit is accepted, and past one it is rejected by its name, at the message", async () => {
  const texts = (count: number) => column(...Array.from({ length: count - 1 }, (_, i) => text(`t${i}`, "x")));
  const images = (count: number) => column(...Array.from({ length: count }, (_, i) => ({ id: `i${i}`, component: "Image", url: `i${i}.png` })));
  // {"a":"…"} is eight bytes more than what it holds
  const data = (bytes: number) => ({ dataModel: { a: "x".repeat(bytes - 8) } });
  const most = 256 * 1024;
  for (const messages of [[create(texts(500))], [create(images(12))], [create(texts(2), data(most))]]) {
    const verdict = await verdictOnRaw(messages);
    assert.ok("state" in verdict, JSON.stringify(verdict).slice(0, 300));
  }
  const cases: [unknown[], string][] = [
    [[create(texts(640))], "A surface has at most 500 components; this one would have 640."],
    [[create(images(13))], "A surface has at most 12 images; this one would have 13."],
    [[create(texts(2), data(most + 1))], "A surface has at most 256 kB of data; this one would have 257 kB."],
    // Bytes, not characters
    [[create(texts(2), { dataModel: { a: "é".repeat(most / 2) } })], "A surface has at most 256 kB of data; this one would have 257 kB."],
  ];
  for (const [messages, said] of cases) assert.deepEqual(told(await errorsIn(messages)), [["VALIDATION_FAILED", "/messages/0/createSurface", said]]);
});

test("a call that creates nothing is told what is wrong with it, or nothing", async () => {
  const only = (messages: unknown[]) => verdictOnCall(messages);
  assert.deepEqual(await only([{ version: "1.0", deleteSurface: { surfaceId: "gone" } }]), { surfaces: [] });
  const verdict = await only([{ version: "v0.9", deleteSurface: { surfaceId: "gone" } }]);
  assert.deepEqual("errors" in verdict && where(verdict.errors), [["VALIDATION_FAILED", "/messages/0/version"]]);
  const odd = { version: "1.0", deleteSurface: { surfaceId: "gone", why: "x" } };
  const found = await only([odd]);
  assert.deepEqual("errors" in found && where(found.errors), [["VALIDATION_FAILED", "/messages/0/deleteSurface/why"]]);
  assert.deepEqual(where(await errorsIn([odd, create(column(text("said", "x")))])), [["VALIDATION_FAILED", "/messages/0/deleteSurface/why"]]);
});
