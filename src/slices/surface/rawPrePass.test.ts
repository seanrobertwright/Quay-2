/// <reference types="node" />
// What a raw call is rejected for before the engine sees it (#725), at the check Rust asks for.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startRust, unloadSurfaces } from "./fixtures/fakeRust.ts";
import { column, create, errorsIn, EVENT, oneButton, text, told, verdictOnRaw, type Component } from "./fixtures/rawFixtures.ts";

beforeEach(() => startRust({ surface_list: () => [], surface_checks: () => [] }));
afterEach(() => unloadSurfaces());

const SAID = column(text("said", "Hello"));

test("another version is rejected by what the message says, and so is none", async () => {
  const cases: [unknown, string][] = [["v0.9", '"v0.9"'], ["v0.9.1", '"v0.9.1"'], ["v1.0", '"v1.0"'], [1, "1"], [undefined, "no version"]];
  for (const [version, says] of cases) {
    const message = `Quay accepts A2UI 1.0 only. This message says ${says}.`;
    assert.deepEqual(told(await errorsIn([{ ...create(SAID), version }])), [["VALIDATION_FAILED", "/messages/0/version", message]]);
  }
});

test("a bare envelope key on a component is rejected with its 1.0 spelling, at the key", async () => {
  for (const [key, value] of Object.entries({ accessibility: { label: "x" }, checks: [], catalogId: "x", metadata: {} })) {
    assert.deepEqual(
      told(await errorsIn([create(column({ ...text("said", "Hello"), [key]: value }))])),
      [["VALIDATION_FAILED", `/messages/0/createSurface/components/1/${key}`, `A2UI 1.0 spells this \`@${key}\`.`]],
    );
  }
});

const at = (path: string, key: string) => [["VALIDATION_FAILED", `/messages/0/createSurface/components/1/${path}`, `A2UI 1.0 spells this \`@${key}\`.`]];

test("a bare path or call binding is rejected wherever a component holds one, at the key", async () => {
  const cases: [Component[], string, string][] = [
    [column(text("said", { path: "/a" })), "text/path", "path"],
    [column(text("said", { call: "formatString", args: {} })), "text/call", "call"],
    [column({ ...text("said", "x"), "@accessibility": { label: { path: "/a" } } }), "@accessibility/label/path", "path"],
    [oneButton({ event: { name: "go", context: { a: { path: "/a" } } } }), "action/event/context/a/path", "path"],
    [oneButton({ functionCall: { call: "openUrl", args: { url: "x" } } }), "action/functionCall/call", "call"],
    [oneButton({ functionCall: { "@call": "openUrl", args: { url: { path: "/a" } } } }), "action/functionCall/args/url/path", "path"],
    [oneButton(EVENT, { "@checks": [{ condition: { path: "/ready" } }] }), "@checks/0/condition/path", "path"],
    // Only a list of children may be a template
    [column(text("said", { componentId: "x", path: "/a" })), "text/path", "path"],
  ];
  for (const [components, path, key] of cases) assert.deepEqual(told(await errorsIn([create(components)])), at(path, key), path);
});

test("path stays bare in a list template, in updateDataModel, as a function's argument and as a component's own property", async () => {
  const verdict = await verdictOnRaw([
    create([
      { id: "root", component: "Column", children: { componentId: "row", path: "/rows" } },
      { id: "row", component: "Column", children: ["said", "file", "show", "send"] },
      text("said", { "@path": "name" }),
      { id: "file", component: "FileLink", path: "src/a.ts" },
      { id: "show", component: "Button", child: "show_label", action: { functionCall: { "@call": "showFile", args: { path: "src/a.ts" } } } },
      text("show_label", "Show"),
      { id: "send", component: "Button", child: "send_label", action: { event: { name: "go", context: { path: "src/a.ts", call: "x" } } } },
      text("send_label", "Send"),
    ]),
    { version: "1.0", updateDataModel: { surfaceId: "plan", path: "/rows", value: [{ name: "One", path: "/not/a/binding", call: "x" }] } },
  ]);
  assert.ok("state" in verdict, JSON.stringify(verdict));
});

