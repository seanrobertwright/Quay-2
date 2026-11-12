/// <reference types="node" />
// The agent picker (#482): reading the host's record, the suggestions and warnings it gives the
// two agent fields, and when the builder reads it again. The records are what the real
// `praxis agents --json` printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPickerOf, agentSuggestions, agentWarnings, createAgentPickerReads, MAX_AGENT_SUGGESTIONS, type AgentPicker } from "./agentPicker.ts";
import { catalogPicker, CHANGED_REASON, noCatalogPicker } from "./fixtures/agentOutputs.ts";
import type { CallOutcome, Invoker } from "./praxisHost.ts";

const read = (outcome: CallOutcome): AgentPicker => {
  const picker = agentPickerOf(outcome);
  assert.ok(picker);
  return picker;
};

test("the recorded picker reads as the catalog's agents in catalog order, with why one can't be bound", () => {
  assert.deepEqual(read(catalogPicker()), {
    catalog: true,
    agents: [
      { agentId: "ready-coder", selectable: true, reasons: [] },
      { agentId: "changed-coder", selectable: false, reasons: [CHANGED_REASON] },
      { agentId: "unadapted-coder", selectable: true, reasons: [] },
    ],
  });
  assert.deepEqual(read(noCatalogPicker()), { catalog: false, agents: [] });
});

test("anything but a readable aiws-agent-picker/1 record is no picker", () => {
  const outcomes: CallOutcome[] = [
    catalogPicker({ format: "aiws-agent-picker/2" }),
    catalogPicker({ catalog: "yes" }),
    catalogPicker({ agents: [{ agentId: "a", selectable: "true", reasons: [] }] }),
    catalogPicker({ agents: [{ agentId: 7, selectable: true, reasons: [] }] }),
    catalogPicker({ agents: [{ agentId: "a", selectable: false, reasons: [3] }] }),
    catalogPicker({ agents: "none" }),
    { kind: "needsUpdate", detail: "praxis didn't accept Quay's arguments: Unknown command: agents" },
    { kind: "hostDown", message: "down" },
    { kind: "notSignedIn", message: "no session" },
    { kind: "noHost", message: "no host" },
    { kind: "hostRefused", message: "refused", hostCode: "FORBIDDEN", record: {} },
    { kind: "refused", message: "refused" },
    { kind: "timedOut" },
    { kind: "cancelled" },
  ];
  for (const outcome of outcomes) assert.equal(agentPickerOf(outcome), null, JSON.stringify(outcome));
});

test("suggestions are the catalog's agents in catalog order, then the project's other ids, none twice", () => {
  const picker = read(catalogPicker());
  assert.deepEqual(agentSuggestions(picker, ["alpha", "ready-coder", "zeta"]), [
    { id: "ready-coder" },
    { id: "changed-coder", note: "can't be bound" },
    { id: "unadapted-coder" },
    { id: "alpha" },
    { id: "zeta" },
  ]);
});

test("without a picker, or on a host with no catalog, the suggestions are the project's own ids", () => {
  const used = ["alpha", "zeta"];
  const offline = [{ id: "alpha" }, { id: "zeta" }];
  assert.deepEqual(agentSuggestions(null, used), offline);
  assert.deepEqual(agentSuggestions(read(noCatalogPicker()), used), offline);
});

test("suggestions stop at the cap", () => {
  const agents = Array.from({ length: MAX_AGENT_SUGGESTIONS + 50 }, (_, i) => ({ agentId: `agent-${i}`, selectable: true, reasons: [] }));
  const shown = agentSuggestions({ catalog: true, agents }, ["alpha"]);
  assert.equal(shown.length, MAX_AGENT_SUGGESTIONS);
  assert.equal(shown[0].id, "agent-0");
});

test("an agent id the catalog doesn't have gets a warning that names it", () => {
  const warnings = agentWarnings(read(catalogPicker()), "ghost-coder");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.equal(warnings[0].message, 'The host\'s agent catalog doesn\'t offer the agent "ghost-coder".');
});

test("an agent that can't be bound gets a warning with the host's reasons, verbatim", () => {
  const warnings = agentWarnings(read(catalogPicker()), "changed-coder");
  assert.deepEqual(
    warnings.map((w) => [w.severity, w.message]),
    [["warning", `The host can't bind this agent: ${CHANGED_REASON}`]],
  );
  // An agent the host gives no reason for is still warned about.
  const silent: AgentPicker = { catalog: true, agents: [{ agentId: "quiet", selectable: false, reasons: [] }] };
  assert.deepEqual(agentWarnings(silent, "quiet").map((w) => w.message), ["The host can't bind this agent, and gives no reason."]);
});

