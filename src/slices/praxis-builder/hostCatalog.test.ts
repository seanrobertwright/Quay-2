/// <reference types="node" />
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createHostCatalog,
  HOST_STATE_ORDER,
  MAX_SHOWS_IN_FLIGHT,
  MUTED_AFTER_MS,
  type HostCatalog,
  type LocalTemplate,
} from "./hostCatalog.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_790_000_000_000 }));
afterEach(() => mock.timers.reset());

/** The vendored AI-WS-SDK read-model fixtures, the records `praxis --json` prints at the pin. */
const fixtures = JSON.parse(
  readFileSync(new URL("../../../src-tauri/vendor/aiws/spec/engine-v1/read-models.fixtures.json", import.meta.url), "utf8"),
) as { cases: { name: string; def: string; valid: boolean; record: Record<string, unknown> }[] };
const fixture = (name: string) => structuredClone(fixtures.cases.find((c) => c.name === name)!.record);

const HOST_DIGEST = "a".repeat(64);
const OTHER_DIGEST = "f".repeat(64);
const SIGNED_IN: HostCondition = { state: "signedIn" };

/** A `workflows list` record holding `templates`, each VALID unless named in `invalid`. */
function listRecord(names: string[], invalid: string[] = []): CallOutcome {
  const record = fixture("catalog list with valid and invalid templates");
  const base = (record.templates as Record<string, unknown>[])[0];
  record.templates = names.map((name) => ({
    ...base,
    name,
    validity: invalid.includes(name) ? "INVALID" : "VALID",
    revision: invalid.includes(name) ? null : 1,
    diagnostics: invalid.includes(name) ? [{ field: "maxAttempts", code: "INVALID_FIELD", severity: "ERROR", message: "Give maxAttempts from 2." }] : [],
  }));
  return { kind: "record", record };
}

/** A `workflows show` record for `name`, from the runnable or the not-ready fixture. */
function showRecord(name: string, opts: { digest?: string; ready?: boolean } = {}): CallOutcome {
  const record = fixture(opts.ready === false ? "detail of a template whose agent is not ready" : "detail of a runnable template");
  record.name = name;
  record.templateDigest = opts.digest ?? HOST_DIGEST;
  return { kind: "record", record };
}

interface Call {
  command: string;
  args: Record<string, unknown>;
  answer(outcome: CallOutcome): void;
  answered?: boolean;
}

/** An invoker whose `praxis` calls wait until the test answers them. */
function fakeHost() {
  const calls: Call[] = [];
  const cancelled: unknown[] = [];
  const invoker = (command: string, args: Record<string, unknown>) => {
    if (command === "praxis_host_cancel") {
      cancelled.push(args.callId);
      return Promise.resolve(undefined);
    }
    return new Promise<unknown>((resolve) => calls.push({ command, args, answer: resolve }));
  };
  const pending = () => calls.filter((c) => !c.answered);
  return {
    invoker,
    calls,
    cancelled,
    /** The calls not answered yet, as `list` or `show <name>`. */
    open: () => pending().map(label),
    /** Answers the oldest open call labelled `what`. */
    answer(what: string, outcome: CallOutcome) {
      const call = pending().find((c) => label(c) === what);
      assert.ok(call, `no open ${what} call; open: ${pending().map(label).join(", ")}`);
      call.answered = true;
      call.answer(outcome);
    },
  };
}
const label = (c: Call) => (c.command === "praxis_host_workflows_list" ? "list" : `show ${String(c.args.name)}`);

