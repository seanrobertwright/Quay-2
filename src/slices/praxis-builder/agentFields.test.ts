/// <reference types="node" />
// Component tests for the two fields that name a catalog agent (#482): the agent id of a Runs as
// entry and a workflow template's Agent. They render the real forms into happy-dom with the
// picker the real `praxis agents --json` printed, and fake only Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { agentPickerOf, type AgentPicker } from "./agentPicker.ts";
import { createNewDraft } from "./drafts.ts";
import { catalogPicker, CHANGED_REASON, noCatalogPicker } from "./fixtures/agentOutputs.ts";
import type { ShownBinding } from "./RunsAsForm.tsx";

const { RunsAsSection } = await import("./RunsAsForm.tsx");
const { TemplateForm } = await import("./TemplateForm.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  return container;
}

const WITH_CATALOG = agentPickerOf(catalogPicker());
const NO_CATALOG = agentPickerOf(noCatalogPicker());
/** The agent ids the project's saved files use, one of which the catalog has too. */
const USED = ["alpha", "ready-coder", "zeta"];

/** The field labelled `label`, the suggestions its list offers and everything it is described by. */
function field(root: HTMLElement, label: string) {
  const labelEl = [...root.querySelectorAll("label")].find((l) => l.textContent === label);
  assert.ok(labelEl, `a field labelled ${label}`);
  const input = root.querySelector(`[id="${labelEl.htmlFor}"]`) as HTMLInputElement;
  const listId = input.getAttribute("list");
  const options = listId ? [...root.querySelectorAll(`[id="${listId}"] option`)] : [];
  const described = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return {
    input,
    suggestions: options.map((o) => [o.getAttribute("value"), o.getAttribute("label")]),
    description: described.map((id) => root.querySelector(`[id="${id}"]`)?.textContent ?? "").join("\n"),
    warnings: described.flatMap((id) => [...root.querySelectorAll(`[id="${id}"] [aria-label="Warning"]`)]).length,
  };
}

/** The Runs as section of an AGENT task whose entry names `agentId`. */
function runsAs(agentId: string, agentPicker: AgentPicker | null) {
  const binding: ShownBinding = {
    id: "b1",
    content: { nodes: { build: { executionKind: "AGENT", role: "WORK", agentId } } },
    diagnostics: [],
    suggestions: { agentId: USED, protocolBindingId: [], action: [], resource: [] },
    agentPicker,
    attach: { state: "checking" },
    onEdit: () => {},
  };
  return createElement(RunsAsSection, { node: { id: "build", kind: "TASK", dependsOn: [], config: { executionKind: "AGENT" } }, binding });
}

