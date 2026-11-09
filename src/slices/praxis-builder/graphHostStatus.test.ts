/// <reference types="node" />
// What the Graph workflows list and the graph workflow form show of a graph workflow's state on
// the host (#461): the badge after the git badge, the status line with the missing-digest
// fallback, and the Revisions panel's rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateTime } from "../../lib/dates.ts";
import type { GraphHostState, GraphWorkflowHostView } from "./graphHost.ts";
import { graphRowBadges, graphStatusLine, revisionRows } from "./graphHostStatus.ts";
import type { HostCondition } from "./praxisHost.ts";

const NOW = 1_800_000_000_000;
const SIGNED_IN: HostCondition = { state: "signedIn" };
const SUBMITTED = "2026-11-08T23:30:15.433Z";
const SUBMITTED_MS = Date.UTC(2026, 10, 8, 23, 30, 15, 433);

const view = (state: GraphHostState, extra: Partial<GraphWorkflowHostView> = {}): GraphWorkflowHostView => ({
  state,
  checkedAt: NOW - 3 * 60_000,
  muted: false,
  checking: false,
  admissionPageAddress: null,
  current: { revision: 1, submittedAt: SUBMITTED },
  compared: true,
  differsFromCurrent: false,
  reviewDigest: null,
  revisions: [],
  olderRevisions: false,
  ...extra,
});

test("each of the seven states has its own label on the status line, and the host's reason where it gave one", () => {
  const line = (state: GraphHostState) => {
    const l = graphStatusLine(view(state), SIGNED_IN, NOW);
    return [l.label, l.reason];
  };
  assert.deepEqual(line({ kind: "nameRefused", rule: "the rule" }), ["Name the host refuses", "the rule"]);
  assert.deepEqual(line({ kind: "notSubmitted" }), ["Not submitted", null]);
  assert.deepEqual(line({ kind: "retired", revision: 1 }), ["Retired", "The owner retired it. A new revision the owner admits makes it active again."]);
  assert.deepEqual(line({ kind: "candidate", revision: 3 }), ["Candidate waiting for admission (revision 3)", "The owner admits or rejects it in the browser."]);
  assert.deepEqual(line({ kind: "differs", revision: 1 }), ["Differs from host", "The saved files aren't admitted revision 1's."]);
  assert.deepEqual(line({ kind: "notReady", revision: 1, reason: "build: no agent." }), ["Admitted, not ready", "build: no agent."]);
  assert.deepEqual(line({ kind: "admitted", revision: 1 }), ["Admitted", null]);
});

test("the status line says how long ago it was checked, offers Check again, and Open in browser for a candidate's admission page", () => {
  const address = "https://praxis-nmdro7k3gf.localhost:49889/#graph-workflow=ship&revision=2";
  const line = graphStatusLine(view({ kind: "candidate", revision: 2 }, { admissionPageAddress: address }), SIGNED_IN, NOW);
  assert.equal(line.checked, "checked 3 min ago");
  assert.equal(line.checkAgain, true);
  assert.equal(line.admissionPage, address);
  // Only a candidate's page is offered, and Check again never for a name praxis isn't sent.
  assert.equal(graphStatusLine(view({ kind: "admitted", revision: 1 }, { admissionPageAddress: address }), SIGNED_IN, NOW).admissionPage, null);
  assert.equal(graphStatusLine(view({ kind: "nameRefused", rule: "r" }), SIGNED_IN, NOW).checkAgain, false);
  const muted = graphStatusLine(view({ kind: "admitted", revision: 1 }, { muted: true, checkedAt: NOW - 12 * 60_000 }), SIGNED_IN, NOW);
  assert.equal(muted.checked, "checked 12 min ago, may be out of date");
});

test("without a digest to compare, the status line gives the current revision and its submit time instead", () => {
  const line = graphStatusLine(view({ kind: "admitted", revision: 1 }, { compared: false }), SIGNED_IN, NOW);
  assert.equal(line.label, "Admitted");
  assert.equal(line.revision, `Revision 1, submitted ${formatDateTime(SUBMITTED_MS)}`);
  assert.equal(graphStatusLine(view({ kind: "admitted", revision: 1 }), SIGNED_IN, NOW).revision, null, "not when Differs could be told");
  const unreadable = graphStatusLine(view({ kind: "notReady", revision: 4, reason: "r" }, { compared: false, current: { revision: 4, submittedAt: null } }), SIGNED_IN, NOW);
  assert.equal(unreadable.revision, "Revision 4, submit time not given");
});

test("while the host can't be used, the line says why and leaves rereading to Check host", () => {
  const line = graphStatusLine(view({ kind: "unknown", why: "host" }, { checkedAt: null }), { state: "hostUnreachable" }, NOW);
  assert.equal(line.label, "Host state unknown: Host down");
  assert.equal(line.checkAgain, false);
  const failed = graphStatusLine(view({ kind: "unknown", why: "failed", message: "praxis broke." }), SIGNED_IN, NOW);
  assert.deepEqual([failed.label, failed.reason, failed.checkAgain], ["Couldn't check", "praxis broke.", true]);
});

test("a row's host badge comes after its git badge, and no badge shows before a reading", () => {
  const badges = graphRowBadges("ship", "modified", view({ kind: "candidate", revision: 2 }), NOW);
  assert.deepEqual(
    badges.map((b) => b.kind),
    ["git", "host"],
  );
  const host = badges[1];
  assert.ok(host.kind === "host");
  assert.equal(host.badge.text, "ship on the host: Candidate waiting for admission (revision 2)");
  assert.equal(host.badge.tone, "attention");
  assert.deepEqual(graphRowBadges("ship", undefined, view({ kind: "unknown", why: "notChecked" }), NOW), []);
  const muted = graphRowBadges("ship", undefined, view({ kind: "admitted", revision: 1 }, { muted: true, checkedAt: NOW - 12 * 60_000 }), NOW)[0];
  assert.ok(muted.kind === "host");
  assert.equal(muted.badge.text, "ship on the host: Admitted, may be out of date");
});

test("the Revisions panel lists each revision's number, status, submitted and decided times, and which is current", () => {
  const rows = revisionRows(
    view(
      { kind: "admitted", revision: 1 },
      {
        revisions: [
          { revision: 2, status: "REJECTED", bundleDigest: null, submittedAt: "2026-11-08T23:31:00Z", decidedAt: null, current: false },
          { revision: 1, status: "CURRENT", bundleDigest: null, submittedAt: SUBMITTED, decidedAt: "not a time", current: true },
        ],
      },
    ),
  );
  assert.deepEqual(rows, [
    { revision: 2, status: "Rejected", submitted: formatDateTime(Date.UTC(2026, 10, 8, 23, 31)), decided: "Not given by the host", current: false },
    { revision: 1, status: "Current", submitted: formatDateTime(SUBMITTED_MS), decided: "not a time", current: true },
  ]);
  const statuses = ["CANDIDATE", "ADMITTED", "WITHDRAWN", "RETIRED", "SOMETHING_NEW"].map(
    (status) => revisionRows(view({ kind: "admitted", revision: 1 }, { revisions: [{ revision: 1, status, bundleDigest: null, submittedAt: null, decidedAt: null, current: false }] }))[0].status,
  );
  assert.deepEqual(statuses, ["Candidate, waiting for admission", "Admitted", "Withdrawn", "Retired", "SOMETHING_NEW"]);
});
