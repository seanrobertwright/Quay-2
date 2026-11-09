/// <reference types="node" />
// Component tests for the graph workflow form (#459): its pickers for the contract, the graph and
// one of that graph's bindings, each of which takes an unknown id and flags it; the grant set it
// carries; the local checks shown on the fields they name; and the Triggers section of the
// triggers that start it (#479), read again after a rename. They render the real form into
// happy-dom and fake only Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft, type Draft } from "./drafts.ts";
import type { GraphWorkflowEdit } from "./graphWorkflow.ts";
import type { DefinitionRef, Diagnostic, GraphWorkflowCheck, GraphWorkflowTriggers, Validation } from "./types.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

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

const NO_TRIGGERS: GraphWorkflowTriggers = { ids: [], unchecked: [] };

/**
 * The backend: `praxis_validate` gives `shape`, `praxis_check_graph_workflow` gives `check`, and
 * `praxis_graph_workflow_triggers` gives `triggers`, or the triggers of the graph workflow id asked.
 */
function fakeBackend(
  check: GraphWorkflowCheck,
  shape: Validation = accepted,
  triggers: GraphWorkflowTriggers | ((graphWorkflowId: string) => GraphWorkflowTriggers) = NO_TRIGGERS
) {
  const sent: { command: string; args: Record<string, unknown> }[] = [];
  fakeInvoke(async (command, args) => {
    sent.push({ command, args });
    switch (command) {
      case "praxis_validate":
        return shape;
      case "praxis_check_graph_workflow":
        return check;
      case "praxis_graph_workflow_triggers":
        return typeof triggers === "function" ? triggers(String(args.graphWorkflowId)) : triggers;
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return sent;
}

function draftOf(content: Record<string, unknown>, id = "ship"): Draft {
  const ref = { kind: "graph-workflows" as const, id };
  const made = createDraft(ref, { id, kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(made.ok);
  return made.value;
}

/** What a test can change between renders: the graph workflow's id and the refresh count. */
interface FormOptions {
  id?: string;
  refresh?: number;
}

interface Rendered {
  root: HTMLElement;
  edits: GraphWorkflowEdit[];
  opened: DefinitionRef[];
  verdicts: (string | null)[];
  /** Renders the form again in place with `content` and `options`, as the builder does after a rename. */
  rerender: (content: Record<string, unknown>, options?: FormOptions) => Promise<void>;
}

async function render(content: Record<string, unknown>, options: FormOptions = {}): Promise<Rendered> {
  const edits: GraphWorkflowEdit[] = [];
  const opened: DefinitionRef[] = [];
  const verdicts: (string | null)[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const draw = (body: Record<string, unknown>, { id, refresh = 0 }: FormOptions) =>
    act(async () =>
      root.render(
        createElement(GraphWorkflowForm, {
          projectPath: PROJECT,
          draft: draftOf(body, id),
          contracts: ["c", "d"],
          graphs: ["g", "other"],
          graphBindings: [
            { id: "g-1", graphId: "g" },
            { id: "g-2", graphId: "g" },
            { id: "other-1", graphId: "other" },
          ],
          refresh,
          onEdit: (e: GraphWorkflowEdit) => edits.push(e),
          onOpen: (r: DefinitionRef) => opened.push(r),
          onValidated: (v: string | null) => verdicts.push(v),
        })
      )
    );
  await draw(content, options);
  return { root: container, edits, opened, verdicts, rerender: (body, next = {}) => draw(body, next) };
}

const WORKFLOW = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
const text = (el: Element | null | undefined) => el?.textContent ?? "";

/** The section whose heading names it `title`. */
function sectionTitled(root: HTMLElement, title: string): Element | null {
  return [...root.querySelectorAll("section")].find((s) => text(root.querySelector(`[id="${s.getAttribute("aria-labelledby")}"]`)) === title) ?? null;
}

/** The input labelled `label`, and the messages it points at. */
function field(root: HTMLElement, label: string) {
  const labelEl = [...root.querySelectorAll("label")].find((l) => text(l) === label);
  assert.ok(labelEl, `a field labelled ${label}`);
  const input = root.querySelector<HTMLInputElement>(`[id="${labelEl.getAttribute("for")}"]`);
  assert.ok(input, `the input of ${label}`);
  const described = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  const messages = described.map((id) => text(root.querySelector(`[id="${id}"]`))).join(" ");
  const options = [...root.querySelectorAll(`datalist[id="${input.getAttribute("list")}"] option`)].map((o) => o.getAttribute("value"));
  return { input, messages, options };
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const issue = (code: string, path: string, message: string): Diagnostic => ({ code, severity: "error", message, path });

test("the pickers offer the project's contracts, graphs and only the chosen graph's bindings", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const { root } = await render(WORKFLOW);
  assert.deepEqual(field(root, "Contract").options, ["c", "d"]);
  assert.deepEqual(field(root, "Graph").options, ["g", "other"]);
  assert.deepEqual(field(root, "Graph binding").options, ["g-1", "g-2"]);
  assert.equal(field(root, "Contract").input.value, "c");
});

test("each picker takes an id no record has and flags it as missing", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const { root } = await render({ version: 1, contractId: "nope", graphId: "gone", graphBindingId: "lost" });
  assert.match(field(root, "Contract").messages, /No contract has this id\./);
  assert.match(field(root, "Graph").messages, /No graph has this id\./);
  assert.match(field(root, "Graph binding").messages, /No graph binding has this id\./);
  // The graph has no bindings to offer.
  assert.deepEqual(field(root, "Graph binding").options, []);
});

test("typing an id edits the record as one merging step, and an unsafe id is refused inline", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const { root, edits } = await render(WORKFLOW);
  type(field(root, "Contract").input, "new-contract");
  assert.deepEqual(edits, [{ type: "set-field", key: "contractId", value: "new-contract", live: true }]);
  type(field(root, "Graph").input, "a b");
  assert.equal(edits.length, 1, "an unsafe id isn't applied");
  assert.match(field(root, "Graph").messages, /may only use letters/);
});

test("the form shows the contract's grants read-only, with a link to the contract", async () => {
  fakeBackend({ grants: ["root", "child"], diagnostics: [] });
  const { root, opened } = await render(WORKFLOW);
  const grants = sectionTitled(root, "Grants");
  assert.ok(grants, "a Grants section");
  assert.deepEqual([...grants.querySelectorAll("li")].map(text), ["root", "child"]);
  assert.equal(grants.querySelectorAll("input, button[aria-label^='Remove']").length, 0, "read-only");
  const link = [...grants.querySelectorAll("button")].find((b) => text(b) === "Open contract c");
  assert.ok(link, "a link to the contract");
  act(() => link.click());
  assert.deepEqual(opened, [{ kind: "contracts", id: "c" }]);
});

test("a contract whose bindings file lists no grants says so", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const { root } = await render(WORKFLOW);
  assert.match(text(sectionTitled(root, "Grants")), /lists no grants/);
});

test("each local check shows as an issue on the field it names, and marks the record invalid", async () => {
  const sent = fakeBackend({
    grants: [],
    diagnostics: [
      issue("INVALID_REFERENCE", "/contractId", "Contract c isn't valid: The deadline isn't set."),
      issue("GRAPH_NOT_BOUND", "/graphId", "Graph g isn't in contract c's bindings file, so it can't run under it."),
      issue("BINDING_GRAPH_MISMATCH", "/graphBindingId", "Graph binding g-1 binds graph other, not g."),
    ],
  });
  const { root, verdicts } = await render(WORKFLOW);
  assert.match(field(root, "Contract").messages, /Contract c isn't valid/);
  assert.match(field(root, "Graph").messages, /isn't in contract c's bindings file/);
  assert.match(field(root, "Graph binding").messages, /binds graph other, not g/);
  assert.match(text(root.querySelector('[role="status"]')), /3 problems/);
  assert.deepEqual(verdicts, ["INVALID_REFERENCE"]);
  const check = sent.find((s) => s.command === "praxis_check_graph_workflow");
  assert.deepEqual(check?.args, { projectPath: PROJECT, content: WORKFLOW });
});

test("a missing record's check replaces the picker's own missing flag", async () => {
  fakeBackend({ grants: [], diagnostics: [issue("NOT_FOUND", "/contractId", "No saved contract has the id nope.")] });
  const { root } = await render({ ...WORKFLOW, contractId: "nope" });
  const { messages } = field(root, "Contract");
  assert.match(messages, /No saved contract has the id nope\./);
  assert.doesNotMatch(messages, /No contract has this id/);
});

test("a record that passes every check is valid, and the shape check's issues show too", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const ok = await render(WORKFLOW);
  assert.deepEqual(ok.verdicts, [null]);
  assert.match(text(ok.root.querySelector('[role="status"]')), /passes its local checks/);
  act(() => mounted?.root.unmount());
  mounted?.container.remove();
  mounted = null;
  fakeBackend(
    { grants: [], diagnostics: [] },
    { verdict: "INVALID_FIELD", diagnostics: [issue("INVALID_FIELD", "/version", "The version must be 1.")], omitted: { errors: 0, warnings: 0, info: 0 } }
  );
  const bad = await render({ ...WORKFLOW, version: 2 });
  assert.match(text(bad.root), /The version must be 1\./);
  assert.deepEqual(bad.verdicts, ["INVALID_FIELD"]);
});

test("a binding of another graph isn't flagged as missing, though only the chosen graph's are offered", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const { root } = await render({ ...WORKFLOW, graphBindingId: "other-1" });
  const binding = field(root, "Graph binding");
  assert.doesNotMatch(binding.messages, /No graph binding has this id/);
  assert.deepEqual(binding.options, ["g-1", "g-2"]);
});

test("a contract no saved record has carries no grants and gets no link", async () => {
  fakeBackend({ grants: [], diagnostics: [issue("NOT_FOUND", "/contractId", "No saved contract has the id nope.")] });
  const { root } = await render({ ...WORKFLOW, contractId: "nope" });
  const grants = sectionTitled(root, "Grants");
  assert.match(text(grants), /No saved contract has the id nope, so there are no grants to carry\./);
  assert.doesNotMatch(text(grants), /lists no grants/);
  assert.equal([...(grants?.querySelectorAll("button") ?? [])].length, 0);
});

// --- the Triggers section (#479) ------------------------------------------------------------

/** The Triggers section's trigger links. */
const triggerLinks = (root: HTMLElement) => [...(sectionTitled(root, "Triggers")?.querySelectorAll("a") ?? [])];

test("the Triggers section lists each trigger that starts the workflow as a link to its form", async () => {
  const sent = fakeBackend({ grants: [], diagnostics: [] }, accepted, { ids: ["nightly", "on-push"], unchecked: [] });
  const { root, opened } = await render(WORKFLOW);
  const links = triggerLinks(root);
  assert.deepEqual(links.map(text), ["nightly", "on-push"]);
  for (const link of links) assert.ok(link.hasAttribute("href"), "a trigger is a link, so it has an href");
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    links[1].dispatchEvent(click);
  });
  assert.deepEqual(opened, [{ kind: "triggers", id: "on-push" }]);
  assert.equal(click.defaultPrevented, true, "the builder opens the trigger, not the href");
  const asked = sent.filter((s) => s.command === "praxis_graph_workflow_triggers").map((s) => s.args);
  assert.deepEqual(asked, [{ projectPath: PROJECT, graphWorkflowId: "ship" }]);
});

