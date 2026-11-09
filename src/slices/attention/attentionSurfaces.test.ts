/// <reference types="node" />
// Component tests for answering permission requests from the attention drawer (#533): Allow and
// Deny on a row, reopening a request deferred with Later from its row, and the count of older
// requests a terminal's cap dropped. They render the real attention surfaces (drawer, permission
// modal and undelivered-answer notice) over the real attention queue hook, and fake only Tauri's
// `invoke`, the out-of-process boundary: `get_pending_permissions` lists the requests the backend
// holds, and `resolve_permission` takes or refuses the user's answer.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";

const { AttentionSurfaces } = await import("./AttentionSurfaces.tsx");
const { useAttentionQueue } = await import("./useAttentionQueue.ts");

const PROJECT = "C:/work/repo";

const terminal = (id: string, name: string): TerminalInfo => ({
  id,
  name,
  project_path: PROJECT,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "waiting",
  auto_approved_count: 0,
});
const TERMINALS = [terminal("term-a", "Agent A"), terminal("term-b", "Agent B")];

interface BackendRequest {
  requestId: string;
  sessionId: string;
  tag?: string;
  tool: string;
  input: unknown;
}
const request = (requestId: string, tag: string, tool: string): BackendRequest => ({
  requestId,
  sessionId: "session",
  tag,
  tool,
  input: { command: `${tool} ${requestId}` },
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

interface Harness {
  /** Every answer the backend was sent, in order. */
  answers: Record<string, unknown>[];
  /** The terminals the user asked to focus, in order. */
  focused: string[];
  /** Opens the drawer, as the badge or its chord does. */
  openDrawer: () => Promise<void>;
}

/**
 * Renders the attention surfaces over a backend holding `pending`, with the drawer open. The
 * backend takes every answer, unless `undelivered` is set: then it refuses each one, as it does
 * when no agent waits for the answer any more.
 */
async function render(pending: BackendRequest[], { undelivered = false } = {}): Promise<Harness> {
  const answers: Record<string, unknown>[] = [];
  const focused: string[] = [];
  fakeInvoke(async (command, args) => {
    if (command === "get_pending_permissions") return pending;
    if (command === "resolve_permission") {
      answers.push(args);
      if (undelivered) {
        throw `The agent is no longer waiting for permission request ${String(args.requestId)}, so the answer was not delivered`;
      }
      return null;
    }
    throw new Error(`no fake for ${command}`);
  });
  let isDrawerOpen = true;
  const App: FC = () => {
    const queue = useAttentionQueue(TERMINALS);
    return createElement(AttentionSurfaces, {
      queue,
      terminals: TERMINALS,
      projects: [{ path: PROJECT, name: "repo", terminal_ids: ["term-a", "term-b"] }],
      projectWorktrees: {},
      isDrawerOpen,
      onCloseDrawer: () => {
        isDrawerOpen = false;
        rerender();
      },
      onFocusTerminal: (terminalId: string) => focused.push(terminalId),
    });
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = () => root.render(createElement(App));
  mounted = { root, container };
  await act(async () => rerender());
  await settle();
  return {
    answers,
    focused,
    openDrawer: async () => {
      isDrawerOpen = true;
      await act(async () => rerender());
    },
  };
}

/** Lets the fake backend's answers and React's updates land. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** The button labelled `label`, which must be there. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.getAttribute("aria-label") === label || (!b.hasAttribute("aria-label") && b.textContent?.trim() === label)
  );
  assert.equal(found.length, 1, `one button labelled "${label}", found ${found.length}`);
  return found[0];
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

/** The text of each row in the drawer, oldest first. */
const drawerRows = () =>
  [...document.querySelectorAll('ul[aria-label="Sessions waiting on you, oldest first"] > li')].map(
    (li) => li.textContent ?? ""
  );

/** The tool the permission modal shows, or null when it is closed. */
const modalTool = () => {
  const badge = [...document.querySelectorAll("span")].find((s) => s.textContent?.startsWith("Tool: "));
  return badge ? badge.textContent!.slice("Tool: ".length) : null;
};

test("Allow on a permission row answers the request once and clears its row", async () => {
  const app = await render([request("req-1", "term-a", "Bash")]);

  await click("Allow Bash for Agent A");

  assert.deepEqual(app.answers, [
    { requestId: "req-1", decision: "allow", reason: null, rememberForSession: false },
  ]);
  assert.deepEqual(drawerRows(), []);
  assert.equal(modalTool(), null);
});

test("Deny on a permission row sends the answer the modal's Deny sends, and both clear their item", async () => {
  const app = await render([request("req-1", "term-a", "Bash"), request("req-2", "term-b", "Write")]);

  // The modal opens on the oldest request; its Deny with no feedback typed
  assert.equal(modalTool(), "Bash");
  await click("Deny");
  await click("Deny Write for Agent B");

  const answer = { decision: "deny", reason: "User rejected tool execution", rememberForSession: false };
  assert.deepEqual(app.answers, [
    { requestId: "req-1", ...answer },
    { requestId: "req-2", ...answer },
  ]);
  assert.deepEqual(drawerRows(), []);
  assert.equal(modalTool(), null);
});

/** The text of the notice for an answer that reached no agent, or null when none shows. */
const undeliveredNotice = () => {
  const alert = [...document.querySelectorAll('[role="alert"]')].find((a) =>
    a.textContent?.includes("Answer not delivered")
  );
  return alert ? alert.textContent : null;
};

test("an answer from a row that reaches no agent clears the row and says so, as the modal's does", async () => {
  await render([request("req-1", "term-a", "Bash"), request("req-2", "term-b", "Write")], { undelivered: true });

  await click("Allow Once");
  const fromModal = undeliveredNotice();
  await click("Dismiss undelivered answer notice");
  await click("Allow Write for Agent B");
  const fromRow = undeliveredNotice();

  assert.match(fromModal ?? "", /The Bash request in Agent A had stopped waiting/);
  assert.match(fromRow ?? "", /The Write request in Agent B had stopped waiting/);
  assert.deepEqual(drawerRows(), []);
});

test("choosing a deferred request's row reopens the permission modal on that request", async () => {
  const app = await render([request("req-1", "term-a", "Bash"), request("req-2", "term-b", "Write")]);
  await click("Later");
  assert.equal(modalTool(), null);

  await click("Reopen Agent A's Bash request");
  assert.equal(modalTool(), "Bash");
  // The modal now shows the oldest request; the other deferred one still waits in the drawer
  await app.openDrawer();
  await click("Reopen Agent B's Write request");

  assert.equal(modalTool(), "Write");
  assert.equal(drawerRows().length, 0, "choosing the row closes the drawer");
  assert.deepEqual(app.answers, []);
  assert.deepEqual(app.focused, []);
});

test("focusing a deferred request's terminal from its row leaves the request waiting", async () => {
  const app = await render([request("req-1", "term-a", "Bash")]);
  await click("Later");

  await click("Focus Agent A");

  assert.deepEqual(app.focused, ["term-a"]);
  await app.openDrawer();
  assert.equal(drawerRows().length, 1);
  assert.match(drawerRows()[0], /Permission request: Bash, deferred/);
  assert.equal(modalTool(), null);
});

test("a terminal past its cap of 20 requests shows how many older ones are not shown, once", async () => {
  const flood = Array.from({ length: 23 }, (_, i) => request(`flood-${i + 1}`, "term-a", "Bash"));
  await render([...flood, request("quiet-1", "term-b", "Write")]);

  const rows = drawerRows();
  const agentA = rows.filter((row) => row.startsWith("Agent A"));
  assert.equal(agentA.length, 20);
  assert.deepEqual(
    rows.filter((row) => row.includes("older not shown")).map((row) => row.match(/\+\d+ older not shown/)?.[0]),
    ["+3 older not shown"]
  );
  assert.match(agentA[0], /\+3 older not shown/, "the count sits on the terminal's oldest row");
  assert.doesNotMatch(rows.find((row) => row.startsWith("Agent B")) ?? "", /older not shown/);
});
