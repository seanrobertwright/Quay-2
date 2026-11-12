/// <reference types="node" />
// Check on host (#596): reading the host's authoring preview of a workflow template draft, when
// its answer is kept, and what the template form shows of it. The records are what the real
// `praxis preview --template --json` printed. The form tests render the real form into happy-dom
// and fake only Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNewDraft, type Draft } from "./drafts.ts";
import {
  CORRECTIONS_MESSAGE,
  creatablePreview,
  identifiedPreview,
  invalidPreview,
  MAX_ATTEMPTS_MESSAGE,
  unreadyPreview,
} from "./fixtures/previewOutputs.ts";
import type { Json } from "./model.ts";
import type { CallOutcome, HostCondition, Invoker } from "./praxisHost.ts";
import {
  createPreviewChecks,
  draftText,
  fieldPointer,
  hostIssuesByPath,
  HOST_SAID_BEFORE,
  HOST_SAYS,
  MAX_HOST_DIAGNOSTICS,
  PRAXIS_TOO_OLD,
  previewFailure,
  templatePreviewOf,
  verdictLine,
  type TemplatePreview,
} from "./templatePreview.ts";

const { TemplateForm } = await import("./TemplateForm.tsx");

const read = (outcome: CallOutcome): TemplatePreview => {
  const preview = templatePreviewOf(outcome);
  assert.ok(preview);
  return preview;
};

