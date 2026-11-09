/// <reference types="node" />
// Component tests for Check on host and Submit on the trigger form (#469, #476): each gate that
// disables Submit, the target's admission warning, a check that finds faults, and a submission.
// They render the real form over the real trigger host model into happy-dom and fake only Tauri's
// `invoke`, the out-of-process boundary, answering it with the outcomes the Praxis CLI runner
// gives for the fake praxis's replays (trigger_outputs.fixture.json and graph_outputs.fixture.json,
// which the real `praxis` printed against the SDK's simulated host).
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft, editTriggerDraft, type Draft } from "./drafts.ts";
import { recordedStdout } from "./fixtures/graphOutputs.ts";
import { recordedTrigger, triggerNotFound, triggerShow } from "./fixtures/triggerOutputs.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import { createTriggerHost, type TriggerHost } from "./triggerHost.ts";
import type { BundleChanges, Diagnostic, TriggerTargetCheck, Validation } from "./types.ts";

const { TriggerForm } = await import("./TriggerForm.tsx");

const NAME = "nightly";
const TARGET = "release-review";
const ADMISSION_PAGE = "https://praxis-rqse44l43d.localhost:51120/#graph-trigger=nightly&revision=1";

/** The runner's outcome for each recorded case. */
const triggerRecord = (name: string): CallOutcome => ({ kind: "record", record: recordedTrigger(name) });
const CHECK_PASSES = triggerRecord("triggers check: valid");
const CHECK_FAULTS: CallOutcome = { kind: "triggerInvalid", record: recordedTrigger("triggers check: faults, exit 9") };
const SUBMITTED = triggerRecord("triggers submit: a candidate");
/** The recorded `graphs show` of the target: two pending candidates and no admitted revision. */
const TARGET_NOT_ADMITTED: CallOutcome = { kind: "record", record: recordedStdout("graphs show") };
/** The target with revision 1 admitted. */
function targetAdmitted(): CallOutcome {
  const record = recordedStdout("graphs show");
  const revisions = record.revisions as Record<string, unknown>[];
  record.revisions = [{ ...revisions[1], status: "CURRENT" }];
  Object.assign(record, { currentRevision: 1, runnable: true, latestRevision: 1, pendingCount: 0, admissionPageAddress: null });
  return { kind: "record", record };
}
function targetNotFound(): CallOutcome {
  const record = recordedStdout("graphs show: not submitted");
  return { kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record };
}
/** The host's list with no triggers on it. */
const EMPTY_LIST: CallOutcome = { kind: "record", record: { ...recordedTrigger("triggers list"), triggers: [] } };