test("an agent that can be bound, an empty id, no picker and no catalog give no warning", () => {
  const picker = read(catalogPicker());
  assert.deepEqual(agentWarnings(picker, "ready-coder"), []);
  assert.deepEqual(agentWarnings(picker, ""), []);
  assert.deepEqual(agentWarnings(picker, "   "), []);
  assert.deepEqual(agentWarnings(null, "ghost-coder"), []);
  assert.deepEqual(agentWarnings(read(noCatalogPicker()), "ghost-coder"), []);
});

/** A backend whose `praxis_host_agents` calls a test answers one by one. */
function backend() {
  const asked: { projectPath: string; callId: string; answer: (outcome: CallOutcome) => void }[] = [];
  const cancelled: string[] = [];
  const call: Invoker = (command, args) => {
    if (command === "praxis_host_cancel") {
      cancelled.push(String(args.callId));
      return Promise.resolve(null);
    }
    assert.equal(command, "praxis_host_agents");
    return new Promise((resolve) => asked.push({ projectPath: String(args.projectPath), callId: String(args.callId), answer: resolve }));
  };
  return { asked, cancelled, call };
}

/** Lets an answered call's continuation run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("the picker is read when the project's host can be used, and not before", async () => {
  const { asked, call } = backend();
  const reads = createAgentPickerReads(call);
  let changes = 0;
  reads.subscribe(() => (changes += 1));
  reads.follow("C:/project", false);
  assert.equal(asked.length, 0);
  reads.follow("C:/project", true);
  assert.deepEqual(asked.map((a) => a.projectPath), ["C:/project"]);
  assert.equal(reads.current(), null);
  asked[0].answer(catalogPicker());
  await settle();
  assert.equal(reads.current()?.agents.length, 3);
  assert.equal(changes, 1);
  // Following the same project in the same state reads nothing more.
  reads.follow("C:/project", true);
  assert.equal(asked.length, 1);
});

test("the picker is read again when the host is checked again, and the newer answer is the one kept", async () => {
  const { asked, cancelled, call } = backend();
  const reads = createAgentPickerReads(call);
  reads.follow("C:/project", true);
  asked[0].answer(noCatalogPicker());
  await settle();
  assert.equal(reads.current()?.catalog, false);

  reads.reread();
  reads.reread();
  assert.equal(asked.length, 3);
  // The catalog read before stays shown while the host is asked again.
  assert.equal(reads.current()?.catalog, false);
  assert.deepEqual(cancelled, [asked[1].callId]);
  // The older read answers last, and is dropped.
  asked[2].answer(catalogPicker());
  await settle();
  asked[1].answer(noCatalogPicker());
  await settle();
  assert.equal(reads.current()?.catalog, true);
});

test("a reread that fails falls back to no picker, and one asked while the host can't be used asks nothing", async () => {
  const { asked, call } = backend();
  const reads = createAgentPickerReads(call);
  reads.follow("C:/project", true);
  asked[0].answer(catalogPicker());
  await settle();
  reads.reread();
  asked[1].answer({ kind: "hostDown", message: "down" });
  await settle();
  assert.equal(reads.current(), null);

  reads.follow("C:/project", false);
  reads.reread();
  assert.equal(asked.length, 2);
});

test("a late answer for another project is dropped", async () => {
  const { asked, cancelled, call } = backend();
  const reads = createAgentPickerReads(call);
  reads.follow("C:/one", true);
  reads.follow("C:/two", true);
  assert.deepEqual(asked.map((a) => a.projectPath), ["C:/one", "C:/two"]);
  assert.deepEqual(cancelled, [asked[0].callId]);
  asked[1].answer(noCatalogPicker());
  await settle();
  asked[0].answer(catalogPicker());
  await settle();
  assert.deepEqual(reads.current(), { catalog: false, agents: [] });
});

test("the picker is dropped when the project changes or its host can no longer be used", async () => {
  const { asked, call } = backend();
  const reads = createAgentPickerReads(call);
  reads.follow("C:/one", true);
  asked[0].answer(catalogPicker());
  await settle();
  assert.ok(reads.current());
  reads.follow("C:/one", false);
  assert.equal(reads.current(), null);

  reads.follow("C:/one", true);
  asked[1].answer(catalogPicker());
  await settle();
  assert.ok(reads.current());
  reads.follow("C:/two", true);
  assert.equal(reads.current(), null);
});
