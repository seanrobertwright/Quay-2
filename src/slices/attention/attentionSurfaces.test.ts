/// <reference types="node" />
// Component tests for what the attention queue shows over the workspace (#644): no permission
// modal, since a request is answered in the companion's Activity view, and the notice for an
// answer that reached no agent. They render the real attention surfaces and the real companion
// over the real attention queue hook, and fake only Tauri's `invoke`, the out-of-process boundary:
// `get_pending_permissions` lists the requests the backend holds, and `resolve_permission` takes
// or refuses the operator's answer.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import { companionPrefs } from "../companion/companionPrefs.ts";
import { memoryStorage } from "../companion/fixtures/companionFixtures.ts";

const { AttentionSurfaces } = await import("./AttentionSurfaces.tsx");
const { useAttentionQueue } = await import("./useAttentionQueue.ts");
const { Companion, ACTIVITY_VIEW, REPOSITORY_VIEW } = await import("../companion/Companion.tsx");

const PROJECT = "C:/work/repo";
const AGENT: TerminalInfo = {
  id: "term-a",
  name: "Agent A",
  project_path: PROJECT,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "waiting",
  auto_approved_count: 0,
};

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

/**
 * Renders the attention surfaces beside the companion on Agent A's Activity view, over a backend
 * holding one Bash request from Agent A. The backend takes every answer, unless `undelivered` is
 * set: then it refuses each one, as it does when no agent waits for the answer any more.
 */
async function render({ undelivered = false } = {}) {
  fakeInvoke(async (command) => {
    if (command === "get_pending_permissions") {
      return [{ requestId: "req-1", sessionId: "s", tag: AGENT.id, tool: "Bash", input: { command: "rm -rf dist" } }];
    }
    if (command === "resolve_permission") {
      if (undelivered) throw "The agent is no longer waiting for permission request req-1, so the answer was not delivered";
      return null;
    }
    throw new Error(`no fake for ${command}`);
  });
  const prefs = companionPrefs(memoryStorage({ quay_companion_opens_on: "activity" }));
  const App: FC = () => {
    const queue = useAttentionQueue([AGENT]);
    return createElement(
      Fragment,
      null,
      createElement(AttentionSurfaces, { queue, terminals: [AGENT] }),
      createElement(Companion, {
        selectedTerminal: AGENT,
        projects: [{ path: PROJECT, name: "repo", terminal_ids: [AGENT.id] }],
        projectWorktrees: {},
        views: [REPOSITORY_VIEW, ACTIVITY_VIEW],
        prefs,
        activity: { events: [], messages: [], waiting: queue.items, answer: queue.answerPermission },
      }),
    );
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(App)));
  await settle();
  return container;
}

/** Lets the fake backend's answers and React's updates land. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const buttonNamed = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );

test("a permission request opens no modal; it waits in the Activity view", async () => {
  await render();
  assert.equal(document.querySelector('[role="dialog"], [aria-modal="true"]'), null);
  // Nothing lies over the workspace: the only fixed layer would be a notice, and none shows.
  assert.equal(document.querySelector(".fixed"), null);
  assert.equal(buttonNamed("Later"), undefined);
  assert.ok(document.querySelector('[data-companion-view="activity"] [aria-label="Permission request"]'));
});

test("an answer from Activity that reaches no agent clears the request and says so", async () => {
  await render({ undelivered: true });
  await act(async () => buttonNamed("Allow once")!.click());
  await settle();

  const notice = [...document.querySelectorAll('[role="alert"]')].find((a) => a.textContent?.includes("Answer not delivered"));
  assert.match(notice?.textContent ?? "", /The Bash request in Agent A had stopped waiting/);
  assert.equal(document.querySelector('[aria-label="Permission request"]'), null);

  await act(async () => buttonNamed("Dismiss undelivered answer notice")!.click());
  assert.equal(document.querySelector('[role="alert"]'), null);
});