const accepted: Validation = { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
const NO_CHECK: TriggerTargetCheck = { refused: [], diagnostics: [], contractId: "release" };

interface Sent {
  command: string;
  args: Record<string, unknown>;
}

/** What the fake backend answers; a test may change it between calls. */
interface Scenario {
  local: TriggerTargetCheck;
  /** A string is the backend's refusal to read git status. */
  changes: BundleChanges | string;
  list: CallOutcome;
  show: CallOutcome;
  target: CallOutcome;
  check: CallOutcome;
  submit: CallOutcome;
}

function fakeBackend(initial: Partial<Scenario> = {}) {
  const sent: Sent[] = [];
  const state: Scenario = {
    local: NO_CHECK,
    changes: { files: [] },
    list: EMPTY_LIST,
    show: triggerNotFound(),
    target: targetAdmitted(),
    check: CHECK_PASSES,
    submit: SUBMITTED,
    ...initial,
  };
  fakeInvoke(async (command, args) => {
    sent.push({ command, args });
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_trigger":
        return state.local;
      case "praxis_trigger_changes":
        if (typeof state.changes === "string") throw state.changes;
        return state.changes;
      case "praxis_trigger_digest":
        return null;
      case "praxis_host_triggers_list":
        return state.list;
      case "praxis_host_trigger_show":
        return state.show;
      case "praxis_host_graph_show":
        return state.target;
      case "praxis_host_trigger_check":
        return state.check;
      case "praxis_host_trigger_submit":
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
    sent: () => sent,
    /** Every host call, in order, by command. */
    hostCalls: () => sent.filter((s) => s.command.startsWith("praxis_host_") && s.command !== "praxis_host_cancel").map((s) => s.command),
    checks: () => of("praxis_host_trigger_check"),
    submits: () => of("praxis_host_trigger_submit"),
    shows: () => of("praxis_host_trigger_show"),
    targetShows: () => of("praxis_host_graph_show"),
    opened: () => of("plugin:opener|open_url").map((s) => s.args.url),
  };
}

// Each test has its own project, so nothing one test leaves in flight reaches another.
let projectN = 0;
let project = "";
let mounted: { root: Root; container: HTMLElement } | null = null;
let triggers: TriggerHost | null = null;

beforeEach(() => {
  projectN += 1;
  project = `C:/project-${projectN}`;
});
/** Unmounts the form and disposes its trigger host model. */
function unmount() {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  triggers?.dispose();
  triggers = null;
}
afterEach(unmount);

/** A SCHEDULED trigger of contract `release`, as the recorder submits it. */
const TRIGGER = {
  id: NAME,
  revision: "1",
  kind: "SCHEDULED",
  source: "praxis",
  eventType: "schedule.tick",
  contractId: "release",
  action: "START_RUN",
  enabled: true,
  maxDepth: "0",
  schedule: { startMs: "0", intervalMs: "60000", catchUp: "ALL", maxCatchUp: "3" },
};

interface FormOptions {
  condition?: HostCondition;
  /** The saved Starts target; null for none. */
  target?: string | null;
  /** The trigger's saved file over `TRIGGER`. */
  content?: Record<string, unknown>;
  /** The trigger's id, when not `nightly`. */
  name?: string;
  /** An edit the draft has that its saved files lack. */
  edit?: Parameters<typeof editTriggerDraft>[1];
}

/**
 * Renders the trigger form of `nightly` over a real trigger host model that has read the host
 * once, as the builder's Triggers group does when it is shown, with the builder's Submit support.
 */
async function renderForm(opts: FormOptions = {}): Promise<HTMLElement> {
  const condition = opts.condition ?? { state: "simulatedHost" };
  const name = opts.name ?? NAME;
  const target = opts.target === undefined ? TARGET : opts.target;
  const content = { ...TRIGGER, id: name, ...opts.content };
  const model = createTriggerHost({ projectPath: project });
  triggers = model;
  if (target !== null) model.setLocal([{ name, target, enabled: content.enabled === true ? true : content.enabled === false ? false : null, nameProblem: null }]);
  model.setCondition(condition);
  const made = createDraft(
    { kind: "triggers", id: name },
    {
      id: name,
      kind: "triggers",
      missing: false,
      content,
      contentHash: "h",
      ...(target !== null ? { target: { version: 1, graphWorkflow: target }, targetHash: "th" } : {}),
    },
  );
  assert.ok(made.ok);
  const draft: Draft = opts.edit ? editTriggerDraft(made.value, opts.edit) : made.value;
  const form = () =>
    createElement(TriggerForm, {
      projectPath: project,
      draft,
      contracts: ["release"],
      graphWorkflows: [{ id: TARGET, contractId: "release" }],
      refresh: 0,
      crossRecord: null,
      host: model.has(name) ? { view: model.trigger(name), condition, onCheckAgain: () => void model.checkAgain(name) } : null,
      submit: {
        condition,
        reread: async () => {
          if (!model.has(name)) return null;
          await model.checkAgain(name);
          return model.trigger(name);
        },
      },
      onEdit: () => {},
      onOpen: () => {},
      onValidated: () => {},
    });
  model.subscribe(() => mounted?.root.render(form()));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(form()));
  await act(async () => model.groupShown());
  await flush();
  return container;
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
/** Asserts Submit is disabled with `reason` among its reasons, and that clicking it calls nothing on the host. */
async function assertWithheld(root: HTMLElement, backend: ReturnType<typeof fakeBackend>, reason: string) {
  const submit = submitButton(root);
  assert.equal(submit?.getAttribute("aria-disabled"), "true");
  assert.ok(submitReason(root).includes(reason), submitReason(root));
  const before = backend.hostCalls().length;
  await click(submit);
  assert.equal(dialog(root), null, "a disabled Submit opens nothing");
  assert.deepEqual(backend.hostCalls().slice(before), [], "and calls nothing on the host");
}

test("Submit is disabled, with the reason shown, while the trigger has no Starts target", async () => {
  const backend = fakeBackend();
  const root = await renderForm({ target: null });
  await assertWithheld(root, backend, "The trigger has no Starts target, so it stays a local record. Pick the graph workflow it starts first.");
});

test("Submit is disabled, with the reason shown, while the trigger or its Starts target has unsaved edits", async () => {
  const edits: Parameters<typeof editTriggerDraft>[1][] = [
    { type: "set-field", key: "eventType", value: "schedule.tock" },
    { type: "set-target", target: "another-workflow" },
  ];
  for (const edit of edits) {
    const backend = fakeBackend();
    const root = await renderForm({ edit });
    await assertWithheld(root, backend, "Unsaved edits: trigger nightly. Only saved files are submitted, so save them first.");
    unmount();
  }
});

test("Submit is disabled, with the reason shown, while the trigger fails its local checks, the graph trigger rules included", async () => {
  const rule: Diagnostic = {
    code: "TRIGGER_DEPTH_UNSUPPORTED",
    severity: "error",
    message: "A graph trigger accepts only events no run caused, so Max depth must be 0.",
    path: "/maxDepth",
  };
  const backend = fakeBackend({ local: { ...NO_CHECK, diagnostics: [rule] } });
  const root = await renderForm({ content: { maxDepth: "2" } });
  await assertWithheld(root, backend, "The trigger fails its local checks. Fix them first: only a trigger that passes them is submitted.");
});

test("Submit is disabled, with the host's rule shown, when the trigger's name breaks it", async () => {
  // `check` is the one name the rule's pattern takes that `praxis triggers` keeps for its own verb.
  const backend = fakeBackend();
  const root = await renderForm({ name: "check" });
  await assertWithheld(
    root,
    backend,
    "A graph trigger name is a lowercase letter, then at most 62 lowercase letters, digits and hyphens, and isn't check or a Windows device name such as con, nul, com1 or lpt1. The Praxis host refuses any other name. Rename it from the list.",
  );
});

test("Submit is disabled, with the reason shown, unless the host is signed in or simulated", async () => {
  const conditions: [HostCondition, string][] = [
    [{ state: "notSignedIn" }, "Submit needs a host that is signed in or simulated, and this one is: Not signed in."],
    [{ state: "hostUnreachable" }, "Submit needs a host that is signed in or simulated, and this one is: Host down."],
    [{ state: "notCheckedYet" }, "Submit needs a host that is signed in or simulated, and this one is: Host not checked yet."],
  ];
  for (const [condition, reason] of conditions) {
    const backend = fakeBackend();
    const root = await renderForm({ condition });
    await assertWithheld(root, backend, reason);
    unmount();
  }
  for (const condition of [{ state: "signedIn" }, { state: "simulatedHost" }] as HostCondition[]) {
    fakeBackend();
    const root = await renderForm({ condition });
    assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false", condition.state);
    assert.equal(submitButton(root)?.getAttribute("aria-describedby"), null, condition.state);
    unmount();
  }
});

test("Submit is disabled, with the reason shown, when the target graph workflow isn't on the host", async () => {
  const backend = fakeBackend({ target: targetNotFound() });
  const root = await renderForm();
  assert.deepEqual(
    backend.targetShows().map((s) => ({ projectPath: s.args.projectPath, name: s.args.name })),
    [{ projectPath: project, name: TARGET }],
    "the target is read on the host",
  );
  await assertWithheld(root, backend, "Graph workflow release-review, which the trigger starts, isn't on the host. Submit it from its form first.");
});

const NOT_ADMITTED_WARNING =
  "Graph workflow release-review has no admitted revision on the host, so the host refuses the trigger's fires until the owner admits one.";

test("a target with no admitted revision warns that fires will be refused until it has one, but doesn't disable Submit", async () => {
  fakeBackend({ target: TARGET_NOT_ADMITTED });
  const root = await renderForm();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false");
  assert.ok(text(root).includes(`Warning: ${NOT_ADMITTED_WARNING}`), text(root));
});

test("an admitted target gives no warning", async () => {
  fakeBackend();
  const root = await renderForm();
  assert.ok(!text(root).includes("Warning: "), text(root));
});

test("uncommitted changes to the trigger or its target file warn but don't disable Submit", async () => {
  const backend = fakeBackend({
    changes: {
      files: [
        { path: ".praxis/trigger-targets/nightly.json", status: "modified" },
        { path: ".praxis/triggers/nightly.json", status: "added" },
      ],
    },
  });
  const root = await renderForm();
  assert.deepEqual(
    backend.sent().filter((s) => s.command === "praxis_trigger_changes").map((s) => ({ projectPath: s.args.projectPath, name: s.args.name })),
    [{ projectPath: project, name: NAME }],
  );
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false");
  assert.ok(
    text(root).includes("Warning: Changes not committed: .praxis/trigger-targets/nightly.json, .praxis/triggers/nightly.json. They are submitted as saved."),
    text(root),
  );
});

test("a git status Quay couldn't read warns but doesn't disable Submit", async () => {
  fakeBackend({ changes: "git isn't installed." });
  const root = await renderForm();
  assert.equal(submitButton(root)?.getAttribute("aria-disabled"), "false");
  assert.ok(
    text(root).includes("Warning: Quay couldn't read git status, so it can't tell whether the trigger has changes that aren't committed: git isn't installed."),
    text(root),
  );
});

test("Check on host runs the host's trigger check only, writing nothing, and lists its findings", async () => {
  const backend = fakeBackend({ check: CHECK_FAULTS });
  const root = await renderForm();
  const before = backend.hostCalls().length;
  await click(button(root, /^Check on host$/));
  assert.deepEqual(backend.hostCalls().slice(before), ["praxis_host_trigger_check"], "the check is the one host call, and it writes nothing");
  assert.deepEqual(
    { projectPath: backend.checks()[0].args.projectPath, name: backend.checks()[0].args.name },
    { projectPath: project, name: NAME },
  );
  const findings = root.querySelector('[aria-label="Host findings"]');
  assert.ok(findings, "the findings are listed");
  assert.match(text(findings), /^The host found faults in the saved trigger\./);
  assert.deepEqual([...findings.querySelectorAll("li")].map((li) => text(li)), ["EVENT_SOURCE_NOT_ADMITTED at /source"]);
});

test("a check that passes says the host found no faults, and one that can't answer says why", async () => {
  const backend = fakeBackend();
  const root = await renderForm();
  await click(button(root, /^Check on host$/));
  assert.equal(text(root.querySelector('[aria-label="Host findings"]')), "The host found no faults in the saved trigger.");
  const notFound = recordedTrigger("triggers check: target not on host");
  backend.state.check = { kind: "hostRefused", message: String(notFound.message), hostCode: String(notFound.hostCode), record: notFound };
  await click(button(root, /^Check on host$/));
  assert.equal(text(root.querySelector('[aria-label="Host findings"]')), "The host's check didn't finish: The host refused the request (NOT_FOUND).");
});

test("Submit reads the target on the host first, then runs the check, and a failing check stops it with the host's findings", async () => {
  const backend = fakeBackend({ check: CHECK_FAULTS });
  const root = await renderForm();
  const before = backend.hostCalls().length;
  await click(submitButton(root));
  assert.deepEqual(backend.hostCalls().slice(before), ["praxis_host_graph_show", "praxis_host_trigger_check"]);
  assert.equal(backend.targetShows()[backend.targetShows().length - 1]?.args.name, TARGET);
  assert.equal(dialog(root), null, "no confirm");
  assert.equal(backend.submits().length, 0, "nothing was submitted");
  assert.match(text(root.querySelector('[aria-label="Host findings"]')), /The host found faults in the saved trigger\.EVENT_SOURCE_NOT_ADMITTED at \/source/);
});

test("Submit stops before the check when the target has gone from the host since the bar read it", async () => {
  const backend = fakeBackend();
  const root = await renderForm();
  backend.state.target = targetNotFound();
  const before = backend.hostCalls().length;
  await click(submitButton(root));
  assert.deepEqual(backend.hostCalls().slice(before), ["praxis_host_graph_show"]);
  assert.equal(dialog(root), null);
  assert.ok(submitReason(root).includes("Graph workflow release-review, which the trigger starts, isn't on the host."), submitReason(root));
});

test("the confirm says the trigger becomes a candidate the owner admits in the browser, and that it will start enabled", async () => {
  const backend = fakeBackend({ changes: { files: [{ path: ".praxis/triggers/nightly.json", status: "modified" }] } });
  const root = await renderForm();
  await click(submitButton(root));
  const confirm = dialog(root);
  assert.ok(confirm, "the confirm opens once the check passes");
  assert.equal(confirm.getAttribute("aria-modal"), "true");
  assert.equal(backend.submits().length, 0, "nothing is submitted before the confirm");
  assert.ok(text(confirm).includes("The trigger becomes a candidate. It doesn't fire until the owner admits it in the browser."), text(confirm));
  assert.ok(text(confirm).includes("Once admitted it starts enabled, so it fires from then on."), text(confirm));
  const rows = [...confirm.querySelectorAll('[aria-label="Trigger files"] li')].map((li) => text(li));
  assert.deepEqual(rows, [".praxis/triggers/nightly.jsonUncommitted", ".praxis/trigger-targets/nightly.json"]);
  assert.ok(text(confirm).includes("It starts graph workflow release-review."), text(confirm));
  assert.ok(button(confirm, /^Submit$/), "the confirm's Submit");
});

test("the confirm says a disabled trigger will start disabled, and repeats that fires are refused until the target is admitted", async () => {
  fakeBackend({ target: TARGET_NOT_ADMITTED });
  const root = await renderForm({ content: { enabled: false } });
  await click(submitButton(root));
  const confirm = dialog(root);
  assert.ok(confirm);
  assert.ok(text(confirm).includes("Once admitted it starts disabled: it doesn't fire until the owner enables it in the browser."), text(confirm));
  assert.ok(text(confirm).includes(NOT_ADMITTED_WARNING), text(confirm));
});

/** The recorded host's list, which holds `nightly`. */
const LISTS_NIGHTLY = triggerRecord("triggers list");

test("a confirmed submission is sent on the host's current revision, offers the admission page, and rereads the trigger's host state", async () => {
  const second = recordedTrigger("triggers submit: a second candidate");
  const secondPage = String(second.admissionPageAddress);
  const backend = fakeBackend({
    list: LISTS_NIGHTLY,
    // Revision 1 admitted and enabled.
    show: triggerShow("triggers show: admitted and enabled", NAME),
    submit: { kind: "record", record: { ...second, name: NAME } },
  });
  const root = await renderForm();
  await click(submitButton(root));
  const confirm = dialog(root) as HTMLElement;
  assert.ok(confirm);
  // The host after the submission: revision 1 admitted, now disabled, and candidate 2 pending.
  backend.state.show = triggerShow("triggers show: admitted but disabled", NAME, { admissionPageAddress: secondPage });
  const showsBefore = backend.shows().length;
  await click(button(confirm, /^Submit$/));
  assert.equal(backend.submits().length, 1);
  const sent = backend.submits()[0].args;
  assert.deepEqual(
    { projectPath: sent.projectPath, name: sent.name, baseRevision: sent.baseRevision, requestId: sent.requestId },
    { projectPath: project, name: NAME, baseRevision: 1, requestId: null },
  );
  assert.match(text(dialog(root)), /Submitted revision 2 as a candidate\. The owner admits or rejects it in the browser\./);
  assert.equal(backend.shows().length, showsBefore + 1, "the trigger's host state is reread");
  assert.ok(
    [...root.querySelectorAll('[role="status"]')].some((s) => /^On the host: Candidate waiting for admission \(revision 2\)/.test(text(s))),
    "the status line shows the new candidate",
  );
  await click(button(dialog(root) as HTMLElement, /^Open in browser$/));
  assert.deepEqual(backend.opened(), [secondPage]);
});

test("a first submission of a trigger the host doesn't hold yet is sent with no base revision", async () => {
  const backend = fakeBackend();
  const root = await renderForm();
  await click(submitButton(root));
  await click(button(dialog(root) as HTMLElement, /^Submit$/));
  assert.equal(backend.submits()[0].args.baseRevision, null);
  assert.match(text(dialog(root)), /Submitted revision 1 as a candidate/);
  await click(button(dialog(root) as HTMLElement, /^Open in browser$/));
  assert.deepEqual(backend.opened(), [ADMISSION_PAGE]);
});

test("faults the host finds at submission close the confirm and list as the check's, and nothing is stored", async () => {
  const backend = fakeBackend({ submit: { kind: "triggerInvalid", record: recordedTrigger("triggers submit: faults, exit 9") } });
  const root = await renderForm();
  await click(submitButton(root));
  await click(button(dialog(root) as HTMLElement, /^Submit$/));
  assert.equal(backend.submits().length, 1);
  assert.equal(dialog(root), null);
  assert.match(text(root.querySelector('[aria-label="Host findings"]')), /TRIGGER_DEPTH_UNSUPPORTED at \/maxDepth/);
});

test("a submission whose outcome is unknown says so, and Submit again resends it by its request id", async () => {
  const requestId = "b4814fe6-1f83-4c80-b8a7-f495d87d0f72";
  const backend = fakeBackend({ submit: { kind: "unknown", detail: "The host didn't confirm the submission.", requestId } });
  const root = await renderForm();
  await click(submitButton(root));
  await click(button(dialog(root) as HTMLElement, /^Submit$/));
  const confirm = dialog(root) as HTMLElement;
  assert.match(text(confirm.querySelector('[role="alert"]')), /Quay can't tell whether the host stored the candidate: The host didn't confirm the submission\. Submit again resends/);
  backend.state.submit = SUBMITTED;
  await click(button(confirm, /^Submit again$/));
  assert.equal(backend.submits()[1].args.requestId, requestId);
  assert.match(text(dialog(root)), /Submitted revision 1 as a candidate/);
});
