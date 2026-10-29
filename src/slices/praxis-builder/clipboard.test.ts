/// <reference types="node" />
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CLIPBOARD_VERSION,
  copySelection,
  remapId,
  pasteEnvelope,
  pasteIntoDraft,
  duplicateSelection,
  getClipboard,
  setClipboard,
  isOriginalsInView,
  computeCenteredDelta,
  computeClickDelta,
  cascadeDelta,
  pasteDelta,
  pasteRunsAs,
  type ClipboardEnvelope,
} from "./clipboard.ts";
import { createGraphDraft } from "./drafts.ts";
import { MAX_NODES, type JsonObject, type XYPosition } from "./model.ts";

const fileOf = (nodes: JsonObject[], layoutNodes: { id: string; x: number; y: number }[] = []) => ({
  id: "test-graph",
  kind: "graphs" as const,
  missing: false,
  content: { id: "test-graph", revision: "rev-1", nodes },
  contentHash: "hash-1",
  layout: {
    version: "1",
    nodes: Object.fromEntries(layoutNodes.map((n) => [n.id, { x: n.x, y: n.y }])),
  },
});

const sampleNodes: JsonObject[] = [
  { id: "start", kind: "WAIT", dependsOn: [], config: {} },
  {
    id: "dec",
    kind: "DECISION",
    dependsOn: ["start"],
    config: { field: "ok", equals: "true", then: "task-1", else: "end" },
  },
  { id: "task-1", kind: "TASK", dependsOn: ["dec"], config: { executionKind: "AGENT" } },
  { id: "end", kind: "END", dependsOn: ["dec", "task-1"], config: {} },
];

const samplePositions = new Map<string, XYPosition>([
  ["start", { x: 100, y: 50 }],
  ["dec", { x: 100, y: 150 }],
  ["task-1", { x: 50, y: 300 }],
  ["end", { x: 100, y: 450 }],
]);

describe("remapId", () => {
  test("keeps an id that does not clash", () => {
    assert.equal(remapId("review", new Set(["other", "task-1"])), "review");
    assert.equal(remapId("task-3", new Set(["other"])), "task-3");
  });

  test("review becomes review-2 when review clashes", () => {
    assert.equal(remapId("review", new Set(["review"])), "review-2");
  });

  test("review becomes review-3 when review and review-2 clash", () => {
    assert.equal(remapId("review", new Set(["review", "review-2"])), "review-3");
  });

  test("task-3 becomes task-5 when task-1 through task-4 exist", () => {
    const taken = new Set(["task-1", "task-2", "task-3", "task-4"]);
    assert.equal(remapId("task-3", taken), "task-5");
  });

  test("drops trailing -<digits> and takes the smallest free n", () => {
    // Only task-3 exists; task-1 is free, so it takes task-1.
    assert.equal(remapId("task-3", new Set(["task-3"])), "task-1");
    // task and task-3 exist; task is 1, so smallest free is task-2
    assert.equal(remapId("task-3", new Set(["task", "task-3"])), "task-2");
    // task-1 and task-3 exist; task-2 is free, so task-3 becomes task-2
    assert.equal(remapId("task-3", new Set(["task-1", "task-3"])), "task-2");
  });

  test("a remapped id stays within the SDK's 256-character limit", () => {
    const long = "a".repeat(256);
    const next = remapId(long, new Set([long]));
    assert.equal(next, `${"a".repeat(254)}-2`);
    assert.equal([...next].length, 256);
  });

  test("handles multi-hyphen ids correctly", () => {
    assert.equal(remapId("my-custom-task", new Set(["my-custom-task"])), "my-custom-task-2");
    assert.equal(remapId("my-custom-task-2", new Set(["my-custom-task", "my-custom-task-2"])), "my-custom-task-3");
  });
});