test("a workflow no trigger starts says so in its Triggers section", async () => {
  fakeBackend({ grants: [], diagnostics: [] });
  const { root } = await render(WORKFLOW);
  const section = sectionTitled(root, "Triggers");
  assert.ok(section, "a Triggers section, even with no triggers");
  assert.match(text(section), /No saved trigger starts this graph workflow\./);
  assert.equal(triggerLinks(root).length, 0);
});

test("after a rename the section reads the triggers of the new name", async () => {
  // As on disk after the rename: the target files that named ship now name ship-it (#472).
  const sent = fakeBackend({ grants: [], diagnostics: [] }, accepted, (id) =>
    id === "ship" ? { ids: ["nightly"], unchecked: [] } : id === "ship-it" ? { ids: ["nightly", "on-push"], unchecked: [] } : NO_TRIGGERS
  );
  const { root, rerender } = await render(WORKFLOW);
  assert.deepEqual(triggerLinks(root).map(text), ["nightly"]);
  await rerender(WORKFLOW, { id: "ship-it", refresh: 1 });
  assert.deepEqual(triggerLinks(root).map(text), ["nightly", "on-push"]);
  const asked = sent.filter((s) => s.command === "praxis_graph_workflow_triggers").map((s) => s.args.graphWorkflowId);
  assert.deepEqual(asked, ["ship", "ship-it"]);
});

