/// <reference types="node" />
// The graph trigger host state model (#475): each of the eight states, their order, the fall back
// from a rejected or withdrawn candidate, the saved files' digest at the current revision, the
// enabled states, the candidate poll, muting and offline. The host is the Tauri `invoke`
// boundary, faked; its records are the ones the real `praxis` printed
// (trigger_outputs.fixture.json, recorded against the SDK's simulated host).
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { CANDIDATE_POLL_MS, MAX_LIST_PAGES } from "./graphHost.ts";
import { MUTED_AFTER_MS } from "./hostReadSession.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import { createTriggerHost, TRIGGER_STATE_ORDER, type EventSourceSummary, type LocalGraphTrigger, type TriggerHost } from "./triggerHost.ts";
import { ON_PUSH_DIGEST, recordedTrigger, triggerNotFound, triggerShow } from "./fixtures/triggerOutputs.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_790_000_000_000 }));
afterEach(() => mock.timers.reset());

const OTHER_DIGEST = `sha256:${"e".repeat(64)}`;
const SIGNED_IN: HostCondition = { state: "signedIn" };

type Revision = Record<string, unknown>;

/** The recorded `triggers list`, holding `names`. */
function listRecord(names: string[], nextAfter: string | null = null): CallOutcome {
  const record = recordedTrigger("triggers list");
  const base = (record.triggers as Record<string, unknown>[])[0];
  record.triggers = names.map((name) => ({ ...base, name }));
  record.nextAfter = nextAfter;
  return { kind: "record", record };
}

function eventSourcesRecord(sources: EventSourceSummary[], nextAfter: string | null = null): CallOutcome {
  return {
    kind: "record",
    record: {
      format: "aiws-event-sources/1",
      sources,
      nextAfter,
    },
  };
}

/** Revision 1 of the recorded `on-push`, admitted, under a newer revision 2 with `status2`. */
function overAdmitted(status2: string): Revision[] {
  const revisions = recordedTrigger("triggers show: admitted but disabled").revisions as Revision[];
  return [{ ...revisions[0], status: status2 }, revisions[1]];
}

/** The recorded admitted and enabled `on-push`, as `name`, with `fields` over it. */
const enabled = (name: string, fields: Record<string, unknown> = {}) => triggerShow("triggers show: admitted and enabled", name, fields);

interface Call {
  command: string;
  args: Record<string, unknown>;
  answer(outcome: unknown): void;
  answered?: boolean;
}

/**
 * An invoker whose `praxis` calls wait until the test answers them. The saved files' digest is
 * answered at once from `digestOf`, unless `holdDigests` is set, when it waits like the rest.
 */
function fakeHost() {
  const calls: Call[] = [];
  const cancelled: unknown[] = [];
  const fake = {
    calls,
    cancelled,
    /** The saved files' digest of each trigger at each revision: the host's own for `on-push` revision 1, by default. */
    digestOf: (_name: string, _revision: number): string | null => ON_PUSH_DIGEST,
    holdDigests: false,
    holdEventSources: false,
    eventSourcesRecord: (): CallOutcome => ({
      kind: "record",
      record: {
        format: "aiws-event-sources/1",
        sources: [],
        nextAfter: null,
      },
    }),
    invoker: (command: string, args: Record<string, unknown>) => {
      if (command === "praxis_host_cancel") {
        cancelled.push(args.callId);
        return Promise.resolve(undefined);
      }
      if (command === "praxis_trigger_digest" && !fake.holdDigests) {
        calls.push({ command, args, answer: () => {}, answered: true });
        return Promise.resolve(fake.digestOf(String(args.name), Number(args.revision)));
      }
      if (command === "praxis_host_event_sources_list" && !fake.holdEventSources) {
        return Promise.resolve(fake.eventSourcesRecord());
      }
      return new Promise<unknown>((resolve) => calls.push({ command, args, answer: resolve }));
    },
    /** The calls not answered yet, as `list`, `show <name>` or `digest <name> <revision>`. */
    open: () => calls.filter((c) => !c.answered).map(label),
    /** Answers the oldest open call labelled `what`, or the newest. */
    answer(what: string, outcome: unknown, which: "oldest" | "newest" = "oldest") {
      const open = calls.filter((c) => !c.answered && label(c) === what);
      const call = which === "oldest" ? open[0] : open[open.length - 1];
      assert.ok(call, `no open ${what} call; open: ${fake.open().join(", ")}`);
      call.answered = true;
      call.answer(outcome);
    },
    /** How many times the saved files of `name` were digested. */
    digests: (name: string) => calls.filter((c) => c.command === "praxis_trigger_digest" && c.args.name === name).length,
  };
  return fake;
}
const label = (c: Call) =>
  c.command === "praxis_host_triggers_list"
    ? `list${c.args.after ? ` after ${String(c.args.after)}` : ""}`
    : c.command === "praxis_host_event_sources_list"
      ? `event-sources${c.args.after ? ` after ${String(c.args.after)}` : ""}`
      : c.command === "praxis_host_trigger_show"
        ? `show ${String(c.args.name)}`
        : c.command === "praxis_trigger_digest"
          ? `digest ${String(c.args.name)} ${String(c.args.revision)}`
          : c.command;