/** The template form of a template whose Agent is `agent`, and the verdicts it reported. */
function template(agent: string | undefined, picker: AgentPicker | null) {
  fakeInvoke(async (cmd) => {
    if (cmd === "praxis_validate") return { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
    throw new Error(`unexpected invoke ${cmd}`);
  });
  const draft = createNewDraft({ kind: "templates", id: "build-app" }, agent === undefined ? {} : { agent });
  assert.ok(draft.ok);
  const verdicts: (string | null)[] = [];
  const element = createElement(TemplateForm, {
    draft: draft.value,
    onEdit: () => {},
    onValidated: (verdict) => verdicts.push(verdict),
    onInstall: () => {},
    host: null,
    agents: { picker, used: USED },
  });
  return { element, verdicts };
}

const CATALOG_THEN_USED = [
  ["ready-coder", null],
  ["changed-coder", "can't be bound"],
  ["unadapted-coder", null],
  ["alpha", null],
  ["zeta", null],
];
const USED_ONLY = [
  ["alpha", null],
  ["ready-coder", null],
  ["zeta", null],
];

test("Runs as: the agent id suggests the catalog's agents in catalog order, then the project's other ids", async () => {
  const root = await render(runsAs("ready-coder", WITH_CATALOG));
  const agent = field(root, "Agent id");
  assert.deepEqual(agent.suggestions, CATALOG_THEN_USED);
  assert.equal(agent.warnings, 0);
});

test("Template: Agent suggests the catalog's agents in catalog order, then the project's other ids", async () => {
  const root = await render(template("ready-coder", WITH_CATALOG).element);
  const agent = field(root, "Agent");
  assert.deepEqual(agent.suggestions, CATALOG_THEN_USED);
  assert.equal(agent.warnings, 0);
  assert.match(agent.description, /Empty uses the built-in engine:local-coding\./);
  assert.doesNotMatch(agent.description, /lists no agents/);
});

test("Runs as: an agent id the catalog doesn't have is warned about, and the field isn't marked invalid", async () => {
  const root = await render(runsAs("ghost-coder", WITH_CATALOG));
  const agent = field(root, "Agent id");
  assert.match(agent.description, /The host's agent catalog doesn't offer the agent "ghost-coder"\./);
  assert.equal(agent.warnings, 1);
  // A warning: the field isn't marked invalid, and the binding's own issues hold nothing of it.
  assert.equal(agent.input.getAttribute("aria-invalid"), null);
  assert.equal(root.querySelectorAll('[aria-label="Error"]').length, 0);
});

test("Template: an Agent the catalog doesn't have is warned about, and the template can still be saved", async () => {
  const { element, verdicts } = template("ghost-coder", WITH_CATALOG);
  const root = await render(element);
  const agent = field(root, "Agent");
  assert.match(agent.description, /The host's agent catalog doesn't offer the agent "ghost-coder"\./);
  assert.equal(agent.warnings, 1);
  assert.equal(agent.input.getAttribute("aria-invalid"), null);
  // The verdict the form reports is what allows a save, and it is the validation's alone.
  assert.deepEqual(verdicts, [null]);
});

test("an agent that can't be bound shows the host's reasons as a warning in both forms", async () => {
  const inBinding = field(await render(runsAs("changed-coder", WITH_CATALOG)), "Agent id");
  assert.ok(inBinding.description.includes(`The host can't bind this agent: ${CHANGED_REASON}`));
  assert.equal(inBinding.warnings, 1);
  act(() => mounted?.root.unmount());
  const inTemplate = field(await render(template("changed-coder", WITH_CATALOG).element), "Agent");
  assert.ok(inTemplate.description.includes(`The host can't bind this agent: ${CHANGED_REASON}`));
  assert.equal(inTemplate.warnings, 1);
});

test("an empty agent id shows no picker warning in either form", async () => {
  const inBinding = field(await render(runsAs("", WITH_CATALOG)), "Agent id");
  assert.equal(inBinding.warnings, 0);
  act(() => mounted?.root.unmount());
  const inTemplate = field(await render(template(undefined, WITH_CATALOG).element), "Agent");
  assert.equal(inTemplate.warnings, 0);
  assert.doesNotMatch(inTemplate.description, /catalog doesn't offer/);
});

test("a host with no agent catalog gives no host suggestions and no warnings, and the field says so", async () => {
  const inBinding = field(await render(runsAs("ghost-coder", NO_CATALOG)), "Agent id");
  assert.deepEqual(inBinding.suggestions, USED_ONLY);
  assert.equal(inBinding.warnings, 0);
  assert.match(inBinding.description, /The host has no agent catalog\./);
  act(() => mounted?.root.unmount());
  const inTemplate = field(await render(template("ghost-coder", NO_CATALOG).element), "Agent");
  assert.deepEqual(inTemplate.suggestions, USED_ONLY);
  assert.equal(inTemplate.warnings, 0);
  assert.match(inTemplate.description, /The host has no agent catalog\./);
});

test("when the picker couldn't be read, both fields suggest the project's own ids and warn of nothing", async () => {
  // A failed read, a refusal and a record in another format all leave no picker.
  const unread = [agentPickerOf({ kind: "hostDown", message: "down" }), agentPickerOf({ kind: "refused", message: "no" }), agentPickerOf(catalogPicker({ format: "aiws-agent-picker/2" }))];
  assert.deepEqual(unread, [null, null, null]);
  const inBinding = field(await render(runsAs("ghost-coder", null)), "Agent id");
  assert.deepEqual(inBinding.suggestions, USED_ONLY);
  assert.equal(inBinding.warnings, 0);
  assert.equal(inBinding.description, "");
  act(() => mounted?.root.unmount());
  const inTemplate = field(await render(template("ghost-coder", null).element), "Agent");
  assert.deepEqual(inTemplate.suggestions, USED_ONLY);
  assert.equal(inTemplate.warnings, 0);
  assert.doesNotMatch(inTemplate.description, /no agent catalog/);
});
