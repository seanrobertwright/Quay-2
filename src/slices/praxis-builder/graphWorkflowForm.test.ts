/// <reference types="node" />
// Component tests for the graph workflow form (#459): its pickers for the contract, the graph and
// one of that graph's bindings, each of which takes an unknown id and flags it; the grant set it
// carries; and the local checks shown on the fields they name. They render the real form into
// happy-dom and fake only Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft, type Draft } from "./drafts.ts";
import type { GraphWorkflowEdit } from "./graphWorkflow.ts";
import type { DefinitionRef, Diagnostic, GraphWorkflowCheck, Validation } from "./types.ts";

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

/** The backend: `praxis_validate` gives `shape`, and `praxis_check_graph_workflow` gives `check`. */
function fakeBackend(check: GraphWorkflowCheck, shape: Validation = accepted) {
  const sent: { command: string; args: Record<string, unknown> }[] = [];
  fakeInvoke(async (command, args) => {
    sent.push({ command, args });
    switch (command) {
      case "praxis_validate":
        return shape;
      case "praxis_check_graph_workflow":
        return check;
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return sent;
}

function draftOf(content: Record<string, unknown>): Draft {
  const ref = { kind: "graph-workflows" as const, id: "ship" };
  const made = createDraft(ref, { id: "ship", kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(made.ok);
  return made.value;
}

interface Rendered {
  root: HTMLElement;
  edits: GraphWorkflowEdit[];
  opened: DefinitionRef[];
  verdicts: (string | null)[];
}

async function render(content: Record<string, unknown>): Promise<Rendered> {
  const edits: GraphWorkflowEdit[] = [];
  const opened: DefinitionRef[] = [];
  const verdicts: (string | null)[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(GraphWorkflowForm, {
        projectPath: PROJECT,
        draft: draftOf(content),
        contracts: ["c", "d"],
        graphs: ["g", "other"],
        graphBindings: [
          { id: "g-1", graphId: "g" },
          { id: "g-2", graphId: "g" },
          { id: "other-1", graphId: "other" },
        ],
        refresh: 0,
        onEdit: (e: GraphWorkflowEdit) => edits.push(e),
        onOpen: (r: DefinitionRef) => opened.push(r),
        onValidated: (v: string | null) => verdicts.push(v),
      })
    )
  );
  return { root: container, edits, opened, verdicts };
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
