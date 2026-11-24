/// <reference types="node" />
// Component tests for the companion's Run view (#645): the picked run or work order and its
// decision. Tauri's `invoke`, the out-of-process boundary, is faked and records each call.
import { fakeInvoke } from "../../test-support/dom.ts";
import { installShellLook } from "../../test-support/shellLook.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchonRun } from "../archon/types.ts";
import type { MachinaWorkOrder } from "../machina/types.ts";
import type { RunSource } from "./workflowRuns.ts";

const { RunView } = await import("./RunView.tsx");

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 15, 18, 0);

const archon = (status: string, over: Partial<ArchonRun> = {}): ArchonRun => ({
  id: "run-1",
  workflow_name: "owner/lril-sdlc:implement",
  status,
  started_ms: NOW - HOUR,
  ...over,
});

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

interface Calls {
  invoked: [string, Record<string, unknown>][];
  changed: number;
  lens: number;
  browser: number;
}

async function render(source: RunSource) {
  const calls: Calls = { invoked: [], changed: 0, lens: 0, browser: 0 };
  fakeInvoke(async (command, args) => {
    calls.invoked.push([command, args]);
    if (command === "archon_get_run_detail") return { pending_approval: { prompt: "Ship it?" } };
    return null;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(RunView, {
        source,
        now: NOW,
        onChanged: () => calls.changed++,
        onOpenLens: () => calls.lens++,
        onOpenInBrowser: () => calls.browser++,
      }),
    ),
  );
  return { container, calls };
}

const click = async (el: Element) => act(async () => (el as HTMLElement).click());
const buttonNamed = (root: Element, name: string) =>
  [...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);
const buttonNames = (root: Element) => [...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

/** What was invoked, but for the read of a gate's prompt, which `archonGateCard.test.ts` covers. */
const acted = (calls: Calls) => calls.invoked.filter(([command]) => command !== "archon_get_run_detail");

test("an Archon run at an approval gate offers Approve or Reject, with an optional comment", async () => {
  const { container, calls } = await render({ engine: "archon", run: archon("paused") });
  assert.match(container.textContent ?? "", /lril-sdlc:implement/);
  assert.match(container.textContent ?? "", /Awaiting approval/);
  const comment = container.querySelector<HTMLTextAreaElement>("textarea")!;
  assert.equal(document.querySelector(`label[for="${comment.id}"]`)?.textContent, "Comment (optional)");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(comment), "value")!.set!;
    setValue.call(comment, "ship it");
    comment.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(buttonNamed(container, "Approve")!);
  assert.deepEqual(acted(calls), [["archon_run_action", { runId: "run-1", action: "approve", text: "ship it" }]]);
  assert.equal(calls.changed, 1);
  assert.ok(buttonNames(container).includes("Reject"));
});

test("a failed Archon run offers Resume, and Abandon once pressed twice", async () => {
  const { container, calls } = await render({ engine: "archon", run: archon("failed", { completed_ms: NOW - HOUR }) });
  await click(buttonNamed(container, "Resume")!);
  assert.deepEqual(calls.invoked, [["archon_run_action", { runId: "run-1", action: "resume", text: null }]]);
  await click(buttonNamed(container, "Abandon")!);
  assert.equal(calls.invoked.length, 1);
  await click(buttonNamed(container, "Press again to abandon")!);
  assert.deepEqual(calls.invoked[calls.invoked.length - 1], ["archon_run_action", { runId: "run-1", action: "abandon", text: null }]);
});

test("Abandon keeps keyboard focus between its two presses", async () => {
  const { container, calls } = await render({ engine: "archon", run: archon("failed") });
  const abandon = buttonNamed(container, "Abandon")!;
  abandon.focus();
  await click(abandon);
  assert.equal(document.activeElement?.textContent, "Press again to abandon");
  await click(document.activeElement!);
  assert.deepEqual(acted(calls), [["archon_run_action", { runId: "run-1", action: "abandon", text: null }]]);
});