/** Lets every pending promise callback run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// --- Reading the record ---

test("the recorded previews read as whether a run can be created and the host's diagnostics, in its order", () => {
  assert.deepEqual(read(creatablePreview()), {
    creatable: true,
    diagnostics: [{ field: "reapproveCorrections", code: "CORRECTIONS_PREAUTHORIZED", severity: "WARNING", message: CORRECTIONS_MESSAGE }],
    omitted: 0,
  });
  const invalid = read(invalidPreview());
  assert.equal(invalid.creatable, false);
  assert.deepEqual(invalid.diagnostics, [{ field: "maxAttempts", code: "INVALID_FIELD", severity: "ERROR", message: MAX_ATTEMPTS_MESSAGE }]);
  const unready = read(unreadyPreview());
  assert.equal(unready.creatable, false);
  assert.deepEqual(
    unready.diagnostics.map((d) => [d.field, d.code, d.severity]),
    [
      ["reapproveCorrections", "CORRECTIONS_PREAUTHORIZED", "WARNING"],
      ["agent", "AGENT_NOT_OFFERED", "ERROR"],
    ],
  );
});

test("anything but a readable aiws-authoring-preview/1 record of a template is no preview", () => {
  const outcomes: CallOutcome[] = [
    creatablePreview({ format: "aiws-authoring-preview/2" }),
    creatablePreview({ form: "PLAN" }),
    creatablePreview({ creatable: "yes" }),
    creatablePreview({ diagnostics: "none" }),
    creatablePreview({ diagnostics: [{ field: "a", code: "C", severity: "INFO", message: "m" }] }),
    creatablePreview({ diagnostics: [{ field: 7, code: "C", severity: "ERROR", message: "m" }] }),
    creatablePreview({ diagnostics: [{ field: "a", code: "C", severity: "ERROR" }] }),
    { kind: "commandUnknown", command: "preview" },
    { kind: "needsUpdate", detail: "praxis printed a aiws-authoring-preview/2 record, and this Quay reads aiws-authoring-preview/1." },
    { kind: "hostDown", message: "down" },
    { kind: "notSignedIn", message: "no session" },
    { kind: "hostRefused", message: "refused", hostCode: "HUMAN_REQUIRED", record: {} },
    { kind: "refused", message: "refused" },
    { kind: "timedOut" },
    { kind: "cancelled" },
  ];
  for (const outcome of outcomes) assert.equal(templatePreviewOf(outcome), null, JSON.stringify(outcome));
});

test("at most MAX_HOST_DIAGNOSTICS diagnostics are kept, and the rest are counted", () => {
  const many = Array.from({ length: MAX_HOST_DIAGNOSTICS + 3 }, (_, i) => ({ field: `f${i}`, code: "C", severity: "WARNING", message: "m" }));
  const preview = read(creatablePreview({ diagnostics: many }));
  assert.equal(preview.diagnostics.length, MAX_HOST_DIAGNOSTICS);
  assert.equal(preview.omitted, 3);
});

test("a preview that couldn't be read is one line, and a praxis without preview has its own", () => {
  assert.equal(previewFailure({ kind: "commandUnknown", command: "preview" }), PRAXIS_TOO_OLD);
  assert.match(PRAXIS_TOO_OLD, /the installed praxis is too old for this check/);
  assert.equal(previewFailure({ kind: "hostDown", message: "Could not reach the host." }), "The host couldn't check this draft: Could not reach the host.");
  assert.equal(previewFailure({ kind: "timedOut" }), "The host couldn't check this draft: praxis didn't answer in time.");
  assert.match(previewFailure({ kind: "needsUpdate", detail: "another format" }), /^The host couldn't check this draft: .*another format$/);
});

test("the field a diagnostic names is the JSON Pointer of that field in the draft", () => {
  assert.equal(fieldPointer("maxAttempts"), "/maxAttempts");
  assert.equal(fieldPointer("exposure.allowance"), "/exposure/allowance");
  assert.equal(fieldPointer("outputPaths[2]"), "/outputPaths/2");
  assert.equal(fieldPointer("a/b~c"), "/a~1b~0c");
  assert.equal(fieldPointer(""), "");
});

test("a host diagnostic keeps the host's words and code, and says it is the host's", () => {
  const preview = read(invalidPreview());
  assert.deepEqual(hostIssuesByPath(preview, false).get("/maxAttempts"), [
    { code: "INVALID_FIELD", severity: "error", message: MAX_ATTEMPTS_MESSAGE, path: "/maxAttempts", hint: HOST_SAYS },
  ]);
  assert.equal(hostIssuesByPath(preview, true).get("/maxAttempts")?.[0].hint, HOST_SAID_BEFORE);
});

test("the verdict line says whether a run can be created, and counts the host's problems", () => {
  assert.equal(verdictLine(read(creatablePreview())), "The host can create a run from this draft.");
  assert.equal(verdictLine(read(invalidPreview())), "The host can't create a run from this draft: 1 problem.");
  assert.equal(verdictLine(read(identifiedPreview())), "The host can't create a run from this draft: 2 problems.");
  assert.equal(verdictLine({ creatable: false, diagnostics: [], omitted: 0 }), "The host can't create a run from this draft.");
});

// --- When an answer is kept ---

/** A fake runner whose preview calls are answered by hand, in any order. */
function manualCalls() {
  const pending: { args: Record<string, unknown>; answer: (outcome: CallOutcome) => void }[] = [];
  const cancelled: unknown[] = [];
  const call: Invoker = (command, args) => {
    if (command === "praxis_host_cancel") {
      cancelled.push(args.callId);
      return Promise.resolve(null);
    }
    assert.equal(command, "praxis_host_template_preview");
    return new Promise((resolve) => pending.push({ args, answer: resolve }));
  };
  return { call, pending, cancelled };
}

test("a check sends the draft as it stands and keeps the host's answer with the draft it was about", async () => {
  const { call, pending } = manualCalls();
  const checks = createPreviewChecks(call);
  const seen: boolean[] = [];
  checks.subscribe(() => seen.push(checks.current().checking));
  assert.deepEqual(checks.current(), { result: null, checking: false });
  const draft = { description: "Add", maxAttempts: 1 };
  checks.check("C:/p", draft);
  assert.deepEqual(checks.current(), { result: null, checking: true });
  assert.equal(pending[0].args.projectPath, "C:/p");
  assert.deepEqual(pending[0].args.draft, draft);
  pending[0].answer(invalidPreview());
  await settle();
  assert.deepEqual(checks.current(), { result: { state: "answered", preview: read(invalidPreview()), checked: draftText(draft) }, checking: false });
  assert.deepEqual(seen, [true, false]);
});

