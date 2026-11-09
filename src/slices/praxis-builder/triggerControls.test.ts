/// <reference types="node" />
// Component tests for the controls any session may use on a graph trigger (#469, #477): Withdraw a
// pending candidate, Disable an enabled trigger and Retire one, each behind its confirm, and Enable
// in browser for a disabled one. They render the real trigger form over the real trigger host
// model and trigger control model into happy-dom and fake only Tauri's `invoke`, the out-of-process
// boundary, answering the models' `praxis` calls with the records the real CLI printed
// (trigger_outputs.fixture.json, recorded against the SDK's simulated host).
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useEffect, useState, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import { ON_PUSH_DIGEST, recordedTrigger, triggerShow } from "./fixtures/triggerOutputs.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import { bindTriggerControl, createTriggerControl } from "./triggerControl.ts";
import { createTriggerHost, type TriggerHost } from "./triggerHost.ts";
import type { TriggerTargetCheck, Validation } from "./types.ts";

const { TriggerForm } = await import("./TriggerForm.tsx");

const SIGNED_IN: HostCondition = { state: "signedIn" };

type Revision = Record<string, unknown>;

/** A recorded refusal or unknown outcome, as the runner gives it. */
function refusal(name: string): CallOutcome {
  const record = recordedTrigger(name);
  if (record.code === "OUTCOME_UNKNOWN") return { kind: "unknown", detail: String(record.message), requestId: String(record.requestId) };
  return { kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record };
}

/** A recorded record, as the runner gives it. */
const recordOf = (name: string): CallOutcome => ({ kind: "record", record: recordedTrigger(name) });

/** The recorded `nightly`, PENDING with candidate revision 1, its revision 1 given `status`. */
function nightly(status = "CANDIDATE"): CallOutcome {
  const shown = triggerShow("triggers show: a candidate", "nightly");
  if (shown.kind !== "record") throw new Error("a record");
  const [first] = shown.record.revisions as Revision[];
  shown.record.revisions = [{ ...first, status }];
  if (status !== "CANDIDATE") Object.assign(shown.record, { pendingCount: 0, admissionPageAddress: null });
  return shown;
}

/** The recorded `on-push`, admitted and enabled at revision 1. */
const enabledOnPush = () => triggerShow("triggers show: admitted and enabled", "on-push");

/** The recorded disabled `on-push`, with only its admitted revision 1, so no candidate gives a page. */
function disabledOnPush(): CallOutcome {
  const shown = triggerShow("triggers show: admitted but disabled", "on-push");
  if (shown.kind !== "record") throw new Error("a record");
  const revisions = shown.record.revisions as Revision[];
  Object.assign(shown.record, { revisions: [revisions[1]], latestRevision: 1, pendingCount: 0, admissionPageAddress: null });
  return shown;
}

interface Call {
  command: string;
  args: Record<string, unknown>;
  answer(outcome: unknown): void;
  answered?: boolean;
}

const LABELS: Record<string, string> = {
  praxis_host_trigger_show: "show",
  praxis_host_trigger_withdraw: "withdraw",
  praxis_host_trigger_disable: "disable",
  praxis_host_trigger_retire: "retire",
  praxis_host_trigger_revision: "revision",
};

/** The models' `praxis` calls, each waiting until the test answers it. The saved files' digest is answered at once. */
function fakeHost() {
  const calls: Call[] = [];
  const invoker = (command: string, args: Record<string, unknown>) => {
    if (command === "praxis_host_cancel") return Promise.resolve(undefined);
    if (command === "praxis_trigger_digest") return Promise.resolve(ON_PUSH_DIGEST);
    return new Promise<unknown>((resolve) => calls.push({ command, args, answer: resolve }));
  };
  const label = (c: Call) => LABELS[c.command] ?? c.command;
  const pending = () => calls.filter((c) => !c.answered);
  return {
    invoker,
    calls,
    open: () => pending().map(label),
    async answer(what: string, outcome: unknown) {
      const call = pending().find((c) => label(c) === what);
      assert.ok(call, `no open ${what} call; open: ${pending().map(label).join(", ")}`);
      call.answered = true;
      await act(async () => {
        call.answer(outcome);
        await settle();
      });
      return call;
    },
  };
}