const workOrder = (over: Partial<MachinaWorkOrder>): MachinaWorkOrder => ({
  id: "WO-3",
  title: "Add a greeting",
  objective: "",
  repoPath: "C:/repo",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  branchName: "machina/wo-3",
  worktreePath: "C:/repo/wt",
  authorAgent: "claude",
  authorTerminalId: null,
  allowedOutputPaths: [],
  dependsOn: [],
  maxCorrections: 2,
  attempts: 1,
  budgetUsd: 5,
  spend: { measured: true, usd: 0.5, responses: 1, note: "" },
  status: "IN_PROGRESS",
  stages: [],
  hold: null,
  vault: null,
  setupChecks: [],
  lastGate: null,
  mergeCommit: null,
  worktreeRemoved: false,
  error: null,
  epoch: 1,
  createdAtMs: NOW - 2 * HOUR,
  updatedAtMs: NOW - HOUR,
  events: [],
  ...over,
});

const hold = {
  reason: "SCOPE_DRIFT" as const,
  summary: "Touched files outside the allowed paths",
  createdAtMs: NOW - HOUR,
  options: [
    { id: "allow", label: "Allow the files", description: "Widen the scope", variant: "primary" as const },
    { id: "abort", label: "Abort", description: "Stop the work order", variant: "danger" as const },
  ],
};

