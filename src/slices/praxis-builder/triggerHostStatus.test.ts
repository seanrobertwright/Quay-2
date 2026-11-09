/// <reference types="node" />
// What the Triggers list and the trigger form show of a graph trigger's state on the host (#475):
// the badge after the git badge, the status line with the missing-digest fallback and the
// enabled-mismatch note, and the Revisions panel's rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateTime } from "../../lib/dates.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { GraphTriggerHostView, TriggerHostState } from "./triggerHost.ts";
import { triggerRevisionRows, triggerRowBadges, triggerStatusLine } from "./triggerHostStatus.ts";

const NOW = 1_800_000_000_000;
const SIGNED_IN: HostCondition = { state: "signedIn" };
const SUBMITTED = "2026-11-09T15:37:09.755Z";
const SUBMITTED_MS = Date.UTC(2026, 10, 9, 15, 37, 9, 755);

const view = (state: TriggerHostState, extra: Partial<GraphTriggerHostView> = {}): GraphTriggerHostView => ({
  state,
  checkedAt: NOW - 3 * 60_000,
  muted: false,
  checking: false,
  admissionPageAddress: null,
  current: { revision: 1, submittedAt: SUBMITTED },
  compared: true,
  hostEnabled: true,
  savedEnabled: true,
  revisions: [],
  olderRevisions: false,
  ...extra,
});

test("each of the eight states has its own label on the status line, and the host's reason where it gave one", () => {
  const line = (state: TriggerHostState) => {
    const l = triggerStatusLine(view(state), SIGNED_IN, NOW);
    return [l.label, l.reason];
  };
  assert.deepEqual(line({ kind: "nameRefused", rule: "the rule" }), ["Name the host refuses", "the rule"]);
  assert.deepEqual(line({ kind: "notSubmitted" }), ["Not submitted", null]);
  assert.deepEqual(line({ kind: "retired", revision: 1 }), ["Retired", "It was retired on the host. It fires again only once the owner admits a new revision."]);
  assert.deepEqual(line({ kind: "candidate", revision: 3 }), ["Candidate waiting for admission (revision 3)", "The owner admits or rejects it in the browser."]);
  assert.deepEqual(line({ kind: "differs", revision: 1 }), ["Differs from host", "The saved files aren't admitted revision 1's."]);
  assert.deepEqual(line({ kind: "disabled", revision: 1 }), ["Admitted, disabled", "It doesn't fire until the owner enables it in the browser."]);
  assert.deepEqual(line({ kind: "blocked", revision: 1, blockers: ["EVENT_SOURCE_DISABLED", "WORKFLOW_NO_ADMITTED_REVISION"] }), [
    "Admitted, blocked",
    "It can't fire: its event source is disabled (EVENT_SOURCE_DISABLED); its target graph workflow has no admitted revision (WORKFLOW_NO_ADMITTED_REVISION).",
  ]);
  assert.deepEqual(line({ kind: "admitted", revision: 1 }), ["Admitted, enabled", null]);
});

test("a blocker code Quay has no words for is shown as the host gave it", () => {
  const line = triggerStatusLine(view({ kind: "blocked", revision: 1, blockers: ["SOMETHING_NEW"] }), SIGNED_IN, NOW);
  assert.equal(line.reason, "It can't fire: SOMETHING_NEW.");
});

test("each state has its own look, and its colour never carries it alone", () => {
  const looks = (["nameRefused", "notSubmitted", "retired", "candidate", "differs", "disabled", "blocked", "admitted"] as const).map((kind) => {
    const state = (kind === "nameRefused" ? { kind, rule: "r" } : kind === "blocked" ? { kind, revision: 1, blockers: ["X"] } : { kind, revision: 1 }) as TriggerHostState;
    const line = triggerStatusLine(view(state), SIGNED_IN, NOW);
    return [line.look, line.tone];
  });
  assert.deepEqual(looks, [
    ["nameRefused", "error"],
    ["notSubmitted", "attention"],
    ["retired", "attention"],
    ["candidate", "attention"],
    ["differs", "attention"],
    ["disabled", "attention"],
    ["blocked", "attention"],
    ["admitted", "muted"],
  ]);
});

test("the status line says how long ago it was checked, offers Check again, and Open in browser for a candidate's admission page", () => {
  const address = "https://praxis-rqse44l43d.localhost:51120/#graph-trigger=nightly&revision=1";
  const line = triggerStatusLine(view({ kind: "candidate", revision: 1 }, { admissionPageAddress: address }), SIGNED_IN, NOW);
  assert.equal(line.checked, "checked 3 min ago");
  assert.equal(line.checkAgain, true);
  assert.equal(line.admissionPage, address);
  assert.equal(triggerStatusLine(view({ kind: "admitted", revision: 1 }, { admissionPageAddress: address }), SIGNED_IN, NOW).admissionPage, null);
  assert.equal(triggerStatusLine(view({ kind: "nameRefused", rule: "r" }), SIGNED_IN, NOW).checkAgain, false);
  const muted = triggerStatusLine(view({ kind: "admitted", revision: 1 }, { muted: true, checkedAt: NOW - 12 * 60_000 }), SIGNED_IN, NOW);
  assert.equal(muted.checked, "checked 12 min ago, may be out of date");
});