/** Lets settled calls' follow-ups run; setImmediate isn't mocked. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const local = (name: string, digest: string | null = HOST_DIGEST, nameProblem: string | null = null): LocalTemplate => ({
  name,
  digest,
  nameProblem,
});

function setup(templates: LocalTemplate[], condition: HostCondition = SIGNED_IN) {
  const host = fakeHost();
  const catalog: HostCatalog = createHostCatalog({ projectPath: "C:/p", call: host.invoker });
  catalog.setLocal(templates);
  catalog.setCondition(condition);
  return { host, catalog };
}

test("a name the host refuses shows with its rule even offline, and is never sent to praxis", async () => {
  const { host, catalog } = setup([local("Fix_Bug", HOST_DIGEST, "the rule")], { state: "hostUnreachable" });
  assert.deepEqual(catalog.template("Fix_Bug").state, { kind: "nameRefused", rule: "the rule" });
  catalog.setCondition(SIGNED_IN);
  catalog.groupShown();
  await settle();
  host.answer("list", listRecord(["Fix_Bug"]));
  await settle();
  assert.deepEqual(host.open(), []);
  assert.deepEqual(catalog.template("Fix_Bug").state, { kind: "nameRefused", rule: "the rule" });
});

/** Shows the group and answers its `list` with `names` installed. */
async function readListed(host: ReturnType<typeof fakeHost>, catalog: HostCatalog, names: string[], invalid: string[] = []) {
  void catalog.groupShown();
  await settle();
  host.answer("list", listRecord(names, invalid));
  await settle();
}

test("a template missing from the host's list is not installed, and gets no show", async () => {
  const { host, catalog } = setup([local("review-code")]);
  const listedAt = Date.now();
  await readListed(host, catalog, ["other"]);
  assert.deepEqual(catalog.template("review-code"), { state: { kind: "notInstalled" }, checkedAt: listedAt, muted: false, checking: false });
  assert.deepEqual(host.open(), []);
});

test("a template the list reports invalid is invalid on host, with the host's diagnostics", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"], ["review-code"]);
  assert.deepEqual(catalog.template("review-code").state, { kind: "invalidOnHost", diagnostics: ["Give maxAttempts from 2."] });
  host.answer("show review-code", showRecord("review-code", { digest: OTHER_DIGEST }));
  await settle();
  assert.deepEqual(catalog.template("review-code").state, { kind: "invalidOnHost", diagnostics: ["Give maxAttempts from 2."] });
});

test("a host copy whose templateDigest isn't the saved file's differs from host", async () => {
  const { host, catalog } = setup([local("review-code", OTHER_DIGEST)]);
  await readListed(host, catalog, ["review-code"]);
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "notChecked" });
  assert.equal(catalog.template("review-code").checking, true);
  host.answer("show review-code", showRecord("review-code", { ready: false }));
  await settle();
  assert.deepEqual(catalog.template("review-code").state, { kind: "differs" });
});

test("the same digest with a host that says it can't run is installed but not ready, with the host's reason", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"]);
  host.answer("show review-code", showRecord("review-code", { ready: false }));
  await settle();
  assert.deepEqual(catalog.template("review-code").state, { kind: "notReady", reason: "The agent does not declare TOOL node." });
});

test("the same digest and a runnable template is installed, stamped with the show's time", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"]);
  mock.timers.tick(5_000);
  const shownAt = Date.now();
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  assert.deepEqual(catalog.template("review-code"), { state: { kind: "installed" }, checkedAt: shownAt, muted: false, checking: false });
});

test("a failed show leaves the state unknown with praxis's words", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"]);
  host.answer("show review-code", { kind: "timedOut" });
  await settle();
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "failed", message: "praxis didn't answer in time." });
});

test("the six states are derived worst first", async () => {
  assert.deepEqual(HOST_STATE_ORDER, ["nameRefused", "notInstalled", "invalidOnHost", "differs", "notReady", "installed"]);
  const { host, catalog } = setup([
    local("Refused", HOST_DIGEST, "the rule"),
    local("missing"),
    local("broken", OTHER_DIGEST),
    local("changed", OTHER_DIGEST),
    local("blocked"),
  ]);
  await readListed(host, catalog, ["Refused", "broken", "changed", "blocked"], ["Refused", "broken"]);
  // A refused name beats the host's listing, an invalid listing beats a differing digest, and a
  // differing digest beats a host that can't run the template.
  host.answer("show broken", showRecord("broken", { ready: false }));
  host.answer("show changed", showRecord("changed", { ready: false }));
  await settle();
  host.answer("show blocked", showRecord("blocked", { ready: false }));
  await settle();
  assert.deepEqual(
    ["Refused", "missing", "broken", "changed", "blocked"].map((n) => catalog.template(n).state.kind),
    ["nameRefused", "notInstalled", "invalidOnHost", "differs", "notReady"],
  );
});

