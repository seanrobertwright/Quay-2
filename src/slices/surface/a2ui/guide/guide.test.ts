/// <reference types="node" />
// The guide that quay_surface_guide returns (#728), as it is committed: its lines, its examples and its size.
import "../../../../test-support/dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CreateSurface, HeldSurface, SurfacePlace } from "../../surfaceTypes.ts";

const { catalog } = await import("../catalog.ts");
const { check } = await import("../check.ts");
const { guide } = await import("./guide.ts");

const committed = readFileSync(new URL("../../../../../src-tauri/src/slices/surface/surface_guide.md", import.meta.url), "utf8");

/** The lines under the heading `heading` that are a signature. */
function signaturesUnder(heading: string): string[] {
  const [, section = ""] = committed.split(`\n## ${heading}\n`);
  return section.split("\n## ")[0].split("\n").filter((line) => /^@?\w+\(/.test(line));
}

const namesOf = (lines: readonly string[]) => lines.map((line) => line.slice(0, line.indexOf("(")));

test("the guide has one line for each component and function of the catalog, and no other", () => {
  assert.deepEqual(namesOf(signaturesUnder("Components")).sort(), [...catalog.components.keys()].sort());
  assert.deepEqual(namesOf(signaturesUnder("Functions")).sort(), ["@index", ...catalog.functions.keys()].sort());
});

test("a line gives each property or argument with its type, whether it may be left out, its allowed values and its default", () => {
  const lines = [...signaturesUnder("Components"), ...signaturesUnder("Functions")];
  for (const line of [
    "Text(text: string~, variant?: caption|body = body, weight?: number)",
    "Row(children: children, justify?: center|end|spaceAround|spaceBetween|spaceEvenly|start|stretch = start, align?: start|center|end|stretch = stretch, weight?: number) A layout component that arranges its children horizontally.",
    "Tabs(tabs: {title: string~, child: id}[1+], weight?: number)",
    "Button(@checks?: check[], child: id, variant?: default|primary|borderless = default, action: action, weight?: number)",
    "Slider(@checks?: check[], label?: string~, min?: number = 0, max: number, value: number~, steps?: integer >= 1, weight?: number)",
    "ChoicePicker(@checks?: check[], label?: string~, variant?: multipleSelection|mutuallyExclusive = mutuallyExclusive, options: {label: string~, value: string, description?: string, recommended?: boolean}[], value: string[]~, displayStyle?: checkbox|chips = checkbox, filterable?: boolean = false, weight?: number) A component that allows selecting one or more options from a list.",
    "Steps(steps: {label: string, state: pending|active|done|failed, note?: string}[]|binding)",
    "Progress(done: number~, total: number~, label?: string~)",
    "and(values: boolean~[2+]): boolean. Performs a logical AND operation on a list of boolean values.",
    "length(value: string~, min?: integer >= 0, max?: integer >= 0): validationResult. Checks string length constraints.",
    "showFile(path: string~, line?: number~): void. Shows a file in its folder, or its changes when it has uncommitted ones.",
    "@index(offset?: number~): number.",
  ]) {
    const [name] = line.split("(");
    assert.equal(lines.find((one) => one.startsWith(`${name}(`)), line);
  }
});

test("the committed guide is the one the catalog gives now", () => {
  assert.ok(committed === guide(), "It is stale. Run pnpm surface:guide and commit what it writes.");
});

interface Call {
  place?: SurfacePlace;
  title?: string;
  messages: Record<string, unknown>[];
}

/** The calls the guide gives as examples, in its order. */
const examples = [...committed.matchAll(/```json\n([\s\S]*?)```/g)].map(([, json]) => JSON.parse(json) as Call);

const idOf = (state: CreateSurface) => state.createSurface.surfaceId;

test("each example is accepted by the check that a call of it is held to, made after the ones before it", () => {
  let held: HeldSurface[] = [];
  const seen = { kinds: new Set<string>(), places: new Set<string>(), asks: new Set<boolean>() };
  examples.forEach((call, i) => {
    const creates = call.messages.find(({ createSurface }) => createSurface !== undefined)?.createSurface as { surfaceId: string } | undefined;
    const verdict = check({ call: i + 1, tool: "quay_surface", surface_id: creates?.surfaceId ?? "", arguments: call, held });
    assert.ok("surfaces" in verdict, `${JSON.stringify(verdict)} on ${JSON.stringify(call)}`);
    assert.equal(call.place !== undefined && call.title !== undefined, creates !== undefined);
    const made = verdict.surfaces.map(({ state, asks }) => {
      seen.asks.add(asks);
      const before = held.find((one) => idOf(one.state) === idOf(state));
      return { state, place: creates?.surfaceId === idOf(state) ? call.place! : before!.place };
    });
    const named = new Set(call.messages.flatMap((message) => Object.values(message)).map((body) => (body as { surfaceId?: string }).surfaceId));
    held = [...held.filter(({ state }) => !named.has(idOf(state))), ...made];
    for (const message of call.messages) for (const key of Object.keys(message)) seen.kinds.add(key);
    if (call.place) seen.places.add(call.place);
  });
  // Between them they show every message, every place, and a surface that asks and one that does not
  assert.deepEqual([...seen.kinds].sort(), ["createSurface", "deleteSurface", "updateComponents", "updateDataModel", "version"]);
  assert.deepEqual([...seen.places].sort(), ["companion", "strip", "tab"]);
  assert.equal(seen.asks.size, 2);
});

test("the guide says what agents got wrong and no schema tells", () => {
  for (const rule of [
    "An update cannot remove a component.",
    "Delete the surface and create it again in one call.",
    "An update carries whole components",
    // What the round trips saw: an empty list of messages, and the same question again after the wait
    "never left empty",
    "end your turn. Do not call again",
    "with no digit first: `step_2`, not `step-2`",
    "At most one `createSurface` a call.",
    "of the whole surface after every call",
    '{"errors": [{"code", "surfaceId", "path", "message"}], "next"}',
    "A call that creates needs a `place` and a `title`",
  ]) {
    assert.ok(committed.includes(rule), rule);
  }
});

test("the guide is under 6,000 tokens, estimated as four characters each", () => {
  const tokens = [...committed].length / 4;
  assert.ok(tokens < 6000, `${tokens}`);
});

test("the guide is the same text on every system", () => {
  assert.ok(!committed.includes("\r"));
});
