/// <reference types="node" />
// Component tests for the Projects panel's ticket pipeline (#651): the real `ProjectsPanel` with a
// lane on each terminal row that holds a ticket, the Ready to start and Blocked lists under the
// terminals, and the lane's moves. The lanes and lists come in through the `pipeline` prop, so
// nothing out of process is reached.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GithubIssue } from "../github/types.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { TicketLane } from "./ticketLane.ts";
import type { ProjectsPipeline } from "./ProjectsPanel.tsx";

const { ProjectsPanel } = await import("./ProjectsPanel.tsx");

const ALPHA: Project = { path: "E:/alpha", name: "alpha", terminal_ids: [] };
const term = (id: string, name: string): TerminalInfo => ({
  id,
  name,
  project_path: ALPHA.path,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
});
const AGENT = term("t1", "agent");
const SHELL = term("t2", "shell");

const lane = (over: Partial<TicketLane> = {}): TicketLane => ({
  number: 651,
  title: "Projects panel: ticket pipeline lanes",
  steps: [
    { id: "ticket", label: "Ticket", tone: "done" },
    { id: "terminal", label: "Terminal", tone: "done" },
    { id: "pull-request", label: "Pull request", tone: "current" },
    { id: "merged", label: "Merged", tone: "todo" },
  ],
  current: "pull-request",
  stateLine: "PR #574 · checks passing · ready to merge",
  needsYou: "Merge",
  blocker: null,
  assignee: "you",
  age: "5m",
  canMerge: true,
  ...over,
});

const issue = (number: number, over: Partial<GithubIssue> = {}): GithubIssue => ({
  number,
  title: `Ticket ${number}`,
  state: "OPEN",
  labels: [],
  assignees: [],
  updatedAt: "2026-11-15T10:00:00Z",
  url: "",
  blockedBy: [],
  openBlockerCount: 0,
  ...over,
});

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

function render(over: Partial<ProjectsPipeline> = {}, laneFor: (t: TerminalInfo) => TicketLane | null = (t) => (t.id === AGENT.id ? lane() : null)) {
  fakeInvoke(async () => null);
  const calls: string[] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))].join(" "));
  const pipeline: ProjectsPipeline = {
    laneOf: laneFor,
    listsOf: () => ({
      lists: {
        ready: { shown: [issue(1), issue(2), issue(3)], more: 4 },
        blocked: { shown: [issue(5, { blockedBy: [{ number: 650, title: "", state: "OPEN", url: "", repoNwo: "o/r" }], openBlockerCount: 1 })], more: 0 },
        mergedToday: 2,
      },
      complete: true,
    }),
    onMerge: (t) => calls.push(`merge ${t.id}`),
    onOpenTicket: log("open"),
    onClose: log("close"),
    start: { implement: log("implement"), triage: log("triage"), newWorktree: log("newWorktree") },
    onMore: log("more"),
    ...over,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() =>
    root.render(
      createElement(ProjectsPanel, {
        projects: [ALPHA],
        activeProject: ALPHA.path,
        terminals: [AGENT, SHELL],
        activeTerminalId: null,
        bridgePort: 0,
        projectWorktrees: {},
        onSelectTerminal: log("select"),
        onCloseTerminal: () => {},
        onNewTerminal: () => {},
        onSelectProject: () => {},
        onAddProject: () => {},
        onRemoveProject: () => {},
        pipeline,
      }),
    ),
  );
  return { container, calls };
}

const lanes = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-lane]")];
const button = (scope: HTMLElement, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);

test("a terminal holding a ticket shows its lane; a plain shell keeps its one-line row", () => {
  const { container } = render();
  const [only, ...rest] = lanes(container);
  assert.equal(rest.length, 0);
  assert.equal(only.getAttribute("data-lane"), AGENT.id);
  assert.match(only.textContent ?? "", /#651/);
  assert.match(only.textContent ?? "", /Projects panel: ticket pipeline lanes/);
  const steps = [...only.querySelectorAll<HTMLElement>("[data-step]")].map((s) => `${s.textContent}:${s.getAttribute("data-tone")}`);
  assert.deepEqual(steps, ["Ticket:done", "Terminal:done", "Pull request:current", "Merged:todo"]);
  assert.match(only.textContent ?? "", /PR #574 · checks passing · ready to merge/);
  assert.equal(only.querySelector("[data-needs-you]")?.textContent, "Merge");
  assert.equal(only.querySelector("[data-assignee]")?.getAttribute("aria-label"), "Assigned to you");
  assert.match(only.querySelector("[data-age]")?.textContent ?? "", /5m/);
});

test("picking a lane selects its terminal; Merge starts the lane terminal's merge", () => {
  const { container, calls } = render();
  const [only] = lanes(container);
  act(() => button(only, "Select agent: #651 Projects panel: ticket pipeline lanes")!.click());
  act(() => button(only, "Merge #651")!.click());
  assert.deepEqual(calls, ["select t1", "merge t1"]);
});

test("Merge shows only while the readiness card would read Ready to merge", () => {
  const { container } = render({}, (t) => (t.id === AGENT.id ? lane({ canMerge: false, needsYou: null, stateLine: "PR #574 · checks passing · review required" }) : null));
  assert.equal(button(lanes(container)[0], "Merge #651"), undefined);
});

test("a blocked lane names its blocker, which opens in the companion", () => {
  const { container, calls } = render({}, (t) =>
    t.id === AGENT.id ? lane({ blocker: { repo: "o/r", number: 650 }, canMerge: false, needsYou: null, stateLine: "Blocked by #650" }) : null,
  );
  act(() => button(lanes(container)[0], "Jump to the blocker #650")!.click());
  assert.deepEqual(calls, ['open E:/alpha {"repo":"o/r","number":650}']);
});

test("Close offers completed, not planned and duplicate, and closes the lane's ticket with the one picked", () => {
  const { container, calls } = render();
  const select = lanes(container)[0].querySelector<HTMLSelectElement>("select[aria-label='Close #651']");
  assert.ok(select);
  assert.deepEqual([...select.options].slice(1).map((o) => o.textContent), ["completed", "not planned", "duplicate"]);
  act(() => {
    select.value = "NOT_PLANNED";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.deepEqual(calls, ['close E:/alpha {"repo":null,"number":651} NOT_PLANNED']);
});

test("Ready to start and Blocked list their tickets with +N into Source control, and Merged today counts the rest", () => {
  const { container, calls } = render();
  const ready = container.querySelector<HTMLElement>("[aria-label='Ready to start']");
  const blocked = container.querySelector<HTMLElement>("[aria-label='Blocked']");
  assert.ok(ready && blocked);
  assert.deepEqual([...ready.querySelectorAll("[data-ticket]")].map((r) => r.getAttribute("data-ticket")), ["1", "2", "3"]);
  assert.deepEqual([...blocked.querySelectorAll("[data-ticket]")].map((r) => r.getAttribute("data-ticket")), ["5"]);
  assert.match(container.textContent ?? "", /Merged today · 2/);
  act(() => button(ready, "+4")!.click());
  act(() => button(ready, "#1 Ticket 1")!.click());
  act(() => button(ready, "Implement")!.click());
  act(() => button(blocked, "Jump to the blocker #650")!.click());
  assert.deepEqual(calls, [
    "more",
    'open E:/alpha {"repo":null,"number":1}',
    'implement {"repoPath":"E:/alpha","repo":null,"number":1,"title":"Ticket 1"}',
    'open E:/alpha {"repo":"o/r","number":650}',
  ]);
});
