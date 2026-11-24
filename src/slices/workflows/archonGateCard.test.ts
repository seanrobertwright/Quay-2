/// <reference types="node" />
// Component tests for the Archon gate's card in the companion's Run view (#713): the gate's prompt,
// what the card shows while it has none, and when the prompt is read. Tauri's `invoke`, the
// out-of-process boundary, is faked: `archon_get_run_detail` answers with a run's pending approval.
import { fakeInvoke } from "../../test-support/dom.ts";
import { inset } from "../../test-support/insets.ts";
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ArchonPendingApproval, ArchonRun, ArchonRunDetail } from "../archon/types.ts";
import type { RunSource } from "./workflowRuns.ts";

const { RunView } = await import("./RunView.tsx");

const NOW = Date.UTC(2026, 10, 24, 18, 0);
const run = (status: string, id = "run-1"): ArchonRun => ({ id, workflow_name: "owner/release", status, started_ms: NOW - 60_000 });

const detailOf = (pending: ArchonPendingApproval | null): ArchonRunDetail => ({
  run: run("paused"),
  nodes: [],
  active_nodes: [],
  logs: [],
  total_events: 0,
  hidden_hook_events: 0,
  logs_truncated: false,
  messages: [],
  pending_approval: pending,
  fetched_at_ms: NOW,
});
const gate = (prompt: string, over: Partial<ArchonPendingApproval> = {}): ArchonPendingApproval => ({
  prompt,
  node_id: "gate",
  requested_ms: NOW - 30_000,
  ...over,
});

let mounted: { root: Root; container: HTMLElement } | null = null;
const unmount = () => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
};
afterEach(() => {
  unmount();
  mock.timers.reset();
});

/** Lets what a faked command answered with reach the screen. */
const settle = () => act(async () => {});