test("per-template states are unknown unless the host is signed in or simulated", async () => {
  const { host, catalog } = setup([local("review-code")], { state: "notCheckedYet" });
  await readListed(host, catalog, ["review-code"]);
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "host" });
  catalog.setCondition({ state: "simulatedHost" });
  assert.deepEqual(catalog.template("review-code").state, { kind: "installed" });
  catalog.setCondition(SIGNED_IN);
  assert.deepEqual(catalog.template("review-code").state, { kind: "installed" });
});

test("offline, per-template readings are dropped, and an answer to a read asked before is ignored", async () => {
  const { host, catalog } = setup([local("review-code"), local("other")]);
  await readListed(host, catalog, ["review-code", "other", "host-only"]);
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  catalog.setCondition({ state: "hostUnreachable" });
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "host" });
  assert.deepEqual(catalog.hostOnly(), []);
  host.answer("show other", showRecord("other"));
  await settle();
  catalog.setCondition(SIGNED_IN);
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "notChecked" });
  assert.deepEqual(catalog.template("other").state, { kind: "unknown", why: "notChecked" });
  assert.deepEqual(catalog.hostOnly(), []);
});

test("after 10 minutes a reading turns muted and listeners hear it, and it isn't dropped", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"]);
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  const shownAt = Date.now();
  let heard = 0;
  catalog.subscribe(() => (heard += 1));
  mock.timers.tick(10 * 60_000 - 1);
  assert.equal(catalog.template("review-code").muted, false);
  assert.equal(heard, 0);
  mock.timers.tick(1);
  assert.equal(heard, 1);
  assert.deepEqual(catalog.template("review-code"), { state: { kind: "installed" }, checkedAt: shownAt, muted: true, checking: false });
  assert.equal(MUTED_AFTER_MS, 10 * 60_000);
});

test("a save that changes the file invalidates its verdict at once and rechecks that template only", async () => {
  const { host, catalog } = setup([local("review-code"), local("other")]);
  await readListed(host, catalog, ["review-code", "other"]);
  host.answer("show review-code", showRecord("review-code"));
  host.answer("show other", showRecord("other"));
  await settle();
  void catalog.saved("review-code", OTHER_DIGEST);
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "notChecked" });
  await settle();
  assert.deepEqual(host.open(), ["show review-code"]);
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  assert.deepEqual(catalog.template("review-code").state, { kind: "differs" });
  assert.deepEqual(catalog.template("other").state, { kind: "installed" });
});

test("a file changed on disk invalidates its verdict when the list brings its new digest", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"]);
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  catalog.setLocal([local("review-code", OTHER_DIGEST)]);
  assert.deepEqual(catalog.template("review-code").state, { kind: "unknown", why: "notChecked" });
});

test("saving a template the host hasn't installed asks the host nothing", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["other"]);
  await catalog.saved("review-code", OTHER_DIGEST);
  assert.deepEqual(host.open(), []);
  assert.deepEqual(catalog.template("review-code").state, { kind: "notInstalled" });
});

test("show runs at most two at a time across the fan-out", async () => {
  const names = ["a", "b", "c", "d", "e"];
  const { host, catalog } = setup(names.map((n) => local(n)));
  await readListed(host, catalog, names);
  assert.deepEqual(host.open(), ["show a", "show b"]);
  host.answer("show a", showRecord("a"));
  await settle();
  assert.deepEqual(host.open(), ["show b", "show c"]);
  // A Check again of a template the fan-out has queued joins its show rather than adding one.
  void catalog.checkAgain("e");
  await settle();
  assert.deepEqual(host.open(), ["show b", "show c"]);
  for (const name of ["b", "c", "d", "e"]) {
    host.answer(`show ${name}`, showRecord(name));
    await settle();
    assert.ok(host.open().length <= MAX_SHOWS_IN_FLIGHT, host.open().join(", "));
  }
  assert.deepEqual(host.open(), []);
  assert.equal(host.calls.filter((c) => label(c) === "show e").length, 1);
  assert.deepEqual(
    names.map((n) => catalog.template(n).state.kind),
    names.map(() => "installed"),
  );
  assert.equal(MAX_SHOWS_IN_FLIGHT, 2);
});

