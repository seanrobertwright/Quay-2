/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostConditionView } from "./hostCondition.ts";

test("each host condition has its own text label, not just a colour", () => {
  assert.equal(hostConditionView({ state: "notCheckedYet" }).label, "Host not checked yet");
  assert.equal(hostConditionView({ state: "cliNotFound", reason: "x" }).label, "praxis CLI not found");
  assert.equal(hostConditionView({ state: "noHostSetUp" }).label, "No host set up");
  assert.equal(hostConditionView({ state: "hostUnreachable" }).label, "Host down");
  assert.equal(hostConditionView({ state: "notSignedIn" }).label, "Not signed in");
  assert.equal(hostConditionView({ state: "signedIn" }).label, "Signed in");
  assert.equal(hostConditionView({ state: "simulatedHost" }).label, "Simulated host");
});

test("a missing CLI or old Node gets a panel on linking the praxis checkout, with the reason", () => {
  const panel = hostConditionView({ state: "cliNotFound", reason: "praxis needs Node 24 or later, and the node on PATH is v22.1.0." }).panel;
  assert.equal(panel?.kind, "linkCli");
  assert.equal(panel?.kind === "linkCli" && panel.reason, "praxis needs Node 24 or later, and the node on PATH is v22.1.0.");
  assert.match(panel?.text ?? "", /npm link/);
  assert.match(panel?.text ?? "", /Node 24/);
  // Quay has no screen for the Praxis settings yet, so the panel never sends the user to one.
  assert.doesNotMatch(panel?.text ?? "", /settings/i);
});

test("no host, host down and signed out each offer the terminal command that fixes them", () => {
  const actionOf = (condition: Parameters<typeof hostConditionView>[0]) => {
    const panel = hostConditionView(condition).panel;
    return panel?.kind === "terminal" ? [panel.action.command, panel.action.label] : null;
  };
  assert.deepEqual(actionOf({ state: "noHostSetUp" }), ["setup", "Set up host"]);
  assert.deepEqual(actionOf({ state: "hostUnreachable" }), ["serve", "Start host"]);
  assert.deepEqual(actionOf({ state: "notSignedIn" }), ["login", "Sign in"]);
});

test("a signed-in host or one not checked yet has no panel", () => {
  assert.equal(hostConditionView({ state: "signedIn" }).panel, null);
  assert.equal(hostConditionView({ state: "notCheckedYet" }).panel, null);
  assert.equal(hostConditionView({ state: "simulatedHost" }).panel, null);
});

test("only the conditions that stop the host being used are failing", () => {
  const failing = (["notCheckedYet", "noHostSetUp", "hostUnreachable", "notSignedIn", "signedIn", "simulatedHost"] as const).filter(
    (state) => hostConditionView({ state }).failing,
  );
  assert.deepEqual(failing, ["noHostSetUp", "hostUnreachable", "notSignedIn"]);
  assert.equal(hostConditionView({ state: "cliNotFound", reason: "x" }).failing, true);
});

test("a simulated host is amber and carries a standing banner that its approvals aren't a person's", () => {
  const view = hostConditionView({ state: "simulatedHost" });
  assert.equal(view.tone, "amber");
  assert.match(view.banner ?? "", /approvals aren't made by a person/);
  assert.equal(hostConditionView({ state: "signedIn" }).banner, null);
  assert.equal(hostConditionView({ state: "signedIn" }).tone, "ok");
  assert.equal(hostConditionView({ state: "hostUnreachable" }).tone, "error");
  assert.equal(hostConditionView({ state: "notCheckedYet" }).tone, "neutral");
});