describe("copySelection", () => {
  test("returns null for an empty selection or missing nodes", () => {
    assert.equal(copySelection(sampleNodes, new Set(), samplePositions), null);
    assert.equal(copySelection(sampleNodes, new Set(["unknown-id"]), samplePositions), null);
  });

  test("keeps internal dependsOn edges and drops external ones", () => {
    // Select dec and task-1: start is outside, so dec loses start. dec is inside, so task-1 keeps dec.
    const envelope = copySelection(sampleNodes, new Set(["dec", "task-1"]), samplePositions);
    assert.ok(envelope);
    assert.equal(envelope.version, CLIPBOARD_VERSION);
    assert.equal(envelope.nodes.length, 2);

    const dec = envelope.nodes.find((n) => n.id === "dec");
    assert.ok(dec);
    assert.deepEqual(dec.dependsOn, []); // "start" was external -> dropped

    const task1 = envelope.nodes.find((n) => n.id === "task-1");
    assert.ok(task1);
    assert.deepEqual(task1.dependsOn, ["dec"]); // "dec" was internal -> kept
  });

  test("remaps internal DECISION branches and blanks external ones to empty string", () => {
    // Selection: dec and task-1. "then" points to "task-1" (internal). "else" points to "end" (external).
    const envelope = copySelection(sampleNodes, new Set(["dec", "task-1"]), samplePositions);
    assert.ok(envelope);
    const dec = envelope.nodes.find((n) => n.id === "dec");
    assert.ok(dec);
    const config = dec.config as Record<string, unknown>;
    assert.equal(config.then, "task-1"); // internal -> kept
    assert.equal(config.else, ""); // external -> blanked to ""
  });

  test("captures positions for the copied nodes only", () => {
    const envelope = copySelection(sampleNodes, new Set(["dec"]), samplePositions);
    assert.ok(envelope);
    assert.deepEqual(envelope.positions, { dec: { x: 100, y: 150 } });
  });

  test("records sourceKey when provided", () => {
    const envelope = copySelection(sampleNodes, new Set(["dec"]), samplePositions, "proj|graphs/g1");
    assert.ok(envelope);
    assert.equal(envelope.sourceKey, "proj|graphs/g1");
  });
});

describe("pasteEnvelope", () => {
  test("a remapped id never takes an id that another pasted node keeps", () => {
    const nodes: JsonObject[] = [
      { id: "task", kind: "TASK", dependsOn: [], config: {} },
      { id: "task-2", kind: "TASK", dependsOn: ["task"], config: {} },
    ];
    const envelope = copySelection(nodes, new Set(["task", "task-2"]), new Map());
    assert.ok(envelope);
    const pasted = pasteEnvelope(envelope, new Set(["task"]));
    assert.deepEqual(pasted.remappedIds, ["task-3", "task-2"]);
    assert.deepEqual(pasted.nodes[1].dependsOn, ["task-3"]);
  });

  test("the pasted nodes share no objects with the envelope", () => {
    const nodes: JsonObject[] = [{ id: "a", kind: "TASK", dependsOn: [], config: { nested: { n: 1 } } }];
    const envelope = copySelection(nodes, new Set(["a"]), new Map());
    assert.ok(envelope);
    assert.notEqual((envelope.nodes[0].config as JsonObject).nested, (nodes[0].config as JsonObject).nested);
    const first = pasteEnvelope(envelope, new Set()).nodes[0];
    assert.notEqual((first.config as JsonObject).nested, (envelope.nodes[0].config as JsonObject).nested);
  });

  test("keeps ids that do not collide", () => {
    const envelope = copySelection(sampleNodes, new Set(["task-1"]), samplePositions);
    assert.ok(envelope);
    const { nodes, remappedIds } = pasteEnvelope(envelope, new Set(["other-node"]));
    assert.deepEqual(remappedIds, ["task-1"]);
    assert.equal(nodes[0].id, "task-1");
  });

  test("remaps colliding ids and rewires internal dependsOn and DECISION branches", () => {
    const envelope = copySelection(sampleNodes, new Set(["dec", "task-1"]), samplePositions);
    assert.ok(envelope);
    // Paste into a graph that already has dec and task-1
    const existing = new Set(["dec", "task-1"]);
    const { nodes, remappedIds, positions } = pasteEnvelope(envelope, existing, { x: 24, y: 24 });

    // dec clashes -> dec-2; task-1 clashes -> task-2
    assert.deepEqual(remappedIds, ["dec-2", "task-2"]);
    const dec = nodes.find((n) => n.id === "dec-2");
    assert.ok(dec);
    const task = nodes.find((n) => n.id === "task-2");
    assert.ok(task);

    // Internal dependsOn rewired: task-2 depends on dec-2
    assert.deepEqual(task.dependsOn, ["dec-2"]);
    // Internal DECISION branch rewired: dec-2's then branch points to task-2
    const decConfig = dec.config as Record<string, unknown>;
    assert.equal(decConfig.then, "task-2");
    assert.equal(decConfig.else, "");

    // Positions offset by 24 px
    assert.deepEqual(positions.get("dec-2"), { x: 124, y: 174 });
    assert.deepEqual(positions.get("task-2"), { x: 74, y: 324 });
  });

  test("node config and properties are preserved verbatim", () => {
    const envelope = copySelection(sampleNodes, new Set(["task-1"]), samplePositions);
    assert.ok(envelope);
    const { nodes } = pasteEnvelope(envelope, new Set(["task-1"]));
    assert.equal(nodes[0].kind, "TASK");
    assert.deepEqual((nodes[0].config as Record<string, unknown>).executionKind, "AGENT");
  });
});