/** Lets settled calls' follow-ups run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const accepted: Validation = { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
const NO_CHECK: TriggerTargetCheck = { refused: [], diagnostics: [] };

let mounted: { root: Root; container: HTMLElement; triggers: TriggerHost } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container, triggers } = mounted;
    act(() => root.unmount());
    container.remove();
    triggers.dispose();
    mounted = null;
  }
});

type Draft = Parameters<typeof TriggerForm>[0]["draft"];

/** The form, drawn again on every change to the trigger host model, as the builder draws it. */
const Harness: FC<{ triggers: TriggerHost; control: ReturnType<typeof createTriggerControl>; name: string; draft: Draft }> = ({
  triggers,
  control,
  name,
  draft,
}) => {
  const [, setVersion] = useState(0);
  useEffect(() => triggers.subscribe(() => setVersion((v) => v + 1)), [triggers]);
  return createElement(TriggerForm, {
    projectPath: "C:/project",
    draft,
    contracts: ["release"],
    graphWorkflows: [{ id: "release-review", contractId: "release" }],
    refresh: 0,
    crossRecord: null,
    host: {
      view: triggers.trigger(name),
      condition: SIGNED_IN,
      onCheckAgain: () => void triggers.checkAgain(name),
      control: bindTriggerControl(control, name),
    },
    onEdit: () => {},
    onOpen: () => {},
    onValidated: () => {},
  });
};

/** The form for graph trigger `name`, whose first host read is `shown`; the URLs the opener was given. */
async function render(name: string, shown: CallOutcome) {
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
  const host = fakeHost();
  const triggers = createTriggerHost({ projectPath: "C:/project", call: host.invoker });
  const control = createTriggerControl({ projectPath: "C:/project", triggers, call: host.invoker });
  triggers.setLocal([{ name, target: "release-review", enabled: true, nameProblem: null }]);
  triggers.setCondition(SIGNED_IN);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container, triggers };
  const made = createDraft(
    { kind: "triggers", id: name },
    {
      id: name,
      kind: "triggers",
      missing: false,
      content: { id: name, revision: "1", kind: "EVENT", source: "github", eventType: "push", contractId: "release", action: "START_RUN", enabled: true, maxDepth: "0" },
      contentHash: "h",
      target: { version: 1, graphWorkflow: "release-review" },
      targetHash: "th",
    },
  );
  assert.ok(made.ok);
  await act(async () => root.render(createElement(Harness, { triggers, control, name, draft: made.value })));
  await act(async () => {
    void triggers.checkAgain(name);
    await settle();
  });
  await host.answer("show", shown);
  return { host, root: container, opened };
}

const text = (el: Element | null | undefined) => el?.textContent ?? "";
const statusLine = (root: HTMLElement) => [...root.querySelectorAll('[role="status"]')].map(text).find((t) => t.startsWith("On the host: ")) ?? "";
const dialog = (root: HTMLElement) => root.querySelector('[role="dialog"]');
const dialogTitle = (root: HTMLElement) => {
  const shown = dialog(root);
  return text(shown && document.getElementById(shown.getAttribute("aria-labelledby") ?? ""));
};
const buttonIn = (el: Element | null | undefined, name: string) =>
  [...(el?.querySelectorAll("button") ?? [])].find((b) => (b.getAttribute("aria-label") ?? text(b).trim()) === name);
const click = async (el: Element | null | undefined) => {
  assert.ok(el, "the control is drawn");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
  });
};