test("an answer for the old name that comes after a rename is never shown", async () => {
  const answers = new Map<string, (found: GraphWorkflowTriggers) => void>();
  fakeInvoke(async (command, args) => {
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_graph_workflow":
        return { grants: [], diagnostics: [] };
      case "praxis_graph_workflow_triggers":
        return new Promise((resolve) => answers.set(String(args.graphWorkflowId), resolve));
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  const { root, rerender } = await render(WORKFLOW);
  await rerender(WORKFLOW, { id: "ship-it", refresh: 1 });
  await act(async () => answers.get("ship-it")!({ ids: ["renamed"], unchecked: [] }));
  await act(async () => answers.get("ship")!({ ids: ["stale"], unchecked: [] }));
  assert.deepEqual(triggerLinks(root).map(text), ["renamed"]);
});

test("without graph trigger host state each trigger shows only its id", async () => {
  fakeBackend({ grants: [], diagnostics: [] }, accepted, { ids: ["nightly"], unchecked: [] });
  const { root } = await render(WORKFLOW);
  const items = [...(sectionTitled(root, "Triggers")?.querySelectorAll("li") ?? [])];
  assert.deepEqual(items.map(text), ["nightly"]);
  assert.equal(items[0].children.length, 1, "the link alone");
});

test("a target file the lookup skipped is named, and a failed lookup says why", async () => {
  const skipped = ".praxis/trigger-targets/orphan.json: no trigger orphan has this target file.";
  fakeBackend({ grants: [], diagnostics: [] }, accepted, { ids: [], unchecked: [skipped] });
  const { root } = await render(WORKFLOW);
  assert.match(text(sectionTitled(root, "Triggers")), /No saved trigger starts this graph workflow\./);
  const lines = [...(sectionTitled(root, "Triggers")?.querySelectorAll("li") ?? [])].map(text);
  assert.deepEqual(lines, [`Skipped: ${skipped}`]);
  act(() => mounted?.root.unmount());
  mounted?.container.remove();
  mounted = null;
  fakeInvoke(async (command) => {
    if (command === "praxis_validate") return accepted;
    if (command === "praxis_check_graph_workflow") return { grants: [], diagnostics: [] };
    throw new Error(".praxis/trigger-targets can't be listed: access denied");
  });
  const failed = await render(WORKFLOW);
  const alert = sectionTitled(failed.root, "Triggers")?.querySelector('[role="alert"]');
  assert.match(text(alert), /can't be listed: access denied/);
});