test("without a digest to compare, the status line gives the current revision and its submit time instead", () => {
  for (const state of [{ kind: "admitted", revision: 1 }, { kind: "disabled", revision: 1 }, { kind: "blocked", revision: 1, blockers: ["X"] }] as TriggerHostState[]) {
    const line = triggerStatusLine(view(state, { compared: false }), SIGNED_IN, NOW);
    assert.equal(line.revision, `Revision 1, submitted ${formatDateTime(SUBMITTED_MS)}`, state.kind);
  }
  const untimed = triggerStatusLine(view({ kind: "admitted", revision: 1 }, { compared: false, current: { revision: 1, submittedAt: null } }), SIGNED_IN, NOW);
  assert.equal(untimed.revision, "Revision 1, submit time not given");
  assert.equal(triggerStatusLine(view({ kind: "admitted", revision: 1 }), SIGNED_IN, NOW).revision, null, "nothing to add once compared");
  assert.equal(triggerStatusLine(view({ kind: "candidate", revision: 2 }, { compared: false }), SIGNED_IN, NOW).revision, null, "a candidate's state doesn't rest on the digest");
});

test("when the host's enabled state differs from the saved file's, a note says disabling on the host doesn't change the file", () => {
  const note = (hostEnabled: boolean | null, savedEnabled: boolean | null) =>
    triggerStatusLine(view({ kind: hostEnabled === false ? "disabled" : "admitted", revision: 1 }, { hostEnabled, savedEnabled }), SIGNED_IN, NOW).enabledNote;
  assert.equal(
    note(false, true),
    "On the host it is disabled, and the saved file says enabled. Disabling a trigger on the host doesn't change its file, and the file reaches the host only as a revision the owner admits.",
  );
  assert.equal(
    note(true, false),
    "On the host it is enabled, and the saved file says disabled. Disabling a trigger on the host doesn't change its file, and the file reaches the host only as a revision the owner admits.",
  );
  assert.equal(note(true, true), null);
  assert.equal(note(false, false), null);
  assert.equal(note(null, true), null, "no host enabled state to compare");
  assert.equal(note(false, null), null, "no saved enabled to compare");
});

test("while the host condition fails, the status line names it and has nothing to check again", () => {
  const line = triggerStatusLine(view({ kind: "unknown", why: "host" }, { hostEnabled: false }), { state: "hostUnreachable" }, NOW);
  assert.match(line.label, /^Host state unknown: /);
  assert.equal(line.checkAgain, false);
  assert.equal(line.enabledNote, null);
  const failed = triggerStatusLine(view({ kind: "unknown", why: "failed", message: "praxis said no." }), SIGNED_IN, NOW);
  assert.deepEqual([failed.label, failed.reason, failed.look], ["Couldn't check", "praxis said no.", "failed"]);
});

test("a graph trigger's row has its git badge first, then its host badge, and none while its state is unknown", () => {
  const badges = triggerRowBadges("on-push", "modified", view({ kind: "disabled", revision: 1 }), NOW);
  assert.deepEqual(
    badges.map((b) => (b.kind === "git" ? b.status : b.badge.text)),
    ["modified", "on-push on the host: Admitted, disabled"],
  );
  const blocked = triggerRowBadges("on-push", undefined, view({ kind: "blocked", revision: 1, blockers: ["EVENT_SOURCE_DISABLED"] }), NOW);
  assert.equal(blocked[0].kind === "host" && blocked[0].badge.title, "Admitted, blocked. It can't fire: its event source is disabled (EVENT_SOURCE_DISABLED).");
  assert.deepEqual(triggerRowBadges("on-push", undefined, view({ kind: "unknown", why: "notChecked" }), NOW), []);
  assert.equal(triggerRowBadges("on-push", undefined, view({ kind: "unknown", why: "failed" }), NOW)[0].kind, "host");
});

test("the Revisions panel's rows give each revision's status, base, submit time and which is current", () => {
  const rows = triggerRevisionRows(
    view(
      { kind: "admitted", revision: 1 },
      {
        revisions: [
          { revision: 2, status: "CANDIDATE", baseRevision: 1, digest: null, submittedAt: SUBMITTED, current: false },
          { revision: 1, status: "ADMITTED", baseRevision: null, digest: null, submittedAt: null, current: true },
          { revision: 3, status: "SOMETHING_NEW", baseRevision: null, digest: null, submittedAt: "not a time", current: false },
        ],
      },
    ),
  );
  assert.deepEqual(rows, [
    { revision: 2, status: "Candidate, waiting for admission", base: "Revision 1", submitted: formatDateTime(SUBMITTED_MS), current: false },
    { revision: 1, status: "Admitted", base: "None", submitted: "Not given by the host", current: true },
    { revision: 3, status: "SOMETHING_NEW", base: "None", submitted: "not a time", current: false },
  ]);
});
