/// <reference types="node" />
// Component tests for the trigger form's host parts (#475): the status line with Check again, Open
// in browser and the enabled-mismatch note, and the Revisions panel. They render the real form
// into happy-dom and fake only Tauri's `invoke`, the opener's included.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import type { GraphTriggerHost } from "./TriggerHostPanel.tsx";
import type { GraphTriggerHostView, TriggerHostState, TriggerRevision } from "./triggerHost.ts";
import type { TriggerTargetCheck, Validation } from "./types.ts";

const { TriggerForm } = await import("./TriggerForm.tsx");

const NOW = Date.now();
const ADDRESS = "https://praxis-rqse44l43d.localhost:51120/#graph-trigger=nightly&revision=2";

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

/** The backend the form reads, and the URLs the opener was given. */
function fakeBackend() {
  const opened: unknown[] = [];
  fakeInvoke(async (command, args) => {
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_trigger":
        return NO_CHECK;
      case "plugin:opener|open_url":
        opened.push(args.url);
        return null;
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return opened;
}

const revision = (n: number, status: string, current = false): TriggerRevision & { current: boolean } => ({
  revision: n,
  status,
  baseRevision: n > 1 ? n - 1 : null,
  digest: null,
  submittedAt: "2026-11-09T15:37:09.755Z",
  current,
});

const view = (state: TriggerHostState, extra: Partial<GraphTriggerHostView> = {}): GraphTriggerHostView => ({
  state,
  checkedAt: NOW - 2 * 60_000,
  muted: false,
  checking: false,
  admissionPageAddress: null,
  current: null,
  compared: true,
  hostEnabled: null,
  savedEnabled: true,
  revisions: [],
  olderRevisions: false,
  ...extra,
});

/** The form for trigger `nightly`, which starts graph workflow `ship`, given `host`. */
async function render(host: GraphTriggerHost | undefined): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const made = createDraft(
    { kind: "triggers", id: "nightly" },
    {
      id: "nightly",
      kind: "triggers",
      missing: false,
      content: { id: "nightly", revision: "1", kind: "SCHEDULED", contractId: "c", action: "START_RUN", enabled: true, maxDepth: "0" },
      contentHash: "h",
      target: { version: 1, graphWorkflow: "ship" },
      targetHash: "th",
    },
  );
  assert.ok(made.ok);
  await act(async () =>
    root.render(
      createElement(TriggerForm, {
        projectPath: "C:/project",
        draft: made.value,
        contracts: ["c"],
        graphWorkflows: [{ id: "ship", contractId: "c" }],
        refresh: 0,
        crossRecord: null,
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
const statusLine = (root: HTMLElement) => [...root.querySelectorAll('[role="status"]')].map(text).find((t) => t.startsWith("On the host: "));
const buttons = (root: HTMLElement) => [...root.querySelectorAll("button")].map((b) => text(b).trim());
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll("button")].find((b) => text(b).trim() === name);
const click = async (el: Element | undefined) => {
  assert.ok(el, "the control is drawn");
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const signedIn = (v: GraphTriggerHostView, onCheckAgain: () => void = () => {}): GraphTriggerHost => ({ view: v, condition: { state: "signedIn" }, onCheckAgain });

test("the status line names the state, the host's reason and when it was checked, and Check again rereads", async () => {
  fakeBackend();
  let rereads = 0;
  const root = await render(signedIn(view({ kind: "blocked", revision: 1, blockers: ["EVENT_SOURCE_DISABLED"] }), () => (rereads += 1)));
  assert.equal(statusLine(root), "On the host: Admitted, blocked. It can't fire: its event source is disabled (EVENT_SOURCE_DISABLED). · checked 2 min ago");
  await click(button(root, "Check again"));
  assert.equal(rereads, 1);
});

test("a pending candidate offers Open in browser for its admission page, through the loopback-only opener", async () => {
  const opened = fakeBackend();
  const root = await render(signedIn(view({ kind: "candidate", revision: 2 }, { admissionPageAddress: ADDRESS })));
  assert.match(statusLine(root) ?? "", /Candidate waiting for admission \(revision 2\)/);
  await click(button(root, "Open in browser"));
  assert.deepEqual(opened, [ADDRESS]);
});

test("when the host's enabled state differs from the saved file's, the form says disabling on the host doesn't change the file", async () => {
  fakeBackend();
  const root = await render(signedIn(view({ kind: "disabled", revision: 1 }, { hostEnabled: false, savedEnabled: true })));
  assert.match(text(root), /On the host it is disabled, and the saved file says enabled\. Disabling a trigger on the host doesn't change its file/);
  act(() => mounted!.root.unmount());
  mounted!.container.remove();
  mounted = null;
  const agreeing = await render(signedIn(view({ kind: "admitted", revision: 1 }, { hostEnabled: true, savedEnabled: true })));
  assert.doesNotMatch(text(agreeing), /Disabling a trigger on the host/);
});

test("without a digest to compare, the status line gives the current revision and its submit time", async () => {
  fakeBackend();
  const root = await render(signedIn(view({ kind: "admitted", revision: 3 }, { compared: false, current: { revision: 3, submittedAt: "2026-11-09T15:37:09.755Z" } })));
  assert.match(statusLine(root) ?? "", /Admitted, enabled\. Revision 3, submitted /);
});

test("the Revisions panel lists number, status, base, submit time and the current one, twenty at a time", async () => {
  fakeBackend();
  const revisions = Array.from({ length: 25 }, (_, i) => revision(25 - i, i === 0 ? "CANDIDATE" : "ADMITTED", i === 1));
  const root = await render(signedIn(view({ kind: "candidate", revision: 25 }, { revisions, olderRevisions: true })));
  const table = root.querySelector('table[aria-label="Revisions on the host"]');
  assert.ok(table, "the Revisions table");
  assert.deepEqual([...table.querySelectorAll("thead th")].map(text), ["Revision", "Status", "Based on", "Submitted", "Current"]);
  const rows = () => [...table.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("th, td")].map(text));
  assert.equal(rows().length, 20);
  assert.deepEqual(rows()[0].slice(0, 3), ["25", "Candidate, waiting for admission", "Revision 24"]);
  assert.deepEqual([rows()[0][4], rows()[1][4]], ["", "Current"]);
  await click(button(root, "Show 5 more"));
  assert.equal(rows().length, 25);
  assert.equal(rows()[24][2], "None");
  assert.match(text(root), /The host holds older revisions than these\./);
});

test("there is no admit, reject or enable control in any state", async () => {
  fakeBackend();
  const states: TriggerHostState[] = [
    { kind: "candidate", revision: 2 },
    { kind: "disabled", revision: 1 },
    { kind: "blocked", revision: 1, blockers: ["X"] },
    { kind: "admitted", revision: 1 },
    { kind: "retired", revision: 1 },
  ];
  for (const state of states) {
    const root = await render(signedIn(view(state, { admissionPageAddress: ADDRESS, revisions: [revision(2, "CANDIDATE"), revision(1, "ADMITTED", true)] })));
    assert.deepEqual(buttons(root).filter((b) => /admit|reject|enable/i.test(b)), [], state.kind);
    act(() => mounted!.root.unmount());
    mounted!.container.remove();
    mounted = null;
  }
});

test("a trigger the builder gives no host, one without a saved target, draws no host parts", async () => {
  fakeBackend();
  const root = await render(undefined);
  assert.equal(root.querySelector('table[aria-label="Revisions on the host"]'), null);
  assert.equal(button(root, "Check again"), undefined);
  assert.equal(statusLine(root), undefined);
});
