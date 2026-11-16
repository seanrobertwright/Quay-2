/// <reference types="node" />
// Component tests for the companion's Activity view (#644): the selected terminal's tool calls,
// with expandable output, merged with its messages; the message strip that sends it a task; and
// its pending permission request answered in place. They render the real companion over the real
// attention queue hook, and fake only Tauri's `invoke`, the out-of-process boundary:
// `get_pending_permissions` lists the requests the backend holds, `resolve_permission` takes an
// answer, and `a2a_send_prompt` sends a message.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Envelope } from "../bridge/useBridgeEvents.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { CompanionShowRequest } from "./Companion.tsx";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";

const { Companion, REPOSITORY_VIEW, ACTIVITY_VIEW } = await import("./Companion.tsx");
const { useAttentionQueue } = await import("../attention/useAttentionQueue.ts");

const PROJECT = "E:/alpha";
const agent = terminalInfo("a", PROJECT);
const projects = [{ path: PROJECT, name: "Alpha", terminal_ids: ["a"] }];

const event = (seq: number, type: string, ts: number, data: Record<string, unknown>): Envelope => ({
  v: 1,
  boot: "boot",
  seq,
  ts,
  sessionId: "session",
  tag: agent.id,
  type,
  data,
});
const EVENTS = [
  event(2, "tool.finished", 2_000, { tool: "Bash", toolUseId: "t1", input: { command: "pnpm test" }, text: "12 passed", status: "ok" }),
  event(1, "tool.started", 1_000, { tool: "Bash", toolUseId: "t1", input: { command: "pnpm test" } }),
];
const MESSAGES: TrailMessage[] = [
  {
    id: "m1",
    from_terminal: "user",
    from_name: "You",
    to_terminal: agent.id,
    to_name: agent.name,
    content: "run the tests",
    as_user: true,
    timestamp: 500,
    status: "completed",
    response: "All 12 pass",
  },
];

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

interface Backend {
  pending?: Record<string, unknown>[];
  /** Every command the companion sent, with its arguments, in order. */
  calls: { command: string; args: Record<string, unknown> }[];
}

/** Renders the companion on the Activity view for `agent`, over a backend holding `pending`. */
async function render({ pending = [], showRequest = null }: { pending?: Record<string, unknown>[]; showRequest?: CompanionShowRequest | null } = {}) {
  const backend: Backend = { pending, calls: [] };
  fakeInvoke(async (command, args) => {
    backend.calls.push({ command, args });
    if (command === "get_pending_permissions") return pending;
    if (command === "resolve_permission" || command === "a2a_send_prompt") return null;
    throw new Error(`no fake for ${command}`);
  });
  const prefs = companionPrefs(memoryStorage({ quay_companion_opens_on: "activity" }));
  const Shell: FC<{ request: CompanionShowRequest | null }> = ({ request }) => {
    const queue = useAttentionQueue([agent]);
    return createElement(Companion, {
      selectedTerminal: agent,
      projects,
      projectWorktrees: {},
      views: [REPOSITORY_VIEW, ACTIVITY_VIEW],
      prefs,
      activity: { events: EVENTS, messages: MESSAGES, waiting: queue.items, answer: queue.answerPermission },
      showRequest: request ?? { terminalId: agent.id, view: "activity", seq: 1 },
    });
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(Shell, { request: showRequest })));
  await settle();
  return { backend, container, rerender: (request: CompanionShowRequest) => act(async () => root.render(createElement(Shell, { request }))) };
}

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const view = () => document.querySelector('[data-companion-view="activity"]') as HTMLElement;
const entries = () => [...view().querySelectorAll('ol[aria-label="Activity"] > li')];
function button(name: string): HTMLButtonElement {
  const found = [...view().querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  assert.equal(found.length, 1, `one button named "${name}", found ${found.length}`);
  return found[0];
}

test("Activity lists the terminal's messages and tool calls oldest first, each call's output behind a toggle", async () => {
  await render();
  const rows = entries();
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent ?? "", /You.*run the tests.*All 12 pass/);
  assert.match(rows[1].textContent ?? "", /Bash.*pnpm test/);
  assert.doesNotMatch(rows[1].textContent ?? "", /12 passed/, "output starts folded");

  const toggle = button("Show output of Bash pnpm test");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(entries()[1].textContent ?? "", /12 passed/);
});

test("the message strip sends a task to the terminal's agent as the operator, then clears", async () => {
  const { backend } = await render();
  const field = view().querySelector("textarea") as HTMLTextAreaElement;
  assert.equal(field.getAttribute("aria-label"), `Message to ${agent.name}`);

  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    setValue.call(field, "fix the flaky test");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Send").click());
  await settle();

  assert.deepEqual(
    backend.calls.filter((c) => c.command === "a2a_send_prompt").map((c) => c.args),
    [{ request: { from_terminal: "user", to_terminal: agent.id, prompt: "fix the flaky test", as_user: true } }],
  );
  assert.equal(field.value, "");
});

test("a pending permission request shows at the top with Allow once, Allow for session and Deny, answered in place", async () => {
  const { backend } = await render({
    pending: [{ requestId: "req-1", sessionId: "s", tag: agent.id, tool: "Bash", input: { command: "rm -rf dist" } }],
  });
  const request = view().querySelector('[aria-label="Permission request"]') as HTMLElement;
  assert.ok(request, "the request shows");
  assert.ok(view().firstElementChild?.contains(request), "at the top of the view");
  assert.match(request.textContent ?? "", /Bash.*rm -rf dist/);
  for (const name of ["Allow once", "Allow for session", "Deny"]) button(name);

  await act(async () => button("Allow for session").click());
  await settle();

  assert.deepEqual(
    backend.calls.filter((c) => c.command === "resolve_permission").map((c) => c.args),
    [{ requestId: "req-1", decision: "allow", reason: null, rememberForSession: true }],
  );
  assert.equal(view().querySelector('[aria-label="Permission request"]'), null);
});

test("a request to show a message marks that message as the one shown", async () => {
  const { rerender } = await render();
  assert.equal(view().querySelector('[aria-current="true"]'), null);
  await rerender({ terminalId: agent.id, view: "activity", entryId: "message:m1", seq: 2 });
  const current = view().querySelector('[aria-current="true"]');
  assert.ok(current);
  assert.match(current.textContent ?? "", /run the tests/);
});