test("Withdraw on a pending candidate asks first, naming the revision, then sends it and rereads the host", async () => {
  const { host, root } = await render("nightly", nightly());
  await click(buttonIn(root, "Withdraw revision 1"));
  assert.equal(dialogTitle(root), "Withdraw revision 1 of nightly?");
  assert.match(text(dialog(root)), /The owner can no longer admit revision 1\./);
  await click(buttonIn(dialog(root), "Cancel"));
  assert.equal(dialog(root), null, "Cancel closes the confirm");
  assert.deepEqual(host.open(), [], "nothing was sent to the host");

  await click(buttonIn(root, "Withdraw revision 1"));
  await click(buttonIn(dialog(root), "Withdraw"));
  const sent = host.calls.find((c) => c.command === "praxis_host_trigger_withdraw");
  assert.deepEqual([sent?.args.name, sent?.args.revision, sent?.args.requestId], ["nightly", 1, null]);
  assert.match(text(dialog(root)), /Withdrawing revision 1/);
  await host.answer("withdraw", recordOf("triggers withdraw: a pending candidate"));
  // The host is read again once it has answered.
  await host.answer("show", nightly("WITHDRAWN"));
  assert.equal(dialog(root), null, "the confirm closes once the host has been read again");
  assert.match(statusLine(root), /^On the host: Not submitted/);
  assert.equal(buttonIn(root, "Withdraw revision 1"), undefined, "nothing pending is left to withdraw");
});

test("a withdrawal the host refuses stays in the confirm in the host's words, with Withdraw withheld, and the state is the host's afterwards", async () => {
  const { host, root } = await render("nightly", nightly());
  await click(buttonIn(root, "Withdraw revision 1"));
  await click(buttonIn(dialog(root), "Withdraw"));
  await host.answer("withdraw", refusal("triggers withdraw: not pending"));
  // The owner rejected it in the browser first.
  await host.answer("show", nightly("REJECTED"));
  const shown = dialog(root);
  assert.ok(shown, "the confirm stays open");
  assert.equal(
    text(shown.querySelector('[role="alert"]')),
    "The host refused to withdraw revision 1 of nightly: it is no longer pending. The owner has admitted or rejected it, or it was withdrawn already. The host refused the request (REVISION_NOT_PENDING).",
  );
  const withdraw = buttonIn(shown, "Withdraw");
  assert.equal(withdraw?.getAttribute("aria-disabled"), "true");
  await click(withdraw);
  assert.deepEqual(host.open(), [], "a refused withdrawal isn't sent again");
  assert.match(statusLine(root), /^On the host: Not submitted/);
});

test("Disable on an enabled trigger asks first, saying new fires stop and only the owner can enable it again, then rereads the host", async () => {
  const { host, root } = await render("on-push", enabledOnPush());
  assert.equal(buttonIn(root, "Withdraw revision 1"), undefined, "an admitted revision has no Withdraw");
  await click(buttonIn(root, "Disable"));
  assert.equal(dialogTitle(root), "Disable on-push?");
  assert.match(text(dialog(root)), /New fires stop:/);
  assert.match(text(dialog(root)), /Only the owner can enable it again, in the browser\./);
  await click(buttonIn(dialog(root), "Cancel"));
  assert.deepEqual(host.open(), [], "nothing was sent to the host");

  await click(buttonIn(root, "Disable"));
  await click(buttonIn(dialog(root), "Disable"));
  const sent = host.calls.find((c) => c.command === "praxis_host_trigger_disable");
  assert.deepEqual(sent?.args && [sent.args.name, sent.args.requestId, "revision" in sent.args], ["on-push", null, false]);
  assert.match(text(dialog(root)), /Disabling on-push/);
  await host.answer("disable", recordOf("triggers disable"));
  await host.answer("show", disabledOnPush());
  assert.equal(dialog(root), null, "the confirm closes once the host has been read again");
  assert.match(statusLine(root), /^On the host: Admitted, disabled/);
  assert.equal(buttonIn(root, "Disable"), undefined, "a disabled trigger has no Disable");
});

test("a disabling the host refuses shows the host's message, and the state is the host's afterwards", async () => {
  const { host, root } = await render("on-push", enabledOnPush());
  await click(buttonIn(root, "Disable"));
  await click(buttonIn(dialog(root), "Disable"));
  await host.answer("disable", refusal("triggers disable: retired"));
  // Another session retired it first.
  await host.answer("show", triggerShow("triggers show: retired", "on-push"));
  const shown = dialog(root);
  assert.ok(shown, "the confirm stays open");
  assert.equal(text(shown.querySelector('[role="alert"]')), "The host refused to disable on-push: The host refused the request (TRIGGER_STATE_CONFLICT).");
  assert.equal(buttonIn(shown, "Disable")?.getAttribute("aria-disabled"), "true");
  assert.match(statusLine(root), /^On the host: Retired/);
});
