/// <reference types="node" />
// What the check counts of a surface (#765) against what the engine resolves of it and what is drawn, so that
// an upgrade of the engine that reads a path or a child otherwise is seen.
import "../../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DataModel, NodeResolver } from "@a2ui/web_core/v1_0";
import { drawRecord, leavePage, startPage } from "../fixtures/catalogFixtures.ts";
import { acceptedRaw, button, create, EVENT, holds, listOf, rows, text, times, verdictOnRaw, type Component } from "../fixtures/rawFixtures.ts";
import type { Accepted, SurfaceComponent } from "../surfaceTypes.ts";

const { engineFor } = await import("./engine.ts");
const { drawnSize, isPast } = await import("./drawnSize.ts");

beforeEach(startPage);
afterEach(leavePage);

/** Surfaces with nothing in them that counts for more than one component. */
const SURFACES: Record<string, [Component[], object]> = {
  "each way to hold components": [
    [
      { id: "root", component: "Column", children: ["row", "card", "card", "go"] },
      { id: "row", component: "Row", children: ["said", "said", "list"] },
      listOf("list", "said", "/rows", "List"),
      { id: "card", component: "Card", child: "inner" },
      { id: "inner", component: "Column", children: ["said", "line"] },
      { id: "line", component: "Divider" },
      text("said", "x"),
      ...button("go", EVENT),
    ],
    { rows: rows(7) },
  ],
  "rows in rows, by paths of each kind": [
    [
      { id: "root", component: "Column", children: ["plain", "under", "escaped", "none", "text", "missing"] },
      listOf("plain", "row", "/rows"),
      listOf("under", "leaf", "/rows/1/cells"),
      listOf("escaped", "leaf", "/a~1b"),
      listOf("none", "leaf", "/empty"),
      listOf("text", "leaf", "/said"),
      listOf("missing", "leaf", "/rows/x/cells"),
      { id: "row", component: "Row", children: ["cells", "again", "all"] },
      listOf("cells", "leaf", "cells"),
      listOf("again", "leaf", "./cells"),
      listOf("all", "leaf", "/rows/0/cells"),
      text("leaf", "x"),
    ],
    { rows: times(5, (i) => ({ cells: rows(i) })), "a/b": [1, 2, 3], empty: [], said: "three" },
  ],
  "rows that are lists": [[listOf("root", "row", "/rows"), listOf("row", "cell", "."), listOf("cell", "leaf", "."), text("leaf", "x")], { rows: times(4, (i) => times(i, (j) => rows(j))) }],
  "rows that draw their own data": [[listOf("root", "row", "/rows"), { id: "row", component: "Row", children: ["name", "size"] }, text("name", { "@path": "name" }), text("size", { "@path": "/size" })], { rows: times(9, (i) => ({ name: `row ${i}` })), size: 4 }],
};

for (const [name, [components, dataModel]] of Object.entries(SURFACES)) {
  test(`what is counted is what the engine resolves and what is drawn: ${name}`, async () => {
    const record = await acceptedRaw([create(components, { dataModel })]);
    const { drawn_at_once, drawn_with_rows } = (await verdictOnRaw([create(components, { dataModel })])) as Accepted;
    const { surface, dispose } = engineFor(record.state);
    const resolver = new NodeResolver(surface);
    const resolved = resolver.activeNodeCount;
    resolver.dispose();
    dispose();
    const content = await drawRecord(record);
    const drawn = [...content.querySelectorAll("*")].filter(({ localName }) => localName.startsWith("a2ui-react-")).length;
    assert.deepEqual({ drawn_at_once, drawn_with_rows }, { drawn_at_once: drawn, drawn_with_rows: resolved });
  });
}

test("of a long list the engine resolves every row, and what is drawn is a page of them", async () => {
  const components = [listOf("root", "leaf", "/rows"), text("leaf", "x")];
  const record = await acceptedRaw([create(components, { dataModel: { rows: rows(250) } })]);
  const { drawn_at_once, drawn_with_rows } = (await verdictOnRaw([create(components, { dataModel: { rows: rows(250) } })])) as Accepted;
  const { surface, dispose } = engineFor(record.state);
  const resolver = new NodeResolver(surface);
  assert.equal(resolver.activeNodeCount, 251);
  resolver.dispose();
  dispose();
  const content = await drawRecord(record);
  assert.equal(content.querySelectorAll("a2ui-react-text").length, 100);
  // With what shows more
  assert.deepEqual([drawn_at_once, drawn_with_rows], [102, 251]);
});

test("components that hold each other are past the limit, also where each is counted once", () => {
  const size = drawnSize([holds("root", ["a"]), holds("a", ["b"]), holds("b", ["a"])] as SurfaceComponent[], new DataModel({}));
  assert.equal(isPast(size), true);
});