/** Lets settled calls' follow-ups run; setImmediate isn't mocked. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const local = (name: string, saved: Partial<LocalGraphTrigger> = {}): LocalGraphTrigger => ({
  name,
  target: "release-review",
  enabled: true,
  nameProblem: null,
  ...saved,
});

function setup(triggers: LocalGraphTrigger[], condition: HostCondition = SIGNED_IN) {
  const host = fakeHost();
  const model: TriggerHost = createTriggerHost({ projectPath: "C:/p", call: host.invoker });
  model.setLocal(triggers);
  model.setCondition(condition);
  return { host, model };
}

/** Reads `name` once with Check again, answered with `outcome`. */
async function checked(host: ReturnType<typeof fakeHost>, model: TriggerHost, name: string, outcome: CallOutcome) {
  void model.checkAgain(name);
  await settle();
  host.answer(`show ${name}`, outcome);
  await settle();
  return model.trigger(name);
}

test("a name the host refuses shows with its rule even offline, and is never sent to praxis", async () => {
  const { host, model } = setup([local("Night_ly", { nameProblem: "the rule" })], { state: "hostUnreachable" });
  assert.deepEqual(model.trigger("Night_ly").state, { kind: "nameRefused", rule: "the rule" });
  model.setCondition(SIGNED_IN);
  void model.groupShown();
  await settle();
  host.answer("list", listRecord(["Night_ly"]));
  await settle();
  void model.checkAgain("Night_ly");
  await settle();
  assert.deepEqual(host.open(), []);
  assert.deepEqual(model.trigger("Night_ly").state, { kind: "nameRefused", rule: "the rule" });
});

test("a graph trigger missing from the host's list is not submitted and gets no show, and so is one the host answers NOT_FOUND", async () => {
  const { host, model } = setup([local("nightly"), local("weekly")]);
  const listedAt = Date.now();
  void model.groupShown();
  await settle();
  host.answer("list", listRecord(["weekly"]));
  await settle();
  assert.deepEqual(host.open(), ["show weekly"]);
  assert.deepEqual(model.trigger("nightly").state, { kind: "notSubmitted" });
  assert.equal(model.trigger("nightly").checkedAt, listedAt);
  host.answer("show weekly", triggerNotFound());
  await settle();
  assert.deepEqual(model.trigger("weekly").state, { kind: "notSubmitted" });
});

test("a retired graph trigger is retired, even with a candidate waiting", async () => {
  const { host, model } = setup([local("on-push")]);
  // The recorded retired trigger has revision 2 pending over its retired revision 1.
  const view = await checked(host, model, "on-push", triggerShow("triggers show: retired", "on-push"));
  assert.deepEqual(view.state, { kind: "retired", revision: 1 });
});

test("a pending candidate is waiting for admission, as the newest candidate's revision, with its admission page", async () => {
  const { host, model } = setup([local("nightly")]);
  const view = await checked(host, model, "nightly", triggerShow("triggers show: a candidate", "nightly"));
  assert.deepEqual(view.state, { kind: "candidate", revision: 1 });
  assert.equal(view.admissionPageAddress, "https://praxis-rqse44l43d.localhost:51120/#graph-trigger=nightly&revision=1");
  assert.equal(view.current, null);
  assert.equal(view.hostEnabled, null, "a trigger the owner hasn't admitted has no enabled state to compare");
});