test("theme, sendDataModel and another catalog are each rejected at the key", async () => {
  const cases: [string, unknown, string][] = [
    ["theme", { primaryColor: "#fff" }, "A2UI 1.0 has no `theme`. Leave it out."],
    ["sendDataModel", true, "Quay returns an action's context only. Put the values you need in the action's context."],
    ["catalogId", "https://a2ui.org/basic", "Quay's catalog is `urn:quay:a2ui:catalog:v1`. Leave catalogId out, and see quay_surface_guide."],
  ];
  for (const [key, value, message] of cases) {
    assert.deepEqual(told(await errorsIn([create(SAID, { [key]: value })])), [["VALIDATION_FAILED", `/messages/0/createSurface/${key}`, message]]);
  }
});

test("a message that is not create, update or delete is rejected", async () => {
  const kinds = "A message has a version and one of createSurface, updateComponents, updateDataModel and deleteSurface.";
  const cases: [unknown, string, string][] = [
    [{ version: "1.0", callRendererFunction: { functionCallId: "f", callFunction: { "@call": "openUrl" } } }, "/messages/1/callRendererFunction", "Quay offers no function an agent may call."],
    [{ version: "1.0", agentFunctionResponse: { functionCallId: "f", value: 1 } }, "/messages/1/agentFunctionResponse", "Quay sends no function calls to an agent."],
    [{ version: "1.0", beginRendering: {} }, "/messages/1", kinds],
    [{ version: "1.0" }, "/messages/1", kinds],
    [{ version: "1.0", deleteSurface: { surfaceId: "x" }, updateDataModel: { surfaceId: "plan" } }, "/messages/1", kinds],
    ["createSurface", "/messages/1", kinds],
    [null, "/messages/1", kinds],
    [[create(SAID)], "/messages/1", kinds],
    // The engine's own inner form of a message, which skips its schema
    [{ version: "1.0", type: "updateDataModel", surfaceId: "plan", path: "/a", value: 1 }, "/messages/1", kinds],
    [{ version: "1.0", type: "updateDataModel", updateDataModel: { surfaceId: "plan", value: {} } }, "/messages/1", kinds],
  ];
  for (const [message, path, said] of cases) {
    assert.deepEqual(told(await errorsIn([create(SAID), message])), [["VALIDATION_FAILED", path, said]], JSON.stringify(message));
  }
});

test("a raw surface can neither write nor read /frame, however its path is spelled", async () => {
  const frame = 'Quay keeps "/frame" for itself. Use another path.';
  const field = (path: string) => column({ id: "name", component: "TextField", label: "Name", value: { "@path": path } });
  const update = (value: object) => [create(SAID), { version: "1.0", updateDataModel: { surfaceId: "plan", ...value } }];
  const cases: [unknown[], string][] = [
    [[create(SAID, { dataModel: { frame: { ready: true } } })], "/messages/0/createSurface/dataModel/frame"],
    [update({ path: "/frame/ready", value: true }), "/messages/1/updateDataModel/path"],
    [update({ path: "//frame/", value: {} }), "/messages/1/updateDataModel/path"],
    [update({ value: { frame: {} } }), "/messages/1/updateDataModel/value/frame"],
    [update({ path: "/", value: { frame: {} } }), "/messages/1/updateDataModel/value/frame"],
    ...["/frame/ready", "frame/ready", "//frame", "/frame"].map((path): [unknown[], string] => [[create(field(path))], "/messages/0/createSurface/components/1/value/@path"]),
    [[create([{ id: "root", component: "Column", children: { componentId: "row", path: "/frame/opened" } }, text("row", "x")])], "/messages/0/createSurface/components/0/children/path"],
  ];
  for (const [messages, path] of cases) assert.deepEqual(told(await errorsIn(messages)), [["VALIDATION_FAILED", path, frame]], path);
  const verdict = await verdictOnRaw([create(field("/frames/frame"), { dataModel: { frames: { frame: "x" } } })]);
  assert.ok("state" in verdict, "only the path itself is Quay's");
});

test("everything the pre-pass finds is told, in the order it is in the call", async () => {
  const bad = { ...text("said", { path: "/a" }), checks: [] };
  const found = await errorsIn([create(column(bad), { theme: {} }), { version: "v0.9", updateDataModel: { surfaceId: "plan" } }]);
  assert.deepEqual(
    found.map(({ path }) => path),
    ["/messages/0/createSurface/components/1/text/path", "/messages/0/createSurface/components/1/checks", "/messages/0/createSurface/theme", "/messages/1/version"],
  );
  assert.ok(found.every(({ surfaceId }) => surfaceId === "plan"));
});