describe("pasteIntoDraft", () => {
  test("adds pasted nodes to the draft and preserves positions", () => {
    const ref = { kind: "graphs" as const, id: "test" };
    const draftRes = createGraphDraft(ref, fileOf(sampleNodes, [
      { id: "start", x: 100, y: 50 },
      { id: "dec", x: 100, y: 150 },
      { id: "task-1", x: 50, y: 300 },
      { id: "end", x: 100, y: 450 },
    ]));
    assert.ok(draftRes.ok);
    const draft = draftRes.value;

    const envelope = copySelection(sampleNodes, new Set(["task-1"]), draft.positions);
    assert.ok(envelope);

    const pasted = pasteIntoDraft(draft, envelope, { x: 24, y: 24 });
    assert.ok(pasted);
    assert.deepEqual(pasted.pastedIds, ["task-2"]);
    assert.equal((pasted.draft.content.nodes as JsonObject[]).length, 5);
    assert.deepEqual(pasted.draft.positions.get("task-2"), { x: 74, y: 324 });
    // Fingerprint changed so draft is dirty
    assert.notEqual(pasted.draft.fingerprint, draft.fingerprint);
  });
});

describe("pasteIntoDraft at the node limit", () => {
  test("refuses a paste that would take the graph past MAX_NODES", () => {
    const nodes = Array.from({ length: MAX_NODES }, (_, i): JsonObject => ({ id: `n-${i}`, kind: "WAIT", dependsOn: [], config: {} }));
    const res = createGraphDraft({ kind: "graphs", id: "full" }, fileOf(nodes));
    assert.ok(res.ok);
    const envelope = copySelection(nodes, new Set(["n-0"]), new Map());
    assert.ok(envelope);
    assert.equal(pasteIntoDraft(res.value, envelope, { x: 0, y: 0 }), null);
  });
});

describe("duplicateSelection", () => {
  test("duplicating the same node again cascades past the first copy", () => {
    const res = createGraphDraft({ kind: "graphs", id: "test" }, fileOf([{ id: "node", kind: "WAIT", dependsOn: [], config: {} }], [{ id: "node", x: 100, y: 100 }]));
    assert.ok(res.ok);
    const first = duplicateSelection(res.value, new Set(["node"]));
    assert.ok(first);
    const second = duplicateSelection(first.draft, new Set(["node"]));
    assert.ok(second);
    assert.deepEqual(second.pastedIds, ["node-3"]);
    assert.deepEqual(second.draft.positions.get("node-3"), { x: 148, y: 148 });
  });


  test("duplicates selected nodes without touching the clipboard", () => {
    setClipboard(null);
    const ref = { kind: "graphs" as const, id: "test" };
    const draftRes = createGraphDraft(ref, fileOf(sampleNodes));
    assert.ok(draftRes.ok);
    const draft = draftRes.value;

    const res = duplicateSelection(draft, new Set(["task-1"]));
    assert.ok(res);
    assert.deepEqual(res.pastedIds, ["task-2"]);
    assert.equal(getClipboard(), null); // Clipboard untouched!
  });

  test("repeating duplicate cascades by offsetting 24 px", () => {
    const ref = { kind: "graphs" as const, id: "test" };
    const draftRes = createGraphDraft(ref, fileOf([{ id: "node", kind: "WAIT", dependsOn: [], config: {} }], [{ id: "node", x: 100, y: 100 }]));
    assert.ok(draftRes.ok);
    let draft = draftRes.value;

    // First duplicate
    const dup1 = duplicateSelection(draft, new Set(["node"]));
    assert.ok(dup1);
    assert.deepEqual(dup1.pastedIds, ["node-2"]);
    assert.deepEqual(dup1.draft.positions.get("node-2"), { x: 124, y: 124 });
    draft = dup1.draft;

    // Second duplicate of the newly duplicated node
    const dup2 = duplicateSelection(draft, new Set(["node-2"]));
    assert.ok(dup2);
    assert.deepEqual(dup2.pastedIds, ["node-3"]);
    assert.deepEqual(dup2.draft.positions.get("node-3"), { x: 148, y: 148 });
  });
});