test("an admitted revision whose digest isn't the saved files' at that revision differs from host", async () => {
  const { host, model } = setup([local("on-push")]);
  host.digestOf = () => OTHER_DIGEST;
  // Disabled too, which ranks below differs.
  const view = await checked(host, model, "on-push", enabled("on-push", { enabled: false }));
  assert.deepEqual(view.state, { kind: "differs", revision: 1 });
  assert.equal(view.compared, true);
  // The saved files were digested at the host's current revision.
  assert.deepEqual(host.calls.filter((c) => c.command === "praxis_trigger_digest").map((c) => c.args), [{ projectPath: "C:/p", name: "on-push", revision: 1 }]);
});

test("an admitted revision the owner disabled is admitted, disabled", async () => {
  const { host, model } = setup([local("on-push")]);
  // The recorded disabled trigger, its pending revision 2 rejected so revision 1's state shows.
  const view = await checked(host, model, "on-push", triggerShow("triggers show: admitted but disabled", "on-push", { revisions: overAdmitted("REJECTED") }));
  assert.deepEqual(view.state, { kind: "disabled", revision: 1 });
  assert.equal(view.hostEnabled, false);
});

test("an admitted and enabled revision the host says can't fire is blocked, with the host's codes but not its own state's", async () => {
  const { host, model } = setup([local("later")]);
  host.digestOf = () => "sha256:e026827a30b2ca16ece998b7848f5e4114195ca4972cbfec3d0c6488aa124f3f";
  const view = await checked(host, model, "later", triggerShow("triggers show: admitted but blocked", "later"));
  assert.deepEqual(view.state, { kind: "blocked", revision: 1, blockers: ["TRIGGER_NOT_YET_VALID"] });
  const source = await checked(host, model, "later", triggerShow("triggers show: admitted but blocked", "later", { blockedBy: ["EVENT_SOURCE_DISABLED", "WORKFLOW_NO_ADMITTED_REVISION"] }));
  assert.deepEqual(source.state, { kind: "blocked", revision: 1, blockers: ["EVENT_SOURCE_DISABLED", "WORKFLOW_NO_ADMITTED_REVISION"] });
});

test("an admitted and enabled revision nothing blocks is admitted, and a rejected or withdrawn candidate falls back to it", async () => {
  const { host, model } = setup([local("on-push")]);
  assert.deepEqual((await checked(host, model, "on-push", enabled("on-push"))).state, { kind: "admitted", revision: 1 });
  for (const status of ["REJECTED", "WITHDRAWN"]) {
    const view = await checked(host, model, "on-push", enabled("on-push", { revisions: overAdmitted(status), latestRevision: 2 }));
    assert.deepEqual(view.state, { kind: "admitted", revision: 1 }, status);
  }
});

test("a graph trigger whose every candidate was rejected or withdrawn, with none admitted, is not submitted", async () => {
  const { host, model } = setup([local("nightly")]);
  const candidate = recordedTrigger("triggers show: a candidate");
  const gone = triggerShow("triggers show: a candidate", "nightly", {
    revisions: (candidate.revisions as Revision[]).map((r) => ({ ...r, status: "WITHDRAWN" })),
    pendingCount: 0,
    admissionPageAddress: null,
  });
  assert.deepEqual((await checked(host, model, "nightly", gone)).state, { kind: "notSubmitted" });
});

