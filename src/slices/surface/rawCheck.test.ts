/// <reference types="node" />
// What the webview makes of a quay_surface call (#725), at the check Rust asks for.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startRust, unloadSurfaces } from "./fixtures/fakeRust.ts";
import { button, column, create, EVENT, oneButton, text, verdictOnRaw } from "./fixtures/rawFixtures.ts";

beforeEach(() => startRust({ surface_list: () => [], surface_checks: () => [] }));
afterEach(() => unloadSurfaces());

test("a raw surface is accepted as one createSurface under Quay's catalog, which the call may name or leave out", async () => {
  const components = column(text("said", "Hello"));
  for (const more of [{}, { catalogId: "urn:quay:a2ui:catalog:v1" }]) {
    const verdict = await verdictOnRaw([create(components, { dataModel: { a: 1 }, ...more })]);
    assert.ok("state" in verdict, JSON.stringify(verdict));
    assert.deepEqual(verdict.state, { version: "1.0", createSurface: { surfaceId: "plan", catalogId: "urn:quay:a2ui:catalog:v1", components, dataModel: { a: 1 } } });
    assert.deepEqual({ asks: verdict.asks, components: verdict.components, images: verdict.images }, { asks: false, components: 2, images: 0 });
  }
});

test("a raw surface with an action to its agent asks, and one whose button opens a page does not", async () => {
  const asks = await verdictOnRaw([create(oneButton(EVENT))]);
  assert.equal("asks" in asks && asks.asks, true);
  const opens = await verdictOnRaw([create(oneButton({ functionCall: { "@call": "openUrl", args: { url: "https://quay.example" } } }))]);
  assert.equal("asks" in opens && opens.asks, false);
});

test("what later messages of the call put in the surface is in its state, in any order", async () => {
  const [go, label] = button("go", EVENT);
  const verdict = await verdictOnRaw([
    create([{ id: "root", component: "Column", children: ["said", "go"] }]),
    { version: "1.0", updateComponents: { surfaceId: "plan", components: [label, go] } },
    { version: "1.0", updateDataModel: { surfaceId: "plan", path: "/a", value: "x" } },
    { version: "1.0", updateComponents: { surfaceId: "plan", components: [text("said", { "@path": "/a" })] } },
  ]);
  assert.ok("state" in verdict, JSON.stringify(verdict));
  const { components, dataModel } = verdict.state.createSurface;
  assert.deepEqual(new Set(components.map(({ id }) => id)), new Set(["root", "go", "go_label", "said"]));
  assert.deepEqual([dataModel, verdict.asks, verdict.components], [{ a: "x" }, true, 4]);
});
