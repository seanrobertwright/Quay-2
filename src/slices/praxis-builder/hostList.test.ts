/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOST_ONLY_LIMIT, hostBadge, hostGroupHeader, hostOnlyDetails, hostOnlySection, rowBadges } from "./hostList.ts";
import type { HostOnlyTemplate, TemplateHostView } from "./hostCatalog.ts";

const NOW = 1_800_000_000_000;
const view = (state: TemplateHostView["state"], checkedAt: number | null = NOW, muted = false): TemplateHostView => ({
  state,
  checkedAt,
  muted,
  checking: false,
});

test("a row's badges are the git badge first and the host badge second", () => {
  const badges = rowBadges("triage", "modified", view({ kind: "differs" }), NOW);
  assert.deepEqual(
    badges.map((b) => b.kind),
    ["git", "host"],
  );
});

test("a row with no change since the last commit has only its host badge", () => {
  assert.deepEqual(
    rowBadges("triage", undefined, view({ kind: "installed" }), NOW).map((b) => b.kind),
    ["host"],
  );
});

test("a row whose host state is unknown because of the host has only its git badge", () => {
  assert.deepEqual(
    rowBadges("triage", "added", view({ kind: "unknown", why: "host" }, null), NOW).map((b) => b.kind),
    ["git"],
  );
});

test("every host badge has a text equivalent that names the template and its state", () => {
  const text = (state: TemplateHostView["state"]) => hostBadge("triage", view(state), NOW)?.text;
  assert.equal(text({ kind: "nameRefused", rule: "lowercase" }), "triage on the host: Name the host refuses");
  assert.equal(text({ kind: "notInstalled" }), "triage on the host: Not installed");
  assert.equal(text({ kind: "invalidOnHost", diagnostics: [] }), "triage on the host: Invalid on host");
  assert.equal(text({ kind: "differs" }), "triage on the host: Differs from host");
  assert.equal(text({ kind: "notReady", reason: "No runner." }), "triage on the host: Installed, not ready");
  assert.equal(text({ kind: "installed" }), "triage on the host: Installed");
});

test("states that need attention are coloured, and Installed is a muted check", () => {
  const tone = (state: TemplateHostView["state"]) => hostBadge("triage", view(state), NOW)?.tone;
  assert.equal(tone({ kind: "nameRefused", rule: "lowercase" }), "error");
  assert.equal(tone({ kind: "invalidOnHost", diagnostics: [] }), "error");
  assert.equal(tone({ kind: "notInstalled" }), "attention");
  assert.equal(tone({ kind: "differs" }), "attention");
  assert.equal(tone({ kind: "notReady", reason: "No runner." }), "attention");
  assert.equal(tone({ kind: "installed" }), "muted");
});

test("a badge's tooltip carries the host's reason", () => {
  assert.match(hostBadge("triage", view({ kind: "notReady", reason: "No runner is set up." }), NOW)?.title ?? "", /No runner is set up\./);
  assert.match(hostBadge("triage", view({ kind: "invalidOnHost", diagnostics: ["Bad step."] }), NOW)?.title ?? "", /Bad step\./);
  assert.match(hostBadge("Triage", view({ kind: "nameRefused", rule: "Use lowercase." }), NOW)?.title ?? "", /Use lowercase\./);
});