test("the eight states are ranked worst first, and each shows only when every worse one is ruled out", async () => {
  assert.deepEqual(TRIGGER_STATE_ORDER, ["nameRefused", "notSubmitted", "retired", "candidate", "differs", "disabled", "blocked", "admitted"]);
  const { host, model } = setup([local("on-push")]);
  // Every condition holds at first: retired, a candidate waiting, the files differ, disabled, blocked.
  const conditions = { retired: true, candidate: true, differs: true, disabled: true, blocked: true };
  const shown: string[] = [];
  for (const peel of ["retired", "candidate", "differs", "disabled", "blocked", null] as const) {
    host.digestOf = () => (conditions.differs ? OTHER_DIGEST : ON_PUSH_DIGEST);
    model.setLocal([local("on-push")]);
    await settle();
    const view = await checked(
      host,
      model,
      "on-push",
      enabled("on-push", {
        state: conditions.retired ? "RETIRED" : "ACTIVE",
        enabled: !conditions.disabled,
        revisions: overAdmitted(conditions.candidate ? "CANDIDATE" : "REJECTED"),
        blockedBy: conditions.blocked ? ["EVENT_SOURCE_DISABLED"] : [],
      }),
    );
    shown.push(view.state.kind);
    if (peel) conditions[peel] = false;
  }
  assert.deepEqual(shown, TRIGGER_STATE_ORDER.slice(2));
  // The two worse ones: a name the host refuses beats everything, and not submitted the rest.
  model.setLocal([local("on-push", { nameProblem: "the rule" })]);
  assert.equal(model.trigger("on-push").state.kind, "nameRefused");
  model.setLocal([local("on-push")]);
  assert.equal((await checked(host, model, "on-push", triggerNotFound())).state.kind, "notSubmitted");
});

test("without either digest there is no Differs, and the view gives the current revision and its submit time", async () => {
  const { host, model } = setup([local("on-push")]);
  host.digestOf = () => OTHER_DIGEST;
  // The host's revision carries no digest, as a host without one would print it.
  const noDigest = (recordedTrigger("triggers show: admitted and enabled").revisions as Revision[]).map(({ digest: _, ...r }) => r);
  const hostless = await checked(host, model, "on-push", enabled("on-push", { revisions: noDigest }));
  assert.deepEqual(hostless.state, { kind: "admitted", revision: 1 });
  assert.equal(hostless.compared, false);
  assert.deepEqual(hostless.current, { revision: 1, submittedAt: "2026-11-09T15:37:09.755Z" });
  // Quay can't compute the saved files' digest.
  host.digestOf = () => null;
  const localless = await checked(host, model, "on-push", enabled("on-push"));
  assert.equal(localless.state.kind, "admitted");
  assert.equal(localless.compared, false);
});

test("a read shows its state only once the saved files' digest is in, and a digest asked before a newer one never replaces it", async () => {
  const { host, model } = setup([local("on-push")]);
  host.holdDigests = true;
  void model.checkAgain("on-push");
  await settle();
  host.answer("show on-push", enabled("on-push"));
  await settle();
  assert.deepEqual(host.open(), ["digest on-push 1"]);
  assert.deepEqual(model.trigger("on-push").state, { kind: "unknown", why: "notChecked" });
  assert.equal(model.trigger("on-push").checking, true);
  host.answer("digest on-push 1", OTHER_DIGEST);
  await settle();
  assert.deepEqual(model.trigger("on-push").state, { kind: "differs", revision: 1 });
  assert.equal(model.trigger("on-push").checking, false);
  // A new listing digests the saved files again. The first answer comes last and is ignored,
  // and until the new one is in, the last one stands.
  model.setLocal([local("on-push")]);
  model.setLocal([local("on-push")]);
  await settle();
  assert.deepEqual(host.open(), ["digest on-push 1", "digest on-push 1"]);
  assert.equal(model.trigger("on-push").state.kind, "differs");
  host.answer("digest on-push 1", ON_PUSH_DIGEST, "newest");
  await settle();
  assert.deepEqual(model.trigger("on-push").state, { kind: "admitted", revision: 1 });
  host.answer("digest on-push 1", OTHER_DIGEST);
  await settle();
  assert.deepEqual(model.trigger("on-push").state, { kind: "admitted", revision: 1 });
});