describe("placement and viewport helpers", () => {
  const envelope: ClipboardEnvelope = {
    version: CLIPBOARD_VERSION,
    nodes: [{ id: "a", kind: "TASK", dependsOn: [], config: {} }],
    positions: { a: { x: 100, y: 100 } },
    sourceKey: "proj|graphs/g1",
  };
  const inGraph = new Map([["a", { x: 100, y: 100 }]]);
  const view = { x: 0, y: 0, zoom: 1 };
  const box = { width: 800, height: 600 };
  const draftOf = (nodes: JsonObject[], layout: { id: string; x: number; y: number }[]) => {
    const res = createGraphDraft({ kind: "graphs", id: "g1" }, fileOf(nodes, layout));
    assert.ok(res.ok);
    return res.value;
  };

  test("isOriginalsInView is true when an original in the graph shows in the viewport", () => {
    assert.equal(isOriginalsInView(envelope, inGraph, view, box), true);
  });

  test("isOriginalsInView is false when the viewport is panned away", () => {
    assert.equal(isOriginalsInView(envelope, inGraph, { x: -2000, y: -2000, zoom: 1 }, box), false);
  });

  test("isOriginalsInView is false once the originals are gone from the graph, as after a cut", () => {
    assert.equal(isOriginalsInView(envelope, new Map(), view, box), false);
  });

  test("computeCenteredDelta centres the fragment in the viewport", () => {
    // Fragment centre: (100 + NODE_WIDTH / 2, 100 + NODE_HEIGHT / 2) = (215, 146); view centre (400, 300).
    assert.deepEqual(computeCenteredDelta(envelope, view, box), { x: 185, y: 154 });
  });

  test("computeCenteredDelta at a zoom of 0 leaves the fragment where it was", () => {
    assert.deepEqual(computeCenteredDelta(envelope, { x: 0, y: 0, zoom: 0 }, box), { x: 0, y: 0 });
  });

  test("computeClickDelta places the top-left at the click point", () => {
    assert.deepEqual(computeClickDelta(envelope, { x: 500, y: 400 }), { x: 400, y: 300 });
  });

  test("cascadeDelta takes the first 24 px step no card already sits on", () => {
    assert.deepEqual(cascadeDelta(envelope, inGraph), { x: 24, y: 24 });
    const twice = new Map([...inGraph, ["a-2", { x: 124, y: 124 }], ["a-3", { x: 148, y: 148 }]]);
    assert.deepEqual(cascadeDelta(envelope, twice), { x: 72, y: 72 });
  });

  test("pasteDelta offsets beside originals in view, and centres a paste after a cut", () => {
    const node = { id: "a", kind: "TASK", dependsOn: [], config: {} };
    const withOriginal = draftOf([node], [{ id: "a", x: 100, y: 100 }]);
    assert.deepEqual(pasteDelta(envelope, withOriginal, "proj|graphs/g1", view, box), { x: 24, y: 24 });
    const afterCut = draftOf([], []);
    assert.deepEqual(pasteDelta(envelope, afterCut, "proj|graphs/g1", view, box), { x: 185, y: 154 });
  });

  test("pasteDelta centres a paste into another graph, and goes to a click point when given one", () => {
    const node = { id: "a", kind: "TASK", dependsOn: [], config: {} };
    const draft = draftOf([node], [{ id: "a", x: 100, y: 100 }]);
    assert.deepEqual(pasteDelta(envelope, draft, "proj|graphs/other", view, box), { x: 185, y: 154 });
    assert.deepEqual(pasteDelta(envelope, draft, "proj|graphs/g1", view, box, { x: 0, y: 0 }), { x: -100, y: -100 });
  });

  test("setClipboard and getClipboard hold one app-wide envelope", () => {
    setClipboard(envelope);
    assert.equal(getClipboard(), envelope);
    setClipboard(null);
    assert.equal(getClipboard(), null);
  });
});

describe("Runs as entries (#248, #273)", () => {
  const entry = (agentId: string): JsonObject => ({ executionKind: "AGENT", role: "WORK", agentId });

  test("copy carries the Runs as entries of the copied nodes from the binding shown", () => {
    const envelope = copySelection(sampleNodes, new Set(["task-1", "end"]), samplePositions, "g", {
      "task-1": entry("codex"),
      other: entry("claude-code"),
    })!;
    assert.deepEqual(envelope.runsAs, { "task-1": entry("codex") });
  });

  test("with no binding shown, copy carries no entries", () => {
    const envelope = copySelection(sampleNodes, new Set(["task-1"]), samplePositions, "g")!;
    assert.equal(envelope.runsAs, undefined);
  });

  test("paste writes the entries into the binding shown under the remapped ids", () => {
    const draft = createGraphDraft({ kind: "graphs", id: "test-graph" }, fileOf(sampleNodes));
    if (!draft.ok) throw new Error(draft.message);
    const envelope = copySelection(sampleNodes, new Set(["task-1"]), samplePositions, "g", { "task-1": entry("codex") })!;
    const pasted = pasteIntoDraft(draft.value, envelope, { x: 24, y: 24 })!;
    assert.deepEqual(pasted.pastedIds, ["task-2"]);
    const binding: JsonObject = { graphId: "test-graph", nodes: { "task-1": entry("") } };
    const next = pasteRunsAs(binding, envelope, pasted.pastedIds);
    assert.deepEqual(next.nodes, { "task-1": entry(""), "task-2": entry("codex") });
  });

  test("an envelope without entries leaves the binding as it is", () => {
    const envelope = copySelection(sampleNodes, new Set(["task-1"]), samplePositions)!;
    const binding: JsonObject = { nodes: {} };
    assert.equal(pasteRunsAs(binding, envelope, ["task-2"]), binding);
  });
});