test("a Check again beyond the fan-out waits for a free slot", async () => {
  const { host, catalog } = setup(["a", "b", "c"].map((n) => local(n)));
  await readListed(host, catalog, ["a", "b", "c"]);
  host.answer("show a", showRecord("a"));
  await settle();
  void catalog.checkAgain("a");
  await settle();
  assert.deepEqual(host.open(), ["show b", "show c"]);
  host.answer("show b", showRecord("b"));
  await settle();
  assert.deepEqual(host.open(), ["show c", "show a"]);
});

test("only the first showing of the group reads; Check host rereads everything and Check again one template", async () => {
  const { host, catalog } = setup([local("review-code"), local("other")]);
  await readListed(host, catalog, ["review-code", "other"]);
  host.answer("show review-code", showRecord("review-code"));
  host.answer("show other", showRecord("other"));
  await settle();
  void catalog.groupShown();
  await settle();
  assert.deepEqual(host.open(), []);
  void catalog.checkAgain("other");
  await settle();
  assert.deepEqual(host.open(), ["show other"]);
  host.answer("show other", showRecord("other"));
  await settle();
  void catalog.checkHost();
  await settle();
  assert.deepEqual(host.open(), ["list"]);
  host.answer("list", listRecord(["review-code", "other"]));
  await settle();
  assert.deepEqual(host.open(), ["show review-code", "show other"]);
  assert.deepEqual(host.calls.map(label), ["list", "show review-code", "show other", "show other", "list", "show review-code", "show other"]);
});

test("Check again on a template the list lacks rereads the list, then shows it if it is now there", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["other"]);
  void catalog.checkAgain("review-code");
  await settle();
  host.answer("list", listRecord(["review-code"]));
  await settle();
  assert.deepEqual(host.open(), ["show review-code"]);
});

test("host templates with no local file are kept as a separate list, matched by exact name", async () => {
  const { host, catalog } = setup([local("review-code"), local("Other", HOST_DIGEST, "the rule")]);
  await readListed(host, catalog, ["review-code", "other", "broken"], ["broken"]);
  assert.deepEqual(
    catalog.hostOnly().map((t) => [t.name, t.valid, t.diagnostics]),
    [
      ["other", true, []],
      ["broken", false, ["Give maxAttempts from 2."]],
    ],
  );
});

test("dispose cancels the calls in flight, clears the mute timer and ignores late answers", async () => {
  const { host, catalog } = setup([local("review-code"), local("other")]);
  await readListed(host, catalog, ["review-code", "other"]);
  host.answer("show review-code", showRecord("review-code"));
  await settle();
  let heard = 0;
  catalog.subscribe(() => (heard += 1));
  catalog.dispose();
  const showOther = host.calls.find((c) => label(c) === "show other")!;
  assert.deepEqual(host.cancelled, [showOther.args.callId]);
  host.answer("show other", showRecord("other"));
  mock.timers.tick(MUTED_AFTER_MS);
  await settle();
  assert.equal(heard, 0);
  assert.deepEqual(catalog.template("other").state, { kind: "unknown", why: "notChecked" });
});

test("every call names the project and a call id the runner can cancel", async () => {
  const { host, catalog } = setup([local("review-code")]);
  await readListed(host, catalog, ["review-code"]);
  const [list, show] = host.calls;
  assert.equal(list.command, "praxis_host_workflows_list");
  assert.equal(list.args.projectPath, "C:/p");
  assert.equal(show.command, "praxis_host_workflow_show");
  assert.deepEqual({ ...show.args, callId: typeof show.args.callId }, { projectPath: "C:/p", name: "review-code", callId: "string" });
});