test("a saved files' digest at another revision is never compared with the current one, whichever answer comes last", async () => {
  const { host, model } = setup([local("on-push")]);
  host.digestOf = (_name, revision) => (revision === 1 ? OTHER_DIGEST : ON_PUSH_DIGEST);
  assert.equal((await checked(host, model, "on-push", enabled("on-push"))).state.kind, "differs");
  // The owner admits revision 2. While its digest is in flight, a new listing asks for the
  // digest at revision 1, the current one of the reading it has, and that ask comes last.
  host.holdDigests = true;
  const two = [{ ...overAdmitted("ADMITTED")[0], digest: ON_PUSH_DIGEST }, overAdmitted("ADMITTED")[1]];
  void model.checkAgain("on-push");
  await settle();
  host.answer("show on-push", enabled("on-push", { currentRevision: 2, latestRevision: 2, revisions: two }));
  await settle();
  model.setLocal([local("on-push")]);
  await settle();
  assert.deepEqual(host.open(), ["digest on-push 2", "digest on-push 1"]);
  host.answer("digest on-push 2", ON_PUSH_DIGEST);
  host.answer("digest on-push 1", OTHER_DIGEST);
  await settle();
  // Revision 1's digest, which differs, is kept apart from revision 2's, which is compared.
  assert.deepEqual(model.trigger("on-push").state, { kind: "admitted", revision: 2 });
  assert.equal(model.trigger("on-push").compared, true);
  assert.deepEqual(host.open(), []);
});

test("the view gives the host's and the saved file's enabled, and only an active trigger with a current revision has the host's", async () => {
  const { host, model } = setup([local("on-push", { enabled: true })]);
  const disabled = await checked(host, model, "on-push", triggerShow("triggers show: admitted but disabled", "on-push", { revisions: overAdmitted("REJECTED") }));
  assert.deepEqual([disabled.hostEnabled, disabled.savedEnabled], [false, true]);
  const retired = await checked(host, model, "on-push", triggerShow("triggers show: retired", "on-push"));
  assert.equal(retired.hostEnabled, null);
  model.setLocal([local("on-push", { enabled: null })]);
  assert.equal(model.trigger("on-push").savedEnabled, null);
});

test("the view lists the host's revisions newest first, each with its status, base and submit time, and marks the current one", async () => {
  const { host, model } = setup([local("on-push")]);
  const view = await checked(host, model, "on-push", enabled("on-push", { revisions: overAdmitted("REJECTED"), nextBefore: 1 }));
  assert.deepEqual(
    view.revisions.map((r) => [r.revision, r.status, r.baseRevision, r.submittedAt, r.current]),
    [
      [2, "REJECTED", 1, "2026-11-09T15:37:11.112Z", false],
      [1, "ADMITTED", null, "2026-11-09T15:37:09.755Z", true],
    ],
  );
  assert.equal(view.olderRevisions, true);
  assert.deepEqual(model.trigger("never-read").revisions, []);
});

test("only local graph triggers have a host state: a trigger without a saved target isn't one, and gets no read", async () => {
  const { host, model } = setup([local("on-push")]);
  assert.equal(model.has("on-push"), true);
  assert.equal(model.has("local-only"), false);
  void model.checkAgain("local-only");
  await settle();
  assert.deepEqual(host.open(), []);
});

test("the first show of the group reads every list page, then shows each listed local graph trigger two at a time; Check host reads it all again", async () => {
  const { host, model } = setup([local("a"), local("b"), local("c")]);
  void model.groupShown();
  await settle();
  assert.equal(host.calls[0].args.limit, 100);
  host.answer("list", listRecord(["a", "b"], "b"));
  await settle();
  host.answer("list after b", listRecord(["c", "remote-only"]));
  await settle();
  assert.deepEqual(host.open(), ["show a", "show b"]);
  host.answer("show a", enabled("a"));
  await settle();
  assert.deepEqual(host.open(), ["show b", "show c"]);
  host.answer("show b", enabled("b"));
  host.answer("show c", enabled("c"));
  await settle();
  assert.deepEqual(["a", "b", "c"].map((n) => model.trigger(n).state.kind), ["admitted", "admitted", "admitted"]);
  void model.groupShown();
  await settle();
  assert.deepEqual(host.open(), []);
  void model.checkHost();
  await settle();
  assert.deepEqual(host.open(), ["list"]);
});