test("an answer that arrives after a newer check was started is dropped, and its call is cancelled", async () => {
  const { call, pending, cancelled } = manualCalls();
  const checks = createPreviewChecks(call);
  checks.check("C:/p", { maxAttempts: 1 });
  checks.check("C:/p", { maxAttempts: 3 });
  assert.deepEqual(cancelled, [pending[0].args.callId]);
  pending[1].answer(creatablePreview());
  await settle();
  pending[0].answer(invalidPreview());
  await settle();
  const { result } = checks.current();
  assert.ok(result?.state === "answered");
  assert.equal(result.preview.creatable, true);
  assert.equal(result.checked, draftText({ maxAttempts: 3 }));
});

test("an answer that arrives after the checks were dropped is dropped too", async () => {
  const { call, pending, cancelled } = manualCalls();
  const checks = createPreviewChecks(call);
  checks.check("C:/p", {});
  checks.drop();
  assert.deepEqual(cancelled, [pending[0].args.callId]);
  pending[0].answer(creatablePreview());
  await settle();
  assert.deepEqual(checks.current(), { result: null, checking: false });
});

test("a failed check replaces the last answer with the one line, and a later answer replaces that", async () => {
  const { call, pending } = manualCalls();
  const checks = createPreviewChecks(call);
  checks.check("C:/p", {});
  pending[0].answer(creatablePreview());
  await settle();
  checks.check("C:/p", {});
  // The last answer stays while the host is asked again.
  assert.equal(checks.current().result?.state, "answered");
  pending[1].answer({ kind: "commandUnknown", command: "preview" });
  await settle();
  assert.deepEqual(checks.current(), { result: { state: "failed", message: PRAXIS_TOO_OLD }, checking: false });
  checks.check("C:/p", {});
  pending[2].answer(creatablePreview({ format: "aiws-authoring-preview/2" }));
  await settle();
  assert.deepEqual(checks.current().result, { state: "failed", message: "The host couldn't check this draft: praxis gave an answer Quay can't read." });
});

// --- The template form ---

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const SIGNED_IN: HostCondition = { state: "signedIn" };

/** The template form over a draft holding `content`, with the host answering each check with the next of `answers`. */
async function form(content: Record<string, Json>, answers: CallOutcome[], condition: HostCondition | null = SIGNED_IN) {
  const previews: Record<string, unknown>[] = [];
  fakeInvoke(async (cmd, args) => {
    if (cmd === "praxis_validate") return { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
    if (cmd === "praxis_host_cancel") return null;
    if (cmd === "praxis_host_template_preview") {
      previews.push(args);
      const answer = answers.shift();
      assert.ok(answer, "an answer for this check");
      return answer;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  });
  const made = createNewDraft({ kind: "templates", id: "build-app" }, content);
  assert.ok(made.ok);
  const verdicts: (string | null)[] = [];
  const element = (draft: Draft) =>
    createElement(TemplateForm, {
      draft,
      onEdit: () => {},
      onValidated: (verdict) => verdicts.push(verdict),
      onInstall: () => {},
      host: null,
      hostCheck: condition ? { projectPath: "C:/p", condition } : null,
    });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element(made.value)));
  return {
    container,
    previews,
    verdicts,
    /** Shows the form the draft again with `next` as its content, as an edit does. */
    edit: (next: Record<string, Json>) => act(async () => root.render(element({ ...made.value, content: next }))),
  };
}

const button = (root: HTMLElement) => {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent === "Check on host");
  assert.ok(found, "a Check on host button");
  return found;
};

async function press(root: HTMLElement) {
  await act(async () => button(root).click());
  await act(settle);
}

