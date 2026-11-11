/// <reference types="node" />
// Component tests for Check on host and Submit on the graph workflow form (#444, #462): each
// gate that disables Submit, a check that finds faults, a submission and the identical-bundle
// refusal. They render the real form over the real graph host model into happy-dom and fake only
// Tauri's `invoke`, the out-of-process boundary, answering it with the outcomes the Praxis CLI
// runner gives for the fake praxis's replays (graph_outputs.fixture.json, which the real
// `praxis` printed against the SDK's simulated host).
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import { createGraphHost, type GraphHost } from "./graphHost.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import type { DefinitionRef, GraphWorkflowBundle, GraphWorkflowCheck, Validation } from "./types.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NAME = "release-review";

/** What the real `praxis --json` printed for each graph command, by case name. */
const recorded = JSON.parse(
  readFileSync(new URL("../../../src-tauri/src/slices/praxis/host/graph_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };
const stdout = (name: string) => structuredClone(recorded.cases.find((c) => c.name === name)!.stdout);

/** The digest of the recorded bundle, which every revision the recorded host holds has. */
const RECORDED_DIGEST = "sha256:f29d05656810f1a352c2fa594710e4f01333ea7e1f8833708bdb6a915870474f";
const OTHER_DIGEST = `sha256:${"e".repeat(64)}`;
/** The admission page of the recorded first candidate. */
const ADMISSION_PAGE = String(stdout("graphs submit: a candidate").admissionPageAddress);

/** The runner's outcome for each recorded case. */
const recordOf = (name: string): CallOutcome => ({ kind: "record", record: stdout(name) });
const CHECK_PASSES = recordOf("graphs check: valid");
const CHECK_FAULTS: CallOutcome = { kind: "bundleInvalid", record: stdout("graphs check: faults, exit 9") };
const SUBMITTED = recordOf("graphs submit: a candidate");
const NOT_SUBMITTED: CallOutcome = {
  kind: "hostRefused",
  message: "The host refused the request (NOT_FOUND).",
  hostCode: "NOT_FOUND",
  record: stdout("graphs show: not submitted"),
};
/** The recorded `graphs show`: candidates 2 and 1 pending, both with the recorded digest. */
const TWO_CANDIDATES = recordOf("graphs show");
/** Revision 1 current, with `digest`, and nothing pending. */
function admittedOne(digest: string): CallOutcome {
  const record = stdout("graphs show");
  const revisions = record.revisions as Record<string, unknown>[];
  record.revisions = [{ ...revisions[1], status: "CURRENT", bundleDigest: digest }];
  Object.assign(record, { currentRevision: 1, runnable: true, latestRevision: 1, pendingCount: 0, admissionPageAddress: null });
  return { kind: "record", record };
}

const accepted: Validation = { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
const passing: GraphWorkflowCheck = { diagnostics: [], grants: ["grant-one", "a-grant-sorted-first"] };

/** The bundle the saved files make, as `praxis_graph_workflow_bundle` gives it. */
function bundleOf(change: { grantChange?: "modified" } = {}): GraphWorkflowBundle {
  return {
    files: [
      { file: "graph", kind: "graphs", id: "release-review", path: ".praxis/graphs/release-review.json", digest: `sha256:${"1".repeat(64)}` },
      { file: "binding", kind: "graph-bindings", id: "release-review.binding", path: ".praxis/graph-bindings/release-review.binding.json", digest: `sha256:${"2".repeat(64)}` },
      { file: "contract", kind: "contracts", id: "release", path: ".praxis/contracts/release.json", digest: `sha256:${"3".repeat(64)}` },
      { file: "grants/0", kind: "grants", id: "grant-one", path: ".praxis/grants/grant-one.json", digest: `sha256:${"4".repeat(64)}`, change: change.grantChange },
      { file: "grants/1", kind: "grants", id: "a-grant-sorted-first", path: ".praxis/grants/a-grant-sorted-first.json", digest: `sha256:${"5".repeat(64)}` },
    ],
    bundleDigest: RECORDED_DIGEST,
  };
}

interface Sent {
  command: string;
  args: Record<string, unknown>;
}

/** What the fake backend answers; a test may change it between calls. */
interface Scenario {
  show: CallOutcome;
  check: CallOutcome;
  submit: CallOutcome;
  /** A string is the backend's refusal, for a bundle praxis wouldn't take. */
  bundle: GraphWorkflowBundle | string;
  local: GraphWorkflowCheck;
}

function fakeBackend(initial: Partial<Scenario> = {}) {
  const sent: Sent[] = [];
  const state: Scenario = { show: NOT_SUBMITTED, check: CHECK_PASSES, submit: SUBMITTED, bundle: bundleOf(), local: passing, ...initial };
  fakeInvoke(async (command, args) => {
    sent.push({ command, args });
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_graph_workflow":
        return state.local;
      case "praxis_graph_workflow_triggers":
        return { ids: [], unchecked: [] };
      case "praxis_graph_workflow_bundle":
        if (typeof state.bundle === "string") throw state.bundle;
        return state.bundle;
      case "praxis_host_graphs_list":
        return recordOf("graphs list");
      case "praxis_host_graph_show":
        return state.show;
      case "praxis_host_graph_check":
        return state.check;
      case "praxis_host_graph_submit":
        return state.submit;
      case "praxis_host_cancel":
      case "plugin:opener|open_url":
        return null;
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  const of = (command: string) => sent.filter((s) => s.command === command);
  return {
    state,
    checks: () => of("praxis_host_graph_check"),
    submits: () => of("praxis_host_graph_submit"),
    shows: () => of("praxis_host_graph_show"),
    opened: () => of("plugin:opener|open_url").map((s) => s.args.url),
  };
}

// Each test has its own project, so nothing one test leaves in flight reaches another.
let projectN = 0;
let project = "";
let mounted: { root: Root; container: HTMLElement } | null = null;
let graphs: GraphHost | null = null;

beforeEach(() => {
  projectN += 1;
  project = `C:/project-${projectN}`;
});
/** Unmounts the form and disposes its graph host model. */
function unmount() {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  graphs?.dispose();
  graphs = null;
}
afterEach(unmount);

interface FormOptions {
  condition?: HostCondition;
  /** The records whose drafts have edits their saved files lack, as `kind/id`. */
  unsaved?: string[];
  nameProblem?: string;
}

const refKey = (ref: DefinitionRef) => `${ref.kind}/${ref.id}`;

/**
 * Renders the graph workflow form of `release-review` over a real graph host model that has
 * read the host once, as the builder's Graph workflows group does when it is shown.
 */
async function renderForm(opts: FormOptions = {}): Promise<{ root: HTMLElement; opened: DefinitionRef[] }> {
  const condition = opts.condition ?? { state: "simulatedHost" };
  const unsaved = new Set(opts.unsaved ?? []);
  const opened: DefinitionRef[] = [];
  const model = createGraphHost({ projectPath: project });
  graphs = model;
  model.setLocal([{ name: NAME, bundleDigest: RECORDED_DIGEST, nameProblem: opts.nameProblem ?? null }]);
  model.setCondition(condition);
  const made = createDraft(
    { kind: "graph-workflows", id: NAME },
    {
      id: NAME,
      kind: "graph-workflows",
      missing: false,
      content: { version: 1, contractId: "release", graphId: "release-review", graphBindingId: "release-review.binding" },
      contentHash: "h",
    },
  );
  assert.ok(made.ok);
  const form = () =>
    createElement(GraphWorkflowForm, {
      projectPath: project,
      draft: made.value,
      contracts: ["release"],
      graphs: ["release-review"],
      graphBindings: [{ id: "release-review.binding", graphId: "release-review" }],
      refresh: 0,
      host: {
        view: model.workflow(NAME),
        condition,
        onCheckAgain: () => void model.checkAgain(NAME),
        onWithdraw: (revision: number) => model.withdraw(NAME, revision),
      },
      submit: {
        unsaved: (ref: DefinitionRef) => unsaved.has(refKey(ref)),
        reread: async () => {
          await model.checkAgain(NAME);
          return model.workflow(NAME);
        },
      },
      onEdit: () => {},
      onOpen: (ref: DefinitionRef) => opened.push(ref),
      onValidated: () => {},
    });
  model.subscribe(() => mounted?.root.render(form()));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(form()));
  await act(async () => model.groupShown());
  return { root: container, opened };
}

const text = (el: Element | null | undefined) => el?.textContent ?? "";
const button = (root: Element, name: RegExp) =>
  [...root.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? text(b).trim())) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => {
  assert.ok(el, "the control is drawn");
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const flush = () => act(async () => {});
const dialog = (root: HTMLElement) => root.querySelector('[role="dialog"]') as HTMLElement | null;
const submitButton = (root: HTMLElement) => button(root, /^Submit…$/);
/** The reason Submit is disabled, as its description gives it. */
function submitReason(root: HTMLElement): string {
  const submit = submitButton(root);
  assert.ok(submit, "Submit is drawn");
  const id = submit.getAttribute("aria-describedby");
  return id ? text(root.querySelector(`[id="${id}"]`)) : "";
}

test("Submit is disabled, with the reason shown, while a bundle file has unsaved edits", async () => {
  const backend = fakeBackend();
  const { root } = await renderForm({ unsaved: ["grants/grant-one", "graphs/release-review"] });
  await flush();
  const submit = submitButton(root);
  assert.equal(submit?.getAttribute("aria-disabled"), "true");
  assert.match(submitReason(root), /Unsaved edits: graph release-review, grant grant-one\. Only saved files are submitted, so save them first\./);
  await click(submit);
  assert.equal(dialog(root), null, "a disabled Submit opens nothing");
  assert.equal(backend.checks().length, 0, "and runs no check");
});

test("Submit is disabled, with the reason shown, while a bundle file fails its local checks", async () => {
  fakeBackend({
    local: {
      grants: passing.grants,
      diagnostics: [{ code: "INVALID_REFERENCE", severity: "error", message: "Grant grant-one isn't valid: The limit must be a string.", path: "/contractId" }],
    },
  });
  const { root } = await renderForm();
  await flush();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "true");
  assert.match(submitReason(root), /The graph workflow fails its local checks\. Fix them first: only a bundle that passes them is submitted\./);
});

test("Submit is disabled, with praxis's reason, when the saved bundle is one praxis would refuse", async () => {
  fakeBackend({ bundle: "Contract release's bindings file lists no grants, and a graph workflow carries at least one." });
  const { root } = await renderForm();
  await flush();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "true");
  assert.match(submitReason(root), /Contract release's bindings file lists no grants, and a graph workflow carries at least one\./);
});

test("Submit is disabled, with the host's rule shown, when the name breaks it", async () => {
  const rule = "A graph workflow name is a lower-case letter, then up to 62 lower-case letters, digits or hyphens.";
  fakeBackend();
  const { root } = await renderForm({ nameProblem: rule });
  await flush();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "true");
  assert.ok(submitReason(root).includes(`${rule} Rename it from the list.`), submitReason(root));
});

test("Submit is disabled, with the reason shown, unless the host is signed in or simulated", async () => {
  const conditions: [HostCondition, RegExp][] = [
    [{ state: "notSignedIn" }, /Submit needs a host that is signed in or simulated, and this one is: Not signed in\./],
    [{ state: "hostUnreachable" }, /Submit needs a host that is signed in or simulated, and this one is: Host down\./],
    [{ state: "notCheckedYet" }, /Submit needs a host that is signed in or simulated, and this one is: Host not checked yet\./],
  ];
  for (const [condition, reason] of conditions) {
    fakeBackend();
    const { root } = await renderForm({ condition });
    await flush();
    assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "true", condition.state);
    assert.match(submitReason(root), reason, condition.state);
    unmount();
  }
  for (const condition of [{ state: "signedIn" }, { state: "simulatedHost" }] as HostCondition[]) {
    fakeBackend();
    const { root } = await renderForm({ condition });
    await flush();
    assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false", condition.state);
    assert.equal(submitButton(root)?.getAttribute("aria-describedby"), null, condition.state);
    unmount();
  }
});

test("uncommitted changes to a bundle file warn but don't disable Submit", async () => {
  fakeBackend({ bundle: bundleOf({ grantChange: "modified" }) });
  const { root } = await renderForm();
  await flush();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false");
  assert.match(text(root), /Warning: Changes not committed: grant grant-one\. They are submitted as saved\./);
});

test("a git status Quay couldn't read warns but doesn't disable Submit", async () => {
  fakeBackend({ bundle: { ...bundleOf(), changesError: "git isn't installed." } });
  const { root } = await renderForm();
  await flush();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false");
  assert.match(text(root), /Warning: Quay couldn't read git status, so it can't tell whether the bundle has changes that aren't committed: git isn't installed\./);
});

/** The recorded faults, with a fault in the second grant and one in a file Quay doesn't know added. */
function faultsWithGrant(): CallOutcome {
  const record = stdout("graphs check: faults, exit 9");
  const findings = record.findings as Record<string, unknown>[];
  record.findings = [...findings, { file: "grants/1", path: "/expiresAt", code: "TIME_PASSED" }, { file: "manifest", path: "", code: "SOMETHING_NEW", nodeId: "build" }];
  return { kind: "bundleInvalid", record };
}

test("Check on host runs the check verb only, and lists each finding against the file it names, with a link that opens it", async () => {
  const backend = fakeBackend({ check: faultsWithGrant() });
  const { root, opened } = await renderForm();
  await flush();
  await click(button(root, /^Check on host$/));
  assert.equal(backend.checks().length, 1);
  assert.deepEqual(
    { projectPath: backend.checks()[0].args.projectPath, name: backend.checks()[0].args.name },
    { projectPath: project, name: NAME },
  );
  assert.equal(backend.submits().length, 0, "a check writes nothing");
  const findings = root.querySelector('[aria-label="Host findings"]');
  assert.ok(findings, "the findings are listed");
  assert.match(text(findings), /The host found faults in the saved bundle\./);
  const items = [...findings.querySelectorAll("li")].map((li) => text(li));
  assert.deepEqual(items, [
    "contract release: TIME_PASSED at /deadline",
    "grant a-grant-sorted-first: TIME_PASSED at /expiresAt",
    "manifest: SOMETHING_NEW on node build",
  ]);
  // Each finding in a known file links to it; the grant's index is its place in the bindings file's list.
  const links = [...findings.querySelectorAll("a")];
  assert.deepEqual(links.map((a) => text(a)), ["contract release", "grant a-grant-sorted-first"]);
  await click(links[1]);
  assert.deepEqual(opened, [{ kind: "grants", id: "a-grant-sorted-first" }]);
});

test("a check that passes says the host found no faults", async () => {
  fakeBackend();
  const { root } = await renderForm();
  await flush();
  await click(button(root, /^Check on host$/));
  assert.match(text(root.querySelector('[aria-label="Host findings"]')), /The host found no faults in the saved bundle\./);
});

test("Submit runs the check first, and a failing check stops it with the host's findings", async () => {
  const backend = fakeBackend({ check: CHECK_FAULTS });
  const { root } = await renderForm();
  await flush();
  await click(submitButton(root));
  assert.equal(backend.checks().length, 1, "the check ran");
  assert.equal(dialog(root), null, "no confirm");
  assert.equal(backend.submits().length, 0, "nothing was submitted");
  assert.match(text(root.querySelector('[aria-label="Host findings"]')), /The host found faults in the saved bundle\.contract release: TIME_PASSED at \/deadline/);
});

test("Submit goes on to the confirm only once the check passes", async () => {
  const backend = fakeBackend();
  const { root } = await renderForm();
  await flush();
  await click(submitButton(root));
  assert.equal(backend.checks().length, 1, "the check ran first");
  assert.ok(dialog(root), "the confirm opens");
  assert.equal(backend.submits().length, 0, "nothing is submitted before the confirm");
});

test("a bundle identical to a pending candidate or the current revision is refused: nothing has changed since it", async () => {
  // The recorded host holds candidates 2 and 1, both with the recorded bundle's digest.
  for (const [show, revision] of [[TWO_CANDIDATES, 2], [admittedOne(RECORDED_DIGEST), 1]] as const) {
    const backend = fakeBackend({ show });
    const { root } = await renderForm();
    await flush();
    const showsBefore = backend.shows().length;
    await click(submitButton(root));
    assert.ok(backend.shows().length > showsBefore, "the host state is reread before comparing");
    assert.equal(dialog(root), null, `revision ${revision}: no confirm`);
    assert.equal(backend.submits().length, 0);
    assert.ok(text(root.querySelector('[role="alert"]')).includes(`Nothing has changed since revision ${revision}.`), `revision ${revision}: the refusal names it`);
    unmount();
  }
});

test("a bundle that differs from every revision, or one the host gives no digest for, goes on to the confirm", async () => {
  const noDigest = structuredClone(CHECK_PASSES) as Extract<CallOutcome, { kind: "record" }>;
  delete noDigest.record.bundleDigest;
  for (const [show, check] of [[admittedOne(OTHER_DIGEST), CHECK_PASSES], [TWO_CANDIDATES, noDigest]] as const) {
    fakeBackend({ show, check });
    const { root } = await renderForm();
    await flush();
    await click(submitButton(root));
    assert.ok(dialog(root), "the confirm opens");
    unmount();
  }
});

test("the confirm lists each bundle file with its digest and uncommitted badge, and says the submission becomes a candidate the owner admits", async () => {
  fakeBackend({ bundle: bundleOf({ grantChange: "modified" }) });
  const { root } = await renderForm();
  await flush();
  await click(submitButton(root));
  const confirm = dialog(root);
  assert.ok(confirm);
  assert.equal(confirm.getAttribute("aria-modal"), "true");
  const rows = [...confirm.querySelectorAll('[aria-label="Bundle files"] li')].map((li) => text(li));
  assert.deepEqual(rows, [
    `.praxis/graphs/release-review.jsonsha256:${"1".repeat(64)}`,
    `.praxis/graph-bindings/release-review.binding.jsonsha256:${"2".repeat(64)}`,
    `.praxis/contracts/release.jsonsha256:${"3".repeat(64)}`,
    `.praxis/grants/grant-one.jsonUncommittedsha256:${"4".repeat(64)}`,
    `.praxis/grants/a-grant-sorted-first.jsonsha256:${"5".repeat(64)}`,
  ]);
  assert.match(text(confirm), /The submission becomes a candidate\. Nothing runs until the owner admits it in the browser\./);
  assert.ok(button(confirm, /^Submit$/), "the confirm's Submit");
});

/** Revision 1 current with another bundle, and revision 2, this one, pending: the host after a second submission. */
function candidateOverOne(): CallOutcome {
  const record = stdout("graphs show");
  const revisions = record.revisions as Record<string, unknown>[];
  record.revisions = [revisions[0], { ...revisions[1], status: "CURRENT", bundleDigest: OTHER_DIGEST }];
  Object.assign(record, { currentRevision: 1, runnable: true, pendingCount: 1, admissionPageAddress: SECOND_PAGE });
  return { kind: "record", record };
}
/** The admission page of the recorded second candidate. */
const SECOND_PAGE = String(stdout("graphs submit: a second candidate").admissionPageAddress);

test("a confirmed submission is sent on the current revision, offers the admission page, and rereads the host state", async () => {
  const backend = fakeBackend({ show: admittedOne(OTHER_DIGEST), submit: recordOf("graphs submit: a second candidate") });
  const { root } = await renderForm();
  await flush();
  await click(submitButton(root));
  const confirm = dialog(root) as HTMLElement;
  assert.equal(backend.submits().length, 0);
  backend.state.show = candidateOverOne();
  const showsBefore = backend.shows().length;
  await click(button(confirm, /^Submit$/));
  assert.equal(backend.submits().length, 1);
  const sent = backend.submits()[0].args;
  assert.deepEqual({ projectPath: sent.projectPath, name: sent.name, baseRevision: sent.baseRevision }, { projectPath: project, name: NAME, baseRevision: 1 });
  assert.match(text(dialog(root)), /Submitted revision 2 as a candidate\. The owner admits or rejects it in the browser\./);
  // The record's host state is reread after the submission.
  assert.equal(backend.shows().length, showsBefore + 1);
  assert.match(text(root.querySelector('[role="status"]')), /Candidate waiting for admission \(revision 2\)/);
  await click(button(dialog(root) as HTMLElement, /^Open in browser$/));
  assert.deepEqual(backend.opened(), [SECOND_PAGE]);
});

test("faults the host finds at submission close the confirm and list with the check's, and nothing is stored", async () => {
  const backend = fakeBackend({ submit: { kind: "bundleInvalid", record: stdout("graphs submit: faults, exit 9") } });
  const { root } = await renderForm();
  await flush();
  await click(submitButton(root));
  await click(button(dialog(root) as HTMLElement, /^Submit$/));
  assert.equal(backend.submits().length, 1);
  assert.equal(dialog(root), null);
  assert.match(text(root.querySelector('[aria-label="Host findings"]')), /contract release: TIME_PASSED at \/deadline/);
});

test("a submission whose outcome is unknown says so, and Submit again resends it by its request id", async () => {
  const requestId = "b4814fe6-1f83-4c80-b8a7-f495d87d0f72";
  const backend = fakeBackend({ submit: { kind: "unknown", detail: "The host didn't confirm the submission.", requestId } });
  const { root } = await renderForm();
  await flush();
  await click(submitButton(root));
  await click(button(dialog(root) as HTMLElement, /^Submit$/));
  const confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm.querySelector('[role="alert"]')), /Quay can't tell whether the host stored the candidate: The host didn't confirm the submission\. Submit again resends the same submission/);
  assert.equal(backend.submits()[0].args.requestId, null, "the first send lets praxis make the request id");
  backend.state.submit = SUBMITTED;
  await click(button(confirm, /^Submit again$/));
  assert.equal(backend.submits().length, 2);
  assert.equal(backend.submits()[1].args.requestId, requestId);
  assert.match(text(dialog(root)), /Submitted revision 1 as a candidate/);
  await click(button(dialog(root) as HTMLElement, /^Open in browser$/));
  assert.deepEqual(backend.opened(), [ADMISSION_PAGE]);
});