test("a reading turns muted after ten minutes, and a failing host condition drops every reading", async () => {
  const { host, model } = setup([local("on-push")]);
  let wakes = 0;
  model.subscribe(() => (wakes += 1));
  assert.equal((await checked(host, model, "on-push", enabled("on-push"))).muted, false);
  const before = wakes;
  mock.timers.tick(MUTED_AFTER_MS);
  assert.equal(wakes, before + 1, "listeners are told when the reading turns muted");
  assert.deepEqual({ ...model.trigger("on-push") }, { ...model.trigger("on-push"), state: { kind: "admitted", revision: 1 }, muted: true });
  model.setCondition({ state: "hostUnreachable" });
  assert.deepEqual(model.trigger("on-push").state, { kind: "unknown", why: "host" });
  model.setCondition(SIGNED_IN);
  assert.deepEqual(model.trigger("on-push").state, { kind: "unknown", why: "notChecked" });
  assert.deepEqual(model.trigger("on-push").revisions, []);
});

test("an answer to a read asked before the host went offline is ignored", async () => {
  const { host, model } = setup([local("on-push")]);
  void model.checkAgain("on-push");
  await settle();
  model.setCondition({ state: "hostUnreachable" });
  model.setCondition(SIGNED_IN);
  host.answer("show on-push", enabled("on-push"));
  await settle();
  assert.deepEqual(model.trigger("on-push").state, { kind: "unknown", why: "notChecked" });
});

const shows = (host: ReturnType<typeof fakeHost>) => host.calls.filter((c) => c.command === "praxis_host_trigger_show").length;

test("while a form shows a pending candidate, it is read every 15 s, and the poll stops when the form leaves the screen or the candidate is decided", async () => {
  const { host, model } = setup([local("nightly"), local("on-push")]);
  const candidate = triggerShow("triggers show: a candidate", "nightly");
  await checked(host, model, "nightly", candidate);
  model.watch("nightly");
  mock.timers.tick(CANDIDATE_POLL_MS - 1);
  await settle();
  assert.deepEqual(host.open(), []);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(host.open(), ["show nightly"]);
  host.answer("show nightly", candidate);
  await settle();
  const read = shows(host);
  model.watch(null);
  mock.timers.tick(10 * CANDIDATE_POLL_MS);
  await settle();
  assert.equal(shows(host), read, "no read after the form left the screen");
  // An admitted trigger isn't polled.
  await checked(host, model, "on-push", enabled("on-push"));
  model.watch("on-push");
  mock.timers.tick(10 * CANDIDATE_POLL_MS);
  await settle();
  assert.deepEqual(host.open(), []);
});

test("disposing cancels every praxis call in flight and keeps nothing", async () => {
  const { host, model } = setup([local("a"), local("b")]);
  void model.checkAgain("a");
  void model.checkAgain("b");
  await settle();
  model.dispose();
  assert.deepEqual(host.cancelled, host.calls.map((c) => c.args.callId));
  host.answer("show a", enabled("a"));
  await settle();
  assert.deepEqual(model.trigger("a").state, { kind: "unknown", why: "notChecked" });
});

test("event sources are queried on group shown / checkHost, parsed and cached as a map", async () => {
  const { host, model } = setup([local("on-push")]);
  host.holdEventSources = true;
  void model.groupShown();
  await settle();
  assert.ok(host.open().includes("event-sources"));
  host.answer("list", listRecord(["on-push"]));
  host.answer(
    "event-sources",
    eventSourcesRecord([
      { name: "github", state: "ENABLED", currentRevision: 1, eventTypes: ["push", "pull_request"] },
      { name: "stripe", state: "DISABLED", currentRevision: 2, eventTypes: ["payment_intent.succeeded"] },
    ]),
  );
  await settle();
  host.answer("show on-push", enabled("on-push"));
  await settle();

  const sources = model.eventSources();
  assert.equal(sources.size, 2);
  assert.deepEqual(sources.get("github"), {
    name: "github",
    state: "ENABLED",
    currentRevision: 1,
    eventTypes: ["push", "pull_request"],
  });
  assert.deepEqual(sources.get("stripe"), {
    name: "stripe",
    state: "DISABLED",
    currentRevision: 2,
    eventTypes: ["payment_intent.succeeded"],
  });
  assert.deepEqual(model.trigger("on-push").eventSources?.get("github"), sources.get("github"));
  assert.equal(model.eventSourcesView().online, true);
  assert.equal(model.eventSourcesView().checking, false);
});