/** The host's verdict line: the status that isn't the shape check's. */
const verdict = (root: HTMLElement) => [...root.querySelectorAll('[role="status"]')].map((s) => s.textContent ?? "").find((t) => /host/i.test(t)) ?? "";

/** Everything the field labelled `label` is described by, and whether it is marked invalid. */
function field(root: HTMLElement, label: string) {
  const labelEl = [...root.querySelectorAll("label")].find((l) => l.textContent === label);
  assert.ok(labelEl, `a field labelled ${label}`);
  const input = root.querySelector(`[id="${labelEl.htmlFor}"]`) as HTMLInputElement;
  const described = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  return { description: described.map((id) => root.querySelector(`[id="${id}"]`)?.textContent ?? "").join("\n"), invalid: input.getAttribute("aria-invalid") };
}

const otherFields = (root: HTMLElement) =>
  [...root.querySelectorAll(`[aria-label="What the host says of fields this form doesn't show"] li`)].map((li) => li.textContent ?? "");

test("Check on host shows that a run can be created, with the host's warning on its field", async () => {
  const content = { description: "Add", maxAttempts: 3 };
  const { container, previews } = await form(content, [creatablePreview()]);
  assert.equal(verdict(container), "");
  await press(container);
  assert.equal(previews.length, 1);
  assert.deepEqual([previews[0].projectPath, previews[0].draft], ["C:/p", content]);
  assert.equal(verdict(container), "The host can create a run from this draft.");
  const corrections = field(container, "Approve each correction again");
  assert.ok(corrections.description.includes(CORRECTIONS_MESSAGE));
  assert.ok(corrections.description.includes(HOST_SAYS));
  assert.equal(corrections.invalid, null);
  assert.deepEqual(otherFields(container), []);
});

