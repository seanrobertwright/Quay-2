/// <reference types="node" />
// Component tests for the graph workflow form's host parts (#461): the status line with Check
// again and Open in browser, and the Revisions panel. They render the real form into happy-dom
// and fake only Tauri's `invoke`, the opener's included.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import type { GraphHostState, GraphWorkflowHostView, HostRevision } from "./graphHost.ts";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import type { GraphWorkflowCheck, Validation } from "./types.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NOW = Date.now();
const ADDRESS = "https://praxis-nmdro7k3gf.localhost:49889/#graph-workflow=ship&revision=2";

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
const passing: GraphWorkflowCheck = { diagnostics: [], grants: ["g1"] };

/** The backend the form reads, and the URLs the opener was given. */
function fakeBackend() {
  const opened: unknown[] = [];
  fakeInvoke(async (command, args) => {
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_graph_workflow":
        return passing;
      case "praxis_graph_workflow_triggers":
        return { ids: [], unchecked: [] };
      case "plugin:opener|open_url":
        opened.push(args.url);
        return null;
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return opened;
}

const revision = (n: number, status: string, current = false): HostRevision & { current: boolean } => ({
  revision: n,
  status,
  bundleDigest: null,
  submittedAt: "2026-11-08T23:30:15.433Z",
  decidedAt: null,
  current,
});

const view = (state: GraphHostState, extra: Partial<GraphWorkflowHostView> = {}): GraphWorkflowHostView => ({
  state,
  checkedAt: NOW - 2 * 60_000,
  muted: false,
  checking: false,
  admissionPageAddress: null,
  current: null,
  compared: true,
  differsFromCurrent: false,
  reviewDigest: null,
  revisions: [],
  olderRevisions: false,
  ...extra,
});

async function render(host: GraphWorkflowHost | undefined): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const made = createDraft(
    { kind: "graph-workflows", id: "ship" },
    { id: "ship", kind: "graph-workflows", missing: false, content: { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" }, contentHash: "h" },
  );
  assert.ok(made.ok);
  await act(async () =>
    root.render(
      createElement(GraphWorkflowForm, {
        projectPath: "C:/project",
        draft: made.value,
        contracts: ["c"],
        graphs: ["g"],
        graphBindings: [{ id: "g-1", graphId: "g" }],
        refresh: 0,
        host,
        onEdit: () => {},
        onOpen: () => {},
        onValidated: () => {},
      }),
    ),
  );
  return container;
}

const text = (el: Element | null | undefined) => el?.textContent ?? "";
const buttons = (root: HTMLElement) => [...root.querySelectorAll("button")].map((b) => text(b).trim());
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll("button")].find((b) => text(b).trim() === name);
const click = async (el: Element | undefined) => {
  assert.ok(el, "the control is drawn");
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

test("the status line names the state and when it was checked, and Check again rereads", async () => {
  fakeBackend();
  let rereads = 0;
  const root = await render({ view: view({ kind: "notReady", revision: 1, reason: "build: no agent." }), condition: { state: "signedIn" }, onCheckAgain: () => (rereads += 1) });
  const status = root.querySelector('[role="status"]');
  assert.equal(text(status), "On the host: Admitted, not ready. build: no agent. · checked 2 min ago");
  await click(button(root, "Check again"));
  assert.equal(rereads, 1);
});

test("a pending candidate offers Open in browser for its admission page, through the loopback-only opener", async () => {
  const opened = fakeBackend();
  const root = await render({ view: view({ kind: "candidate", revision: 2 }, { admissionPageAddress: ADDRESS }), condition: { state: "signedIn" }, onCheckAgain: () => {} });
  assert.match(text(root.querySelector('[role="status"]')), /Candidate waiting for admission \(revision 2\)/);
  await click(button(root, "Open in browser"));
  assert.deepEqual(opened, [ADDRESS]);
});

test("an admission page that isn't on this machine's host is never opened, and the form says why", async () => {
  const opened = fakeBackend();
  const elsewhere = "https://example.com/#graph-workflow=ship&revision=2";
  const root = await render({ view: view({ kind: "candidate", revision: 2 }, { admissionPageAddress: elsewhere }), condition: { state: "signedIn" }, onCheckAgain: () => {} });
  await click(button(root, "Open in browser"));
  assert.deepEqual(opened, []);
  assert.match(text(root.querySelector('[role="alert"]')), /Quay opens only pages on this machine's Praxis host/);
});

test("without a digest to compare, the status line gives the current revision and its submit time", async () => {
  fakeBackend();
  const root = await render({
    view: view({ kind: "admitted", revision: 3 }, { compared: false, current: { revision: 3, submittedAt: "2026-11-08T23:30:15.433Z" } }),
    condition: { state: "signedIn" },
    onCheckAgain: () => {},
  });
  assert.match(text(root.querySelector('[role="status"]')), /Admitted\. Revision 3, submitted /);
});

test("the Revisions panel lists number, status, submitted and decided times and the current one, twenty at a time", async () => {
  fakeBackend();
  const revisions = Array.from({ length: 25 }, (_, i) => revision(25 - i, i === 0 ? "CANDIDATE" : i === 1 ? "CURRENT" : "ADMITTED", i === 1));
  const root = await render({ view: view({ kind: "candidate", revision: 25 }, { revisions, olderRevisions: true }), condition: { state: "signedIn" }, onCheckAgain: () => {} });
  const table = root.querySelector('table[aria-label="Revisions on the host"]');
  assert.ok(table, "the Revisions table");
  assert.deepEqual(
    [...table.querySelectorAll("thead th")].map(text),
    ["Revision", "Status", "Submitted", "Decided", "Current"],
  );
  const rows = () => [...table.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("th, td")].map(text));
  assert.equal(rows().length, 20);
  assert.equal(rows()[0][0], "25");
  assert.equal(rows()[0][1], "Candidate, waiting for admission");
  assert.equal(rows()[0][3], "Not given by the host");
  assert.deepEqual([rows()[0][4], rows()[1][4]], ["", "Current"]);
  await click(button(root, "Show 5 more"));
  assert.equal(rows().length, 25);
  assert.equal(button(root, "Show 5 more"), undefined);
  assert.match(text(root), /The host holds older revisions than these\./);
});

test("there is no admit, reject or retire control in any state", async () => {
  fakeBackend();
  const states: GraphHostState[] = [
    { kind: "candidate", revision: 2 },
    { kind: "admitted", revision: 1 },
    { kind: "retired", revision: 1 },
    { kind: "notReady", revision: 1, reason: "r" },
  ];
  for (const state of states) {
    const root = await render({ view: view(state, { admissionPageAddress: ADDRESS, revisions: [revision(2, "CANDIDATE"), revision(1, "CURRENT", true)] }), condition: { state: "signedIn" }, onCheckAgain: () => {} });
    assert.deepEqual(buttons(root).filter((b) => /admit|reject|retire/i.test(b)), [], state.kind);
    act(() => mounted!.root.unmount());
    mounted!.container.remove();
    mounted = null;
  }
});

test("without a host, the form draws no host parts", async () => {
  fakeBackend();
  const root = await render(undefined);
  assert.equal(root.querySelector('table[aria-label="Revisions on the host"]'), null);
  assert.equal(button(root, "Check again"), undefined);
});