test("a read that failed shows a neutral badge with why, not a host state", () => {
  const badge = hostBadge("triage", view({ kind: "unknown", why: "failed", message: "praxis didn't answer in time." }), NOW);
  assert.equal(badge?.tone, "neutral");
  assert.equal(badge?.text, "triage on the host: Couldn't check");
  assert.match(badge?.title ?? "", /praxis didn't answer in time\./);
});

test("a template not checked yet has no host badge", () => {
  assert.equal(hostBadge("triage", view({ kind: "unknown", why: "notChecked" }, null), NOW), null);
});

test("a muted reading says it may be out of date, in its tooltip and its text", () => {
  const badge = hostBadge("triage", view({ kind: "installed" }, NOW - 12 * 60_000, true), NOW);
  assert.equal(badge?.muted, true);
  assert.equal(badge?.title, "Installed. May be out of date: checked 12 min ago.");
  assert.equal(badge?.text, "triage on the host: Installed, may be out of date");
});

test("a current reading doesn't say it may be out of date", () => {
  const badge = hostBadge("triage", view({ kind: "differs" }, NOW - 60_000), NOW);
  assert.equal(badge?.muted, false);
  assert.doesNotMatch(badge?.title ?? "", /out of date/);
});

test("the group header shows the host-level condition and always offers Check host", () => {
  for (const condition of [{ state: "notCheckedYet" }, { state: "signedIn" }, { state: "hostUnreachable" }] as const) {
    const header = hostGroupHeader(condition);
    assert.equal(header.checkHostLabel, "Check host");
  }
  assert.equal(hostGroupHeader({ state: "notCheckedYet" }).condition, "Host not checked yet");
  assert.equal(hostGroupHeader({ state: "hostUnreachable" }).condition, "Host down");
});

test("Not signed in adds Sign in, the host chip's action", () => {
  const header = hostGroupHeader({ state: "notSignedIn" });
  assert.equal(header.condition, "Not signed in");
  assert.deepEqual(header.action, { command: "login", label: "Sign in" });
  assert.equal(header.linkCli, null);
});

test("praxis CLI not found says how to link it, with the reason", () => {
  const header = hostGroupHeader({ state: "cliNotFound", reason: "No praxis on PATH." });
  assert.equal(header.condition, "praxis CLI not found");
  assert.match(header.linkCli?.text ?? "", /npm link/);
  assert.equal(header.linkCli?.reason, "No praxis on PATH.");
  assert.equal(header.action, null);
});

test("Host down and No host set up add no action to the header: only Not signed in does", () => {
  assert.equal(hostGroupHeader({ state: "hostUnreachable" }).action, null);
  assert.equal(hostGroupHeader({ state: "noHostSetUp" }).action, null);
});

test("a signed-in host offers no action besides Check host", () => {
  const header = hostGroupHeader({ state: "signedIn" });
  assert.equal(header.action, null);
  assert.equal(header.linkCli, null);
});

const hostOnly = (name: string, valid = true, more: Partial<HostOnlyTemplate> = {}): HostOnlyTemplate => ({
  name,
  revision: 3,
  description: null,
  valid,
  diagnostics: [],
  ...more,
});

test("the On host only subsection appears only when the latest reading found host-only templates", () => {
  assert.equal(hostOnlySection([]), null);
  assert.equal(hostOnlySection([hostOnly("review"), hostOnly("deploy")])?.title, "On host only (2)");
});

test("On host only rows are by name, with the invalid badge from list", () => {
  const section = hostOnlySection([hostOnly("review"), hostOnly("deploy", false, { diagnostics: ["Unknown step kind."] })]);
  assert.deepEqual(
    section?.rows.map((r) => [r.name, r.invalid?.state ?? null]),
    [
      ["deploy", "invalidOnHost"],
      ["review", null],
    ],
  );
  assert.equal(section?.rows[0]?.invalid?.text, "deploy is invalid on the host");
  assert.equal(section?.rows[0]?.invalid?.tone, "error");
});

test("the On host only subsection draws at most HOST_ONLY_LIMIT rows and counts the rest", () => {
  const total = HOST_ONLY_LIMIT + 5;
  const templates = Array.from({ length: total }, (_, i) => hostOnly(`t-${String(total - i).padStart(4, "0")}`));
  const section = hostOnlySection(templates);
  assert.equal(section?.title, `On host only (${total})`);
  assert.equal(section?.rows.length, HOST_ONLY_LIMIT);
  assert.equal(section?.omitted, 5);
  assert.equal(section?.rows[0]?.name, "t-0001");
});

test("a short On host only list omits nothing", () => {
  assert.equal(hostOnlySection([hostOnly("review")])?.omitted, 0);
});

test("a host-only template's read-only panel has its description, revision and validity", () => {
  assert.deepEqual(hostOnlyDetails(hostOnly("deploy", false, { description: "Ships it.", diagnostics: ["Unknown step kind."] })), [
    { label: "Description", value: "Ships it." },
    { label: "Revision", value: "3" },
    { label: "Validity", value: "Invalid. Unknown step kind." },
  ]);
  assert.deepEqual(hostOnlyDetails(hostOnly("review", true, { revision: null })), [
    { label: "Description", value: "None given" },
    { label: "Revision", value: "Not given" },
    { label: "Validity", value: "Valid" },
  ]);
});