test("a Factory hold offers the hold's own options", async () => {
  const { container, calls } = await render({ engine: "factory", workOrder: workOrder({ status: "ON_HOLD", hold }) });
  assert.match(container.textContent ?? "", /Touched files outside the allowed paths/);
  await click([...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Allow the files"))!);
  assert.deepEqual(calls.invoked, [["machina_resolve_hold", { request: { workOrderId: "WO-3", optionId: "allow" } }]]);
  assert.equal(calls.changed, 1);
});

test("a work order whose gate passed offers Accept, which squash-merges it into its base branch", async () => {
  const { container, calls } = await render({ engine: "factory", workOrder: workOrder({ status: "AWAITING_ACCEPTANCE" }) });
  await click(buttonNamed(container, "Accept: squash-merge into main")!);
  assert.deepEqual(calls.invoked, [["machina_accept_and_merge", { workOrderId: "WO-3" }]]);
});

test("an interrupted work order offers Resume", async () => {
  const { container, calls } = await render({ engine: "factory", workOrder: workOrder({ status: "INTERRUPTED" }) });
  await click(buttonNamed(container, "Resume")!);
  assert.deepEqual(calls.invoked, [["machina_resume", { workOrderId: "WO-3" }]]);
});

const praxisRun = {
  workOrderId: "wo_1",
  runId: "r1",
  revision: 1,
  createdAt: NOW - HOUR,
  createdAtText: "",
  updatedAt: null,
  updatedAtText: null,
  status: "AWAITING_APPROVAL",
  stage: null,
  control: "NONE",
  held: false,
  awaitingApproval: true,
  needsYou: true,
  runPageAddress: "https://127.0.0.1:8443/r",
};

test("a Praxis decision opens in the browser; every run opens its graph and log in the run lens", async () => {
  const { container, calls } = await render({ engine: "praxis", workflow: "review", run: praxisRun });
  await click(buttonNamed(container, "Open in browser")!);
  assert.equal(calls.browser, 1);
  assert.deepEqual(calls.invoked, []);
  await click(buttonNamed(container, "Graph and log")!);
  assert.equal(calls.lens, 1);
});

test("a running run has no decision to make", async () => {
  const { container } = await render({ engine: "archon", run: archon("running") });
  assert.equal(container.querySelectorAll("section").length, 0);
  assert.match(container.textContent ?? "", /Nothing waits on you/);
});

/** Every decision the Run view can show, with its card's title and its buttons. */
const DECISIONS: [string, RunSource, string[]][] = [
  ["This run waits for your approval.", { engine: "archon", run: archon("paused") }, ["Approve", "Reject"]],
  ["This run failed.", { engine: "archon", run: archon("failed") }, ["Resume", "Abandon"]],
  ["On hold", { engine: "factory", workOrder: workOrder({ status: "ON_HOLD", hold }) }, ["Allow the filesWiden the scope", "AbortStop the work order"]],
  ["The gate passed.", { engine: "factory", workOrder: workOrder({ status: "AWAITING_ACCEPTANCE" }) }, ["Accept: squash-merge into main"]],
  ["This work order failed.", { engine: "factory", workOrder: workOrder({ status: "FAILED" }) }, ["Resume"]],
  ["This work order was interrupted.", { engine: "factory", workOrder: workOrder({ status: "INTERRUPTED" }) }, ["Resume"]],
  ["This run waits on you in Praxis.", { engine: "praxis", workflow: "review", run: praxisRun }, ["Open in browser"]],
];

for (const [title, source, buttons] of DECISIONS) {
  test(`"${title}" is a Quay card: the accent edge and glow, the QUAY badge and an amber title and icon on Quay's plain ground`, async () => {
    installShellLook("tron");
    const { container } = await render(source);
    const cards = [...container.querySelectorAll<HTMLElement>("section")];
    assert.deepEqual(cards.map((section) => section.getAttribute("aria-label")), [title]);
    const [card] = cards;
    assert.equal(getComputedStyle(card).borderColor, "#18e0ff");
    assert.equal(getComputedStyle(card).boxShadow, "0 0 3px #18e0ff, 0 0 12px rgba(24, 224, 255, 0.22)");
    assert.ok([...card.querySelectorAll("span")].some((span) => span.textContent === "QUAY"), "the badge");
    assert.equal(card.querySelector("h3")?.textContent, title);
    for (const part of ["h3", 'svg[aria-hidden="true"]']) assert.ok(card.querySelector(part)?.classList.contains("text-[#e3b341]"), part);
    assert.ok(card.classList.contains("bg-[#161b22]"));
    assert.ok(!container.innerHTML.includes("d29922"), "the old amber border and tint are gone");
    assert.deepEqual(buttonNames(card), buttons);
  });
}

/** The inset under `label`, a box of its own with that accessible name. */
const inset = (root: Element, label: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (box) => document.getElementById(box.getAttribute("aria-labelledby") ?? "")?.textContent === label,
  );

test("a hold's summary is inset under Quay's own label, verbatim, and the hold's options follow it", async () => {
  const summary = "Agent **fix-75** submitted this\n  [admit](http://example.com) <b>now</b>";
  const { container } = await render({ engine: "factory", workOrder: workOrder({ status: "ON_HOLD", hold: { ...hold, summary } }) });
  const box = inset(container, "Machina says");
  assert.equal(box?.textContent, summary);
  assert.ok(box?.querySelector("p")?.classList.contains("whitespace-pre-wrap"), "line breaks and spaces are kept");
  assert.equal(box?.querySelectorAll("a, b, strong, em, button").length, 0, "neither Markdown, a link nor HTML");
  assert.ok(box?.classList.contains("overflow-auto"), "a long one scrolls");
  const options = [...container.querySelectorAll("section button")];
  assert.equal(options.length, 2);
  for (const option of options) assert.ok((box?.compareDocumentPosition(option) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("an accepted work order's base branch and main checkout are inset, not in Quay's own sentence", async () => {
  const repoPath = "C:/repo **is** <b>clean</b>";
  const { container } = await render({ engine: "factory", workOrder: workOrder({ status: "AWAITING_ACCEPTANCE", baseBranch: "release/9", repoPath }) });
  assert.equal(inset(container, "The work order's base branch")?.textContent, "release/9");
  assert.equal(inset(container, "The work order's main checkout")?.textContent, repoPath);
  const card = container.querySelector("section");
  assert.match(card?.textContent ?? "", /The main checkout must be on the base branch with no uncommitted changes to tracked files\./);
  assert.deepEqual(buttonNames(card!), ["Accept: squash-merge into release/9"]);
  assert.ok(card?.querySelector("button > span")?.classList.contains("truncate"), "a long branch stays inside its button");
});