test("a draft no run can be created from shows the verdict and the host's error on its field, verbatim, and can still be saved", async () => {
  const { container, verdicts } = await form({ description: "Add" }, [invalidPreview()]);
  await press(container);
  assert.equal(verdict(container), "The host can't create a run from this draft: 1 problem.");
  const attempts = field(container, "Max attempts");
  assert.ok(attempts.description.includes(MAX_ATTEMPTS_MESSAGE));
  assert.ok(attempts.description.includes("INVALID_FIELD"));
  // The verdict the form reports is what allows a save, and it is the shape check's alone.
  assert.deepEqual(verdicts, [null]);
  assert.match(container.textContent ?? "", /The template's shape matches the coding-plan schema\./);
});

test("a diagnostic about a field the form doesn't show is listed by the verdict, with the field named", async () => {
  const { container } = await form({ description: "Add" }, [identifiedPreview()]);
  await press(container);
  assert.equal(verdict(container), "The host can't create a run from this draft: 2 problems.");
  const listed = otherFields(container);
  assert.equal(listed.length, 2);
  assert.match(listed[0], /^workOrderId: A workflow template carries no work order or run identity; .* TEMPLATE_IDENTITY$/);
  assert.match(listed[1], /^runId: /);
});

test("the host's diagnostic about the agent shows on the Agent field", async () => {
  const { container } = await form({ description: "Add", agent: "no-such-agent" }, [unreadyPreview()]);
  await press(container);
  assert.match(field(container, "Agent").description, /No agent catalog is configured on this host, so agent no-such-agent cannot be selected/);
  assert.deepEqual(otherFields(container), []);
});

test("editing the draft after a check marks the result out of date, and the next check clears the mark", async () => {
  const content = { description: "Add" };
  const { container, edit, previews } = await form(content, [invalidPreview(), creatablePreview()]);
  await press(container);
  assert.doesNotMatch(verdict(container), /Out of date/);
  const edited = { description: "Add", maxAttempts: 3 };
  await edit(edited);
  assert.match(verdict(container), /^The host can't create a run from this draft: 1 problem\. Out of date: the draft has changed since the host was asked\.$/);
  assert.ok(field(container, "Max attempts").description.includes(HOST_SAID_BEFORE));
  // Putting the draft back as the host saw it makes the answer current again.
  await edit({ description: "Add" });
  assert.doesNotMatch(verdict(container), /Out of date/);
  await edit(edited);
  await press(container);
  assert.deepEqual(previews[1].draft, edited);
  assert.equal(verdict(container), "The host can create a run from this draft.");
});

test("a check that couldn't be read shows one line and no host diagnostics", async () => {
  const failures: [CallOutcome, RegExp][] = [
    [{ kind: "hostDown", message: "Could not reach the host at https://127.0.0.1:8443; is it running?" }, /^The host couldn't check this draft: Could not reach the host/],
    [{ kind: "notSignedIn", message: "There is no CLI session for this host." }, /^The host couldn't check this draft: There is no CLI session/],
    [{ kind: "hostRefused", message: "The host refused the request.", hostCode: "HUMAN_REQUIRED", record: {} }, /^The host couldn't check this draft: The host refused the request\.$/],
    [{ kind: "timedOut" }, /^The host couldn't check this draft: praxis didn't answer in time\.$/],
    [{ kind: "commandUnknown", command: "preview" }, /the installed praxis is too old for this check/],
    [creatablePreview({ format: "aiws-authoring-preview/2" }), /^The host couldn't check this draft: praxis gave an answer Quay can't read\.$/],
  ];
  // An answer first, so each failure is seen to take the host's diagnostics away.
  const { container } = await form({ description: "Add" }, [invalidPreview(), ...failures.map(([outcome]) => outcome)]);
  await press(container);
  assert.ok(field(container, "Max attempts").description.includes(MAX_ATTEMPTS_MESSAGE));
  for (const [, line] of failures) {
    await press(container);
    assert.match(verdict(container), line);
    assert.doesNotMatch(container.textContent ?? "", /INVALID_FIELD/);
    assert.deepEqual(otherFields(container), []);
  }
});

test("Check on host is a named button, and with no usable host it is disabled and says why", async () => {
  const conditions: [HostCondition, string][] = [
    [{ state: "noHostSetUp" }, "The host can't be asked: No host set up."],
    [{ state: "hostUnreachable" }, "The host can't be asked: Host down."],
    [{ state: "notSignedIn" }, "The host can't be asked: Not signed in."],
    [{ state: "notCheckedYet" }, "The host can't be asked: Host not checked yet."],
  ];
  for (const [condition, reason] of conditions) {
    const { container, previews } = await form({ description: "Add" }, [], condition);
    const check = button(container);
    assert.equal(check.getAttribute("type"), "button");
    assert.equal(check.getAttribute("aria-disabled"), "true");
    assert.equal(check.getAttribute("title"), reason);
    assert.equal(container.querySelector(`[id="${check.getAttribute("aria-describedby")}"]`)?.textContent, reason);
    await press(container);
    assert.equal(previews.length, 0);
    act(() => mounted!.root.unmount());
    mounted!.container.remove();
    mounted = null;
  }
  const usable = await form({ description: "Add" }, [], { state: "simulatedHost" });
  assert.equal(button(usable.container).getAttribute("aria-disabled"), "false");
  assert.equal(button(usable.container).getAttribute("aria-describedby"), null);
});

test("the verdict is a status that is on the page before the first check, so its changes are announced", async () => {
  const { container } = await form({ description: "Add" }, [creatablePreview()]);
  const before = [...container.querySelectorAll('[role="status"]')];
  await press(container);
  const after = [...container.querySelectorAll('[role="status"]')];
  const line = after.find((s) => s.textContent === "The host can create a run from this draft.");
  assert.ok(line);
  assert.ok(before.includes(line), "the same element held the verdict before it had one");
});

test("without a project to ask about, the form has no Check on host", async () => {
  const { container } = await form({ description: "Add" }, [], null);
  assert.equal([...container.querySelectorAll("button")].some((b) => b.textContent === "Check on host"), false);
});
