/// <reference types="node" />
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHostCatalog } from "./hostCatalog.ts";
import { installOpening, templateStatusLine } from "./hostStatus.ts";
import type { TemplateHostView } from "./hostCatalog.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import { TEMPLATE_NAME_RULE, templateNameProblem } from "./lifecycle.ts";

const NOW = 1_800_000_000_000;
const SIGNED_IN: HostCondition = { state: "signedIn" };
const view = (state: TemplateHostView["state"], checkedAt: number | null = NOW, muted = false): TemplateHostView => ({
  state,
  checkedAt,
  muted,
  checking: false,
});

test("the status line shows the state, how long ago it was checked, and Check again", () => {
  const line = templateStatusLine(view({ kind: "installed" }, NOW - 3 * 60_000), SIGNED_IN, NOW);
  assert.equal(line.label, "Installed");
  assert.equal(line.reason, null);
  assert.equal(line.checked, "checked 3 min ago");
  assert.equal(line.checkAgain, true);
});

test("a reading past the mute says it may be out of date", () => {
  const line = templateStatusLine(view({ kind: "differs" }, NOW - 12 * 60_000, true), SIGNED_IN, NOW);
  assert.equal(line.checked, "checked 12 min ago, may be out of date");
  assert.equal(line.muted, true);
});

test("while the host can't be used, the line says why and leaves rereading to Check host", () => {
  const line = templateStatusLine(view({ kind: "unknown", why: "host" }, null), { state: "hostUnreachable" }, NOW);
  assert.equal(line.label, "Host state unknown: Host down");
  assert.equal(line.checked, null);
  assert.equal(line.checkAgain, false);
});

test("a template not read yet says so, and offers Check again", () => {
  const line = templateStatusLine(view({ kind: "unknown", why: "notChecked" }, null), SIGNED_IN, NOW);
  assert.equal(line.label, "Not checked yet");
  assert.equal(line.checked, null);
  assert.equal(line.checkAgain, true);
});

test("a name the host refuses shows the rule, and has nothing to check again", () => {
  const line = templateStatusLine(view({ kind: "nameRefused", rule: "Use lowercase." }, null), SIGNED_IN, NOW);
  assert.equal(line.label, "Name the host refuses");
  assert.equal(line.reason, "Use lowercase.");
  assert.equal(line.checkAgain, false);
});

test("an installed template that can't run shows the host's readiness reason", () => {
  const line = templateStatusLine(view({ kind: "notReady", reason: "No runner is set up." }), SIGNED_IN, NOW);
  assert.equal(line.label, "Installed, not ready");
  assert.equal(line.reason, "No runner is set up.");
  assert.equal(line.checked, "checked 0 min ago");
});

test("the Install dialog opens on the copy steps when the host doesn't have the template", () => {
  assert.deepEqual(installOpening("triage", { kind: "notInstalled" }), { kind: "steps", replaces: null });
});

test("when the host's copy differs, the steps come with a warning that it will be replaced", () => {
  assert.deepEqual(installOpening("triage", { kind: "differs" }), {
    kind: "steps",
    replaces: "The host has a different copy of triage. Installing replaces the host's copy with this saved file.",
  });
});

test("when the host already has this file and can run it, the dialog says there's nothing to do", () => {
  assert.deepEqual(installOpening("triage", { kind: "installed" }), {
    kind: "nothingToDo",
    message: "The host already has this saved file and can run it. There's nothing to do.",
  });
});

test("a name the host refuses withholds the steps and explains the rule", () => {
  const rule = templateNameProblem("Triage");
  assert.ok(rule);
  assert.deepEqual(installOpening("Triage", { kind: "nameRefused", rule }), {
    kind: "refused",
    message: "The host refuses the name Triage, so this file can't be installed. Rename it from the list first.",
    rule: TEMPLATE_NAME_RULE,
  });
});

