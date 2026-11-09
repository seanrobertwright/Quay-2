/// <reference types="node" />
// Component tests for the trigger form's Starts target (#472): the picker over graph workflow
// records, the contract it fills and the Use <contract> fix, and the Praxis host's graph trigger
// rules, which come from the backend as errors with the host's code and a hint. They render the
// real form into happy-dom, keep the draft in state the way the builder does, and fake only
// Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft, editTriggerDraft, type Draft } from "./drafts.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { TriggerEdit } from "./trigger.ts";
import type { EventSourceSummary } from "./triggerHost.ts";
import type { Diagnostic, TriggerTargetCheck, Validation } from "./types.ts";

const { TriggerForm } = await import("./TriggerForm.tsx");

const PROJECT = "C:/project";

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const accepted: Validation = { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
const NO_CHECK: TriggerTargetCheck = { refused: [], diagnostics: [] };

/** The backend: `praxis_validate` accepts, and `praxis_check_trigger` answers with `check` for the target it is sent. */
function fakeBackend(check: (target: string | null) => TriggerTargetCheck = () => NO_CHECK) {
  const sent: { command: string; args: Record<string, unknown> }[] = [];
  fakeInvoke(async (command, args) => {
    sent.push({ command, args });
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_trigger":
        return check((args.target as string | null) ?? null);
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return sent;
}

const TRIGGER = {
  id: "t",
  revision: "unsaved",
  kind: "EVENT",
  source: "github",
  eventType: "push",
  contractId: "",
  action: "START_RUN",
  enabled: false,
  maxDepth: "0",
};

function draftOf(content: Record<string, unknown>, target?: string): Draft {
  const ref = { kind: "triggers" as const, id: "t" };
  const file = {
    id: "t",
    kind: "triggers" as const,
    missing: false,
    content,
    contentHash: "h",
    ...(target ? { target: { version: 1, graphWorkflow: target }, targetHash: "th" } : {}),
  };
  const made = createDraft(ref, file);
  assert.ok(made.ok);
  return made.value;
}

interface Rendered {
  root: HTMLElement;
  /** The draft as the edits left it. */
  draft: () => Draft;
  edits: TriggerEdit[];
  verdicts: (string | null)[];
}

/** Renders the form over a draft held in state, which each edit changes as the builder's does. */
async function render(
  content: Record<string, unknown>,
  target?: string,
  extra: {
    eventSources?: ReadonlyMap<string, EventSourceSummary>;
    hostCondition?: HostCondition;
  } = {},
): Promise<Rendered> {
  const edits: TriggerEdit[] = [];
  const verdicts: (string | null)[] = [];
  let current = draftOf(content, target);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const Harness = () => {
    const [draft, setDraft] = useState(current);
    current = draft;
    return createElement(TriggerForm, {
      projectPath: PROJECT,
      draft,
      contracts: ["c", "d", "other"],
      graphWorkflows: [
        { id: "ship", contractId: "c" },
        { id: "review", contractId: "d" },
      ],
      refresh: 0,
      crossRecord: null,
      onEdit: (e: TriggerEdit) => {
        edits.push(e);
        setDraft((d) => editTriggerDraft(d, e));
      },
      onOpen: () => {},
      onValidated: (v: string | null) => verdicts.push(v),
      ...extra,
    });
  };
  await act(async () => root.render(createElement(Harness)));
  return { root: container, draft: () => current, edits, verdicts };
}

const text = (el: Element | null | undefined) => el?.textContent ?? "";

/** The control labelled `label`, the messages it points at, and its suggestions or options. */
function field(root: HTMLElement, label: string) {
  const labelEl = [...root.querySelectorAll("label")].find((l) => text(l) === label);
  assert.ok(labelEl, `a field labelled ${label}`);
  const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[id="${labelEl.getAttribute("for")}"]`);
  assert.ok(input, `the control of ${label}`);
  const described = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  const messages = described.map((id) => text(root.querySelector(`[id="${id}"]`))).join(" ");
  const suggestions = [...root.querySelectorAll(`datalist[id="${input.getAttribute("list")}"] option`)].map((o) => o.getAttribute("value"));
  const options = [...input.querySelectorAll("option")].map((o) => ({ value: o.getAttribute("value"), label: text(o) }));
  return { input, messages, suggestions, options };
}

async function type(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

test("the Starts picker lists the graph workflows, takes an unknown id and flags it, and replaces the old note", async () => {
  fakeBackend();
  const { root, draft } = await render(TRIGGER);
  assert.deepEqual(field(root, "Starts").suggestions, ["ship", "review"]);
  assert.doesNotMatch(text(root), /doesn't yet say which graph/);
  await type(field(root, "Starts").input as HTMLInputElement, "not-made-yet");
  assert.equal(draft().target, "not-made-yet");
  assert.match(field(root, "Starts").messages, /No graph workflow has this id\./);
});

const hinted = (code: string, path: string, message: string, hint: string): Diagnostic => ({ code, severity: "error", message, path, hint });

test("picking a target fills an empty contract with the target's, in one undo step", async () => {
  const sent = fakeBackend();
  const { root, draft, edits } = await render(TRIGGER);
  await type(field(root, "Starts").input as HTMLInputElement, "ship");
  assert.equal(draft().target, "ship");
  assert.equal(draft().content.contractId, "c");
  assert.equal((field(root, "Contract").input as HTMLInputElement).value, "c");
  assert.deepEqual(edits, [{ type: "set-target", target: "ship", contractId: "c", live: true }]);
  // Only a trigger with a target is checked as a graph trigger, against the target it names.
  const checks = sent.filter((s) => s.command === "praxis_check_trigger");
  assert.ok(checks.length > 0);
  assert.ok(checks.every((s) => s.args.target === "ship" && s.args.projectPath === PROJECT));
});

test("picking a target leaves a contract that is already set, and clearing the target leaves the contract", async () => {
  fakeBackend();
  const { root, draft } = await render({ ...TRIGGER, contractId: "other" });
  await type(field(root, "Starts").input as HTMLInputElement, "ship");
  assert.equal(draft().content.contractId, "other");
  await type(field(root, "Starts").input as HTMLInputElement, "");
  assert.equal(draft().target, null);
  assert.equal(draft().content.contractId, "other");
});

test("a contract other than the target's is an error with a Use <contract> fix", async () => {
  fakeBackend((target) =>
    target === "ship"
      ? {
          contractId: "c",
          refused: [],
          diagnostics: [
            hinted(
              "CONTRACT_MISMATCH",
              "/contractId",
              "Graph workflow ship runs under contract c, so the trigger must name contract c, not other.",
              "Use contract c, or start another graph workflow."
            ),
          ],
        }
      : NO_CHECK
  );
  const { root, draft } = await render({ ...TRIGGER, contractId: "other" }, "ship");
  const contract = field(root, "Contract");
  assert.match(contract.messages, /must name contract c, not other\./);
  assert.match(contract.messages, /CONTRACT_MISMATCH/);
  const fix = [...root.querySelectorAll("button")].find((b) => text(b) === "Use c");
  assert.ok(fix, "a Use c fix");
  await act(async () => fix.click());
  assert.equal(draft().content.contractId, "c");
  assert.equal(draft().target, "ship");
});

test("a trigger without a target is never checked as a graph trigger", async () => {
  const sent = fakeBackend();
  const { root, verdicts } = await render({ ...TRIGGER, kind: "MANUAL" });
  assert.equal(sent.filter((s) => s.command === "praxis_check_trigger").length, 0);
  assert.deepEqual(verdicts, [null], "the SDK's verdict, as before");
  assert.deepEqual(
    field(root, "Kind").options.map((o) => o.label),
    ["MANUAL", "SCHEDULED", "EVENT", "RESOURCE_CHANGE", "CONDITION", "WORKFLOW_LIFECYCLE", "EXTERNAL_RESPONSE"]
  );
});

/** The backend's answer for a trigger with a target: the refusals the rules table lists, and `diagnostics`. */
const REFUSED = [
  { field: "kind", value: "MANUAL", code: "MANUAL_USE_GRAPH_RUNS" },
  { field: "kind", value: "EXTERNAL_RESPONSE", code: "EXTERNAL_RESPONSE_USE_WAIT" },
  { field: "kind", value: "RESOURCE_CHANGE", code: "RESOURCE_CHANGE_USE_EVENT" },
  { field: "kind", value: "WORKFLOW_LIFECYCLE", code: "NOT_YET_SUPPORTED" },
  { field: "action", value: "RESUME_WAIT", code: "RESUME_WAIT_USE_BINDING" },
];
const targeted = (diagnostics: Diagnostic[]) => (target: string | null) =>
  target === null ? NO_CHECK : { contractId: "c", refused: REFUSED, diagnostics };

test("with a target, the Kind and Action pickers list every value and mark the refused ones with the host's code", async () => {
  fakeBackend(targeted([]));
  const { root } = await render({ ...TRIGGER, contractId: "c" }, "ship");
  const kinds = field(root, "Kind").options;
  assert.deepEqual(
    kinds.map((o) => o.value),
    ["MANUAL", "SCHEDULED", "EVENT", "RESOURCE_CHANGE", "CONDITION", "WORKFLOW_LIFECYCLE", "EXTERNAL_RESPONSE"]
  );
  assert.equal(kinds.find((o) => o.value === "MANUAL")?.label, "MANUAL (refused for a graph trigger: MANUAL_USE_GRAPH_RUNS)");
  assert.equal(kinds.find((o) => o.value === "EVENT")?.label, "EVENT");
  const actions = field(root, "Action").options;
  assert.deepEqual(
    actions.map((o) => o.label),
    ["START_RUN", "RESUME_WAIT (refused for a graph trigger: RESUME_WAIT_USE_BINDING)"]
  );
});

test("each graph trigger rule a trigger breaks shows on its field with the host's code and hint, and marks it invalid", async () => {
  fakeBackend(
    targeted([
      hinted("MANUAL_USE_GRAPH_RUNS", "/kind", "A graph trigger can't be MANUAL.", "Start a graph run of the graph workflow instead."),
      hinted("RESUME_WAIT_USE_BINDING", "/action", "A graph trigger can only start a run.", "Set the action to START_RUN."),
      hinted("TRIGGER_DEPTH_UNSUPPORTED", "/maxDepth", "A graph trigger's max depth must be 0.", "Praxis fires graph triggers only on events no run caused."),
      hinted("SOURCE_NOT_SET", "/source", "A graph trigger fired by events needs their source.", "Type the name of an event source the host admits."),
    ])
  );
  const { root, verdicts } = await render({ ...TRIGGER, kind: "MANUAL", action: "RESUME_WAIT", maxDepth: "2", contractId: "c" }, "ship");
  assert.match(field(root, "Kind").messages, /can't be MANUAL\. Start a graph run of the graph workflow instead\. MANUAL_USE_GRAPH_RUNS/);
  assert.match(field(root, "Action").messages, /RESUME_WAIT_USE_BINDING/);
  assert.match(field(root, "Max depth").messages, /must be 0\..*TRIGGER_DEPTH_UNSUPPORTED/);
  assert.match(field(root, "Source").messages, /needs their source\. Type the name of an event source the host admits\. SOURCE_NOT_SET/);
  assert.match(text(root.querySelector('[role="status"]')), /4 problems/);
  assert.deepEqual(verdicts, ["MANUAL_USE_GRAPH_RUNS"]);
});

const ADMITTED_SOURCES = new Map<string, EventSourceSummary>([
  ["github", { name: "github", state: "ENABLED", currentRevision: 1, eventTypes: ["push", "pull_request"] }],
  ["stripe", { name: "stripe", state: "DISABLED", currentRevision: 2, eventTypes: ["payment_intent.succeeded"] }],
]);
const SIGNED_IN: HostCondition = { state: "signedIn" };

test("suggests admitted event sources on Source and declared event types on Event type for EVENT and CONDITION triggers", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, source: "github", eventType: "push" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  assert.deepEqual(field(root, "Source").suggestions, ["github", "stripe"]);
  assert.deepEqual(field(root, "Event type").suggestions, ["push", "pull_request"]);
});

test("dynamically filters Event type suggestions when switching event sources", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, source: "github", eventType: "push" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  assert.deepEqual(field(root, "Event type").suggestions, ["push", "pull_request"]);
  await type(field(root, "Source").input as HTMLInputElement, "stripe");
  assert.deepEqual(field(root, "Event type").suggestions, ["payment_intent.succeeded"]);
});

test("clearing Source clears Event type suggestions and mismatch diagnostics", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, source: "github", eventType: "push" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  await type(field(root, "Source").input as HTMLInputElement, "");
  assert.deepEqual(field(root, "Event type").suggestions, []);
  assert.doesNotMatch(field(root, "Source").messages, /No event source on the host has this name/);
});

test("emits SOURCE_NOT_ADMITTED info diagnostic for unknown source and does not block draft saving", async () => {
  fakeBackend();
  const { root, draft, verdicts } = await render(
    { ...TRIGGER, source: "custom-source", eventType: "custom-event" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  assert.match(field(root, "Source").messages, /No event source on the host has this name\./);
  assert.equal(verdicts[verdicts.length - 1], null);
  assert.equal(draft().content.source, "custom-source");
  assert.equal(draft().content.eventType, "custom-event");
});

test("emits SOURCE_DISABLED info diagnostic for disabled source", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, source: "stripe", eventType: "payment_intent.succeeded" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  assert.match(field(root, "Source").messages, /Event source "stripe" is DISABLED on the host\./);
  assert.doesNotMatch(field(root, "Event type").messages, /does not declare/);
});

test("emits EVENT_TYPE_UNDECLARED info diagnostic for undeclared event type", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, source: "github", eventType: "issue_comment" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  assert.match(field(root, "Event type").messages, /Event source "github" does not declare event type "issue_comment"\./);
});

test("CONDITION trigger also gets Source and Event type suggestions and diagnostics", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, kind: "CONDITION", source: "github", eventType: "push" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: SIGNED_IN },
  );

  assert.deepEqual(field(root, "Source").suggestions, ["github", "stripe"]);
  assert.deepEqual(field(root, "Event type").suggestions, ["push", "pull_request"]);
});

test("omits suggestions and suppresses unadmitted diagnostics when offline or unreachable", async () => {
  fakeBackend();
  const { root } = await render(
    { ...TRIGGER, source: "custom-source", eventType: "custom-event" },
    undefined,
    { eventSources: ADMITTED_SOURCES, hostCondition: { state: "hostUnreachable" } },
  );

  assert.deepEqual(field(root, "Source").suggestions, []);
  assert.deepEqual(field(root, "Event type").suggestions, []);
  assert.doesNotMatch(field(root, "Source").messages, /No event source on the host has this name/);
  assert.doesNotMatch(field(root, "Event type").messages, /does not declare/);
});
