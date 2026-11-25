/// <reference types="node" />
// What the check counts of a surface (#765) against what the engine resolves of it and what is drawn, so that
// an upgrade of the engine that reads a path or a child otherwise is seen.
import "../../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NodeResolver } from "@a2ui/web_core/v1_0";
import { drawRecord, leavePage, startPage } from "../fixtures/catalogFixtures.ts";
import { acceptedRaw, button, create, EVENT, text, verdictOnRaw, type Component } from "../fixtures/rawFixtures.ts";
import type { Accepted } from "../surfaceTypes.ts";

const { engineFor } = await import("./engine.ts");

beforeEach(startPage);
afterEach(leavePage);

const list = (id: string, child: string, path: string, component = "Column"): Component => ({ id, component, children: { componentId: child, path } });

const rows = <T>(count: number, row: (i: number) => T): T[] => Array.from({ length: count }, (_, i) => row(i));

/** Surfaces with nothing in them that counts for more than one component. */
const SURFACES: Record<string, [Component[], object]> = {
  "each way to hold components": [
    [
      { id: "root", component: "Column", children: ["row", "card", "card", "go"] },
      { id: "row", component: "Row", children: ["said", "said", "list"] },
      list("list", "said", "/rows", "List"),
      { id: "card", component: "Card", child: "inner" },
      { id: "inner", component: "Column", children: ["said", "line"] },
      { id: "line", component: "Divider" },
      text("said", "x"),
      ...button("go", EVENT),
    ],
    { rows: rows(7, () => 0) },
  ],
  "rows in rows, by paths of each kind": [
    [
      { id: "root", component: "Column", children: ["plain", "under", "escaped", "none", "text", "missing"] },
      list("plain", "row", "/rows"),
      list("under", "leaf", "/rows/1/cells"),
      list("escaped", "leaf", "/a~1b"),
      list("none", "leaf", "/empty"),
      list("text", "leaf", "/said"),
      list("missing", "leaf", "/rows/x/cells"),
      { id: "row", component: "Row", children: ["cells", "again", "all"] },
      list("cells", "leaf", "cells"),
      list("again", "leaf", "./cells"),
      list("all", "leaf", "/rows/0/cells"),
      text("leaf", "x"),
    ],
    { rows: rows(5, (i) => ({ cells: rows(i, () => 0) })), "a/b": [1, 2, 3], empty: [], said: "three" },
  ],
  "rows that are lists": [[list("root", "row", "/rows"), list("row", "cell", "."), list("cell", "leaf", "."), text("leaf", "x")], { rows: rows(4, (i) => rows(i, (j) => rows(j, () => 0))) }],
  "rows that draw their own data": [[list("root", "row", "/rows"), { id: "row", component: "Row", children: ["name", "size"] }, text("name", { "@path": "name" }), text("size", { "@path": "/size" })], { rows: rows(9, (i) => ({ name: `row ${i}` })), size: 4 }],
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
  const components = [list("root", "leaf", "/rows"), text("leaf", "x")];
  const record = await acceptedRaw([create(components, { dataModel: { rows: rows(250, () => 0) } })]);
  const { drawn_at_once, drawn_with_rows } = (await verdictOnRaw([create(components, { dataModel: { rows: rows(250, () => 0) } })])) as Accepted;
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