test("an invalid copy on the host gets the steps, with a warning that it will be replaced", () => {
  assert.deepEqual(installOpening("triage", { kind: "invalidOnHost", diagnostics: ["Bad step."] }), {
    kind: "steps",
    replaces: "The host's copy of triage is invalid. Installing replaces it with this saved file.",
  });
});

test("an installed template that can't run has nothing to copy, and the dialog gives the host's reason", () => {
  assert.deepEqual(installOpening("triage", { kind: "notReady", reason: "No runner is set up." }), {
    kind: "nothingToDo",
    message: "The host already has this saved file, so copying it again won't help. The host says it can't run: No runner is set up.",
  });
});

test("while the host state is unknown, the dialog opens on the copy steps as before", () => {
  assert.deepEqual(installOpening("triage", { kind: "unknown", why: "host" }), { kind: "steps", replaces: null });
});

/** The vendored AI-WS-SDK read-model fixtures, the records `praxis --json` prints at the pin. */
const fixtures = JSON.parse(
  readFileSync(new URL("../../../src-tauri/vendor/aiws/spec/engine-v1/read-models.fixtures.json", import.meta.url), "utf8"),
) as { cases: { name: string; record: Record<string, unknown> }[] };
const fixture = (name: string) => structuredClone(fixtures.cases.find((c) => c.name === name)!.record);
const DIGEST = "a".repeat(64);

/** A host whose `praxis` calls wait until the test answers them, oldest first. */
function fakeHost() {
  const open: { command: string; answer: (outcome: CallOutcome) => void }[] = [];
  const invoker = (command: string) =>
    command === "praxis_host_cancel"
      ? Promise.resolve(undefined)
      : new Promise<unknown>((resolve) => open.push({ command, answer: resolve }));
  return {
    invoker,
    answer(command: string, outcome: CallOutcome) {
      const at = open.findIndex((c) => c.command === command);
      assert.ok(at >= 0, `no open ${command} call`);
      open.splice(at, 1)[0].answer(outcome);
    },
  };
}
const listOf = (names: string[]): CallOutcome => {
  const record = fixture("catalog list with valid and invalid templates");
  const base = (record.templates as Record<string, unknown>[])[0];
  record.templates = names.map((name) => ({ ...base, name, validity: "VALID", revision: 1, diagnostics: [] }));
  return { kind: "record", record };
};
const runnableShow = (name: string): CallOutcome => {
  const record = fixture("detail of a runnable template");
  record.name = name;
  record.templateDigest = DIGEST;
  return { kind: "record", record };
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

test("Check again rereads the template, and the line and the dialog follow the new reading", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const host = fakeHost();
  const catalog = createHostCatalog({ projectPath: "C:/p", call: host.invoker });
  t.after(() => catalog.dispose());
  catalog.setLocal([{ name: "triage", digest: DIGEST, nameProblem: null }]);
  catalog.setCondition(SIGNED_IN);
  void catalog.groupShown();
  await settle();
  host.answer("praxis_host_workflows_list", listOf([]));
  await settle();

  mock.timers.tick(4 * 60_000);
  let line = templateStatusLine(catalog.template("triage"), SIGNED_IN, Date.now());
  assert.equal(line.label, "Not installed");
  assert.equal(line.checked, "checked 4 min ago");
  assert.equal(installOpening("triage", catalog.template("triage").state).kind, "steps");

  // The person copied the file and restarted the host, then checks again.
  const checked = catalog.checkAgain("triage");
  await settle();
  assert.equal(templateStatusLine(catalog.template("triage"), SIGNED_IN, Date.now()).checking, true);
  host.answer("praxis_host_workflows_list", listOf(["triage"]));
  await settle();
  host.answer("praxis_host_workflow_show", runnableShow("triage"));
  await checked;

  line = templateStatusLine(catalog.template("triage"), SIGNED_IN, Date.now());
  assert.equal(line.label, "Installed");
  assert.equal(line.checked, "checked 0 min ago");
  assert.equal(line.checking, false);
  assert.equal(installOpening("triage", catalog.template("triage").state).kind, "nothingToDo");
});