test("event sources pagination follows nextAfter up to MAX_LIST_PAGES", async () => {
  const { host, model } = setup([local("on-push")]);
  host.holdEventSources = true;
  void model.checkHost();
  await settle();
  host.answer("list", listRecord([]));
  assert.ok(host.open().includes("event-sources"));
  host.answer(
    "event-sources",
    eventSourcesRecord([{ name: "src-1", state: "ENABLED", currentRevision: 1, eventTypes: ["event.one"] }], "src-1"),
  );
  await settle();
  assert.ok(host.open().includes("event-sources after src-1"));
  host.answer(
    "event-sources after src-1",
    eventSourcesRecord([{ name: "src-2", state: "ENABLED", currentRevision: 2, eventTypes: ["event.two"] }], null),
  );
  await settle();

  const sources = model.eventSources();
  assert.equal(sources.size, 2);
  assert.ok(sources.has("src-1"));
  assert.ok(sources.has("src-2"));
});

test("event sources pagination caps at MAX_LIST_PAGES without infinite loop", async () => {
  const { host, model } = setup([]);
  host.holdEventSources = true;
  void model.checkHost();
  await settle();
  host.answer("list", listRecord([]));

  let cursor: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const labelToAnswer: string = cursor ? `event-sources after ${cursor}` : "event-sources";
    assert.ok(host.open().includes(labelToAnswer));
    const next = `cursor-${page + 1}`;
    host.answer(labelToAnswer, eventSourcesRecord([{ name: `s-${page}`, state: "ENABLED", currentRevision: 1, eventTypes: [] }], next));
    cursor = next;
    await settle();
  }
  assert.deepEqual(host.open(), []);
  assert.equal(model.eventSources().size, MAX_LIST_PAGES);
});

test("checkAgain refreshes event sources alongside the trigger reading", async () => {
  const { host, model } = setup([local("on-push")]);
  host.holdEventSources = true;
  void model.groupShown();
  await settle();
  host.answer("list", listRecord(["on-push"]));
  host.answer("event-sources", eventSourcesRecord([{ name: "github", state: "ENABLED", currentRevision: 1, eventTypes: ["push"] }]));
  await settle();
  host.answer("show on-push", enabled("on-push"));
  await settle();
  assert.equal(model.eventSources().size, 1);

  void model.checkAgain("on-push");
  await settle();
  assert.ok(host.open().includes("show on-push"));
  assert.ok(host.open().includes("event-sources"));
  host.answer("show on-push", enabled("on-push"));
  host.answer(
    "event-sources",
    eventSourcesRecord([
      { name: "github", state: "ENABLED", currentRevision: 1, eventTypes: ["push"] },
      { name: "gitlab", state: "ENABLED", currentRevision: 1, eventTypes: ["tag"] },
    ]),
  );
  await settle();

  assert.equal(model.eventSources().size, 2);
  assert.ok(model.eventSources().has("gitlab"));
});

test("when host is offline or condition fails, event sources reflects offline state and invalidates cache without throwing", async () => {
  const { host, model } = setup([local("on-push")], { state: "hostUnreachable" });
  assert.equal(model.eventSources().size, 0);
  assert.equal(model.eventSourcesView().online, false);

  model.setCondition(SIGNED_IN);
  host.holdEventSources = true;
  void model.checkHost();
  await settle();
  host.answer("list", listRecord([]));
  host.answer("event-sources", eventSourcesRecord([{ name: "github", state: "ENABLED", currentRevision: 1, eventTypes: ["push"] }]));
  await settle();
  assert.equal(model.eventSources().size, 1);

  // Go failing condition (notSignedIn)
  model.setCondition({ state: "notSignedIn" });
  assert.equal(model.eventSources().size, 0);
  assert.equal(model.eventSourcesView().online, false);

  void model.checkAgain("on-push");
  await settle();
  host.answer("show on-push", { kind: "notSignedIn", message: "sign in first" });
  host.answer("event-sources", { kind: "notSignedIn", message: "sign in first" });
  await settle();
  assert.equal(model.eventSources().size, 0);
  assert.equal(model.eventSourcesView().online, false);
});