async function render(readDetail: () => Promise<unknown>, source: RunSource = { engine: "archon", run: run("paused") }) {
  const calls: { reads: Record<string, unknown>[]; acted: Record<string, unknown>[]; lens: number; refuse: string | null } = {
    reads: [],
    acted: [],
    lens: 0,
    refuse: null,
  };
  fakeInvoke(async (command, args) => {
    if (command === "archon_get_run_detail") {
      calls.reads.push(args);
      return readDetail();
    }
    if (command === "archon_run_action") {
      calls.acted.push(args);
      if (calls.refuse !== null) throw calls.refuse;
      return null;
    }
    throw new Error(`no fake for ${command}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const show = (next: RunSource) =>
    act(async () =>
      root.render(
        createElement(RunView, { source: next, now: NOW, onChanged: () => {}, onOpenLens: () => calls.lens++, onOpenInBrowser: () => {} }),
      ),
    );
  await show(source);
  return { container, calls, show };
}

const card = (container: Element) => container.querySelector<HTMLElement>('section[aria-label="This run waits for your approval."]')!;
const buttonNames = (root: Element) => [...root.querySelectorAll("button")].map((b) => b.textContent?.trim());
const click = async (root: Element, name: string) => {
  const button = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  assert.ok(button !== undefined, `there is a ${name} button`);
  await act(async () => button.click());
};
const typeComment = async (root: Element, text: string) => {
  const field = root.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("the gate's prompt shows above Approve and Reject, verbatim and inset under Quay's own label", async () => {
  const prompt = "**Ship** it?\n  see [notes](http://example.com) <b>now</b>";
  const { container, calls } = await render(async () => detailOf(gate(prompt)));
  const box = inset(card(container), "The workflow asks");
  assert.equal(box?.textContent, prompt, "nothing of Quay's own is in the inset");
  assert.ok(box?.querySelector("p")?.classList.contains("whitespace-pre-wrap"), "line breaks and spaces are kept");
  assert.equal(box?.querySelectorAll("a, b, strong, em, button").length, 0, "neither Markdown, a link nor HTML");
  assert.deepEqual(buttonNames(card(container)), ["Approve", "Reject"]);
  assert.deepEqual(calls.reads, [{ runId: "run-1", includeHooks: false }]);
});

const UNREADABLE = "Quay could not read what the workflow asks, so this card does not offer Approve or Reject.";

test("a gate whose prompt cannot be read says so, offers Graph and log, and asks neither Approve nor Reject", async () => {
  for (const [name, readDetail] of [
    ["the read fails", () => Promise.reject("The Archon web server is not running.")],
    ["the run has no pending approval", async () => detailOf(null)],
    ["the prompt is empty", async () => detailOf(gate(""))],
    ["the prompt is blank", async () => detailOf(gate(" \n\t"))],
  ] as [string, () => Promise<unknown>][]) {
    const { container, calls } = await render(readDetail);
    assert.ok(card(container).textContent?.includes(UNREADABLE), name);
    assert.equal(card(container).querySelector('[role="status"]')?.textContent, UNREADABLE, `${name}: a screen reader hears it`);
    assert.deepEqual(buttonNames(card(container)), ["Graph and log"], name);
    assert.equal(card(container).querySelectorAll("textarea").length, 0, `${name}: no comment with nothing to send it`);
    await click(card(container), "Graph and log");
    assert.equal(calls.lens, 1, name);
    unmount();
  }
});

test("the reason a read failed is inset under Quay's own label; a run with no pending approval draws no empty box for one", async () => {
  const reason = "Archon GET /api: **bad** <b>gateway</b>";
  const { container } = await render(() => Promise.reject(reason));
  assert.equal(inset(card(container), "Why it could not be read")?.textContent, reason);
  unmount();
  const none = await render(async () => detailOf(null));
  assert.equal(card(none.container).querySelectorAll('[role="group"]').length, 0);
});

test("until the prompt is read the card says it is being read, and asks nothing", async () => {
  let answer: (detail: ArchonRunDetail) => void = () => {};
  const { container } = await render(() => new Promise((resolve) => (answer = resolve)));
  assert.match(card(container).textContent ?? "", /Reading what the workflow asks…/);
  assert.deepEqual(buttonNames(card(container)), []);
  await act(async () => answer(detailOf(gate("Ship it?"))));
  assert.deepEqual(buttonNames(card(container)), ["Approve", "Reject"]);
});

test("a long prompt scrolls in its own box, reached by keyboard, with the comment and the buttons outside it", async () => {
  const { container } = await render(async () => detailOf(gate("line\n".repeat(400))));
  const box = inset(card(container), "The workflow asks");
  assert.ok(box?.classList.contains("overflow-auto"));
  assert.ok(box?.classList.contains("max-h-44"), "about ten lines high");
  assert.equal(box?.tabIndex, 0);
  for (const control of card(container).querySelectorAll("textarea, button")) {
    assert.ok(!box?.contains(control));
    assert.ok((box?.compareDocumentPosition(control) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
});

test("Approve and Reject each send the decision they name with the comment as typed", async () => {
  for (const [name, action] of [
    ["Approve", "approve"],
    ["Reject", "reject"],
  ]) {
    const { container, calls } = await render(async () => detailOf(gate("Ship it?")));
    await typeComment(container, "as agreed");
    await click(container, name);
    assert.deepEqual(calls.acted, [{ runId: "run-1", action, text: "as agreed" }]);
    unmount();
  }
});

test("only a run at a gate, and only the one shown, has its detail read", async () => {
  const other = await render(async () => detailOf(null), { engine: "archon", run: run("failed") });
  await other.show({ engine: "archon", run: run("running") });
  assert.deepEqual(other.calls.reads, []);
  unmount();
  const { calls } = await render(async () => detailOf(gate("Ship it?")), { engine: "archon", run: run("paused", "run-7") });
  assert.deepEqual(calls.reads, [{ runId: "run-7", includeHooks: false }]);
});

test("while the card shows, its prompt is read again every 5 seconds, one read at a time, until it goes", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const answers: ((detail: ArchonRunDetail) => void)[] = [];
  const { container, calls } = await render(() => new Promise((resolve) => answers.push(resolve)));
  mock.timers.tick(60_000);
  await settle();
  assert.equal(calls.reads.length, 1, "a slow read is waited for");
  await act(async () => answers[0](detailOf(gate("Ship it?"))));
  mock.timers.tick(4_999);
  assert.equal(calls.reads.length, 1);
  mock.timers.tick(1);
  assert.equal(calls.reads.length, 2);
  await act(async () => answers[1](detailOf(gate("Ship the second one?", { node_id: "gate-2" }))));
  assert.equal(inset(card(container), "The workflow asks")?.textContent, "Ship the second one?", "a later gate's prompt replaces it");
  unmount();
  mock.timers.tick(60_000);
  assert.equal(calls.reads.length, 2);
});

test("a prompt that can no longer be read takes Approve and Reject with it; they come back, comment kept, once it can", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let readable = true;
  const { container } = await render(async () => detailOf(readable ? gate("Ship it?") : null));
  await typeComment(container, "as agreed");
  readable = false;
  mock.timers.tick(5_000);
  await settle();
  assert.deepEqual(buttonNames(card(container)), ["Graph and log"]);
  readable = true;
  mock.timers.tick(5_000);
  await settle();
  assert.deepEqual(buttonNames(card(container)), ["Approve", "Reject"]);
  assert.equal(container.querySelector("textarea")?.value, "as agreed");
});

test("a comment typed for one gate is not sent to the next", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let asked = gate("Ship it?");
  const { container, calls } = await render(async () => detailOf(asked));
  await typeComment(container, "yes to the first");
  asked = gate("Ship it?", { requested_ms: NOW });
  mock.timers.tick(5_000);
  await settle();
  assert.equal(container.querySelector("textarea")?.value, "");
  await click(container, "Approve");
  assert.deepEqual(calls.acted.map((args) => args.text), [""]);
});

test("after a decision the card forgets the prompt and reads it again, so the next gate is not answered blind", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const answers: ((detail: ArchonRunDetail) => void)[] = [];
  const { container, calls } = await render(() => new Promise((resolve) => answers.push(resolve)));
  await act(async () => answers[0](detailOf(gate("First?"))));
  mock.timers.tick(5_000);
  assert.equal(calls.reads.length, 2, "a read is on its way when the operator decides");
  await click(container, "Approve");
  assert.equal(calls.reads.length, 3);
  assert.deepEqual(buttonNames(card(container)), []);
  await act(async () => answers[1](detailOf(gate("First?"))));
  assert.deepEqual(buttonNames(card(container)), [], "the read from before the decision is dropped");
  await act(async () => answers[2](detailOf(gate("Second?", { node_id: "gate-2" }))));
  assert.equal(inset(card(container), "The workflow asks")?.textContent, "Second?");
  mock.timers.tick(5_000);
  assert.equal(calls.reads.length, 4, "one chain of reads goes on");
});

test("a decision Archon refuses says so and keeps the comment", async () => {
  const { container, calls } = await render(async () => detailOf(gate("Ship it?")));
  calls.refuse = "HTTP 409";
  await typeComment(container, "as agreed");
  await click(container, "Reject");
  assert.equal(container.querySelector('[role="alert"]')?.textContent, "Reject failed: HTTP 409");
  assert.equal(container.querySelector("textarea")?.value, "as agreed");
  assert.deepEqual(buttonNames(card(container)), ["Approve", "Reject"]);
});
