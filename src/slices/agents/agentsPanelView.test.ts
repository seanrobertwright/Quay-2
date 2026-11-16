/// <reference types="node" />
// Component tests for the Agents panel (#644): Waiting on you, agents in the project, saved swarms
// and session history, top to bottom, and what picking each row does. Tauri's `invoke`, the
// out-of-process boundary, is faked: `list_claude_sessions` lists the sessions the backend finds.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { AttentionItem } from "../attention/attentionQueue.ts";
import type { SwarmPreset } from "../orchestrator/swarmTypes.ts";
import type { ClaudeSessionSummary } from "../sessions/types.ts";

const { AgentsPanel } = await import("./AgentsPanel.tsx");

const PROJECT = "C:/repo";
const terminal = (id: string, name: string, over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id,
  name,
  project_path: PROJECT,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
  ...over,
});
const TERMINALS = [terminal("a", "builder", { claude_status: "working" }), terminal("b", "reviewer"), terminal("sh", "shell", { run_kind: "powershell" })];
const MESSAGES: TrailMessage[] = [
  { id: "m1", from_terminal: "user", from_name: "You", to_terminal: "b", content: "review it", as_user: true, timestamp: 1_000, status: "completed", response: "Looks good, one nit" },
];
const swarm = (id: string): SwarmPreset => ({ id, title: `Swarm ${id}`, description: "", layout: "single", agents: [] });
const session = (session_id: string, last_prompt: string): ClaudeSessionSummary => ({
  session_id,
  project_path: PROJECT,
  last_prompt,
  timestamp_ms: 1_000,
  file_size_bytes: 10,
  message_count: 3,
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
  selected: string[];
  waiting: AttentionItem[];
  replies: [string, string][];
  launched: string[];
  builder: number;
  resumed: [string, string][];
  sessionQueries: Record<string, unknown>[];
}

async function render({ waiting = [] as AttentionItem[], savedSwarms = [swarm("1")], sessions = [session("s1", "fix login"), session("s2", "write docs")] } = {}) {
  const calls: Calls = { selected: [], waiting: [], replies: [], launched: [], builder: 0, resumed: [], sessionQueries: [] };
  fakeInvoke(async (command, args) => {
    if (command === "list_claude_sessions") {
      calls.sessionQueries.push(args);
      return sessions;
    }
    throw new Error(`no fake for ${command}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(AgentsPanel, {
        isOpen: true,
        project: PROJECT,
        terminals: TERMINALS,
        messages: MESSAGES,
        waiting,
        selectedTerminalId: null,
        sessionHistoryRequest: null,
        onSelectTerminal: (id: string) => calls.selected.push(id),
        onOpenWaiting: (item: AttentionItem) => calls.waiting.push(item),
        onOpenReply: (terminalId: string, messageId: string) => calls.replies.push([terminalId, messageId]),
        savedSwarms,
        onLaunchSwarm: (preset: SwarmPreset) => calls.launched.push(preset.id),
        onOpenSwarmBuilder: () => calls.builder++,
        onResumeSession: (id: string, path: string) => calls.resumed.push([id, path]),
      }),
    ),
  );
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return { container, calls };
}

const section = (name: string) => document.querySelector(`section[aria-label="${name}"]`) as HTMLElement;
function button(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  assert.equal(found.length, 1, `one button named "${name}", found ${found.length}`);
  return found[0];
}

test("the panel holds Waiting on you, agents in the project, saved swarms and session history, top to bottom", async () => {
  const { container } = await render();
  assert.deepEqual(
    [...container.querySelectorAll("section")].map((s) => s.getAttribute("aria-label")),
    ["Waiting on you", "Agents in the project", "Saved swarms", "Session history"],
  );
  assert.match(section("Waiting on you").textContent ?? "", /Nothing is waiting on you/);
});

const permission = (requestId: string, terminalId: string, waitingSince: number): AttentionItem => ({
  kind: "permission",
  requestId,
  terminalId,
  project: PROJECT,
  tool: "Bash",
  input: { command: "rm -rf dist" },
  waitingSince,
});

test("a permission request is a Waiting on you row; picking it opens it, and the rows scroll past five", async () => {
  const waiting = Array.from({ length: 7 }, (_, i) => permission(`req-${i}`, "a", i));
  const { calls } = await render({ waiting });
  const list = section("Waiting on you").querySelector("ul") as HTMLElement;
  assert.equal(list.querySelectorAll("li").length, 7);
  assert.equal(list.style.overflowY, "auto");
  assert.equal(list.style.maxHeight, `${5 * 40}px`, "five rows show before it scrolls");

  const first = list.querySelector("li button") as HTMLButtonElement;
  assert.equal(first.getAttribute("aria-label"), "builder: Bash permission request");
  await act(async () => first.click());
  assert.deepEqual(calls.waiting.map((item) => (item.kind === "permission" ? item.requestId : null)), ["req-0"]);
});

test("an agent row shows its role, status and latest reply; the row selects the terminal and the preview opens the reply", async () => {
  const { calls } = await render();
  const agents = section("Agents in the project");
  const rows = [...agents.querySelectorAll("li")];
  assert.equal(rows.length, 2, "the shell is not an agent");
  assert.match(rows[0].textContent ?? "", /builder.*claude · full peer.*working/);
  assert.match(rows[1].textContent ?? "", /reviewer.*idle.*Looks good, one nit/);

  await act(async () => button(rows[0], "Select builder").click());
  await act(async () => button(rows[1], "Open reviewer's latest reply in Activity").click());
  assert.deepEqual(calls.selected, ["a"]);
  assert.deepEqual(calls.replies, [["b", "m1"]]);
});

test("saved swarms list up to four with a launch button, and All presets and the builder opens the builder", async () => {
  const { calls } = await render({ savedSwarms: ["1", "2", "3", "4", "5"].map(swarm) });
  const swarms = section("Saved swarms");
  assert.equal(swarms.querySelectorAll("li").length, 4);
  await act(async () => button(swarms, "Launch Swarm 2").click());
  await act(async () => button(swarms, "All presets and the builder").click());
  assert.deepEqual(calls.launched, ["2"]);
  assert.equal(calls.builder, 1);
});

test("session history asks for at most 100 of the project's sessions, filters by the search, and resumes one", async () => {
  const { calls } = await render();
  assert.deepEqual(calls.sessionQueries, [{ projectPath: PROJECT, limit: 100 }]);
  const history = section("Session history");
  assert.equal(history.querySelectorAll("li").length, 2);

  const search = history.querySelector('input[type="search"]') as HTMLInputElement;
  assert.equal(search.getAttribute("aria-label"), "Search sessions");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), "value")!.set!;
    setValue.call(search, "login");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const rows = [...history.querySelectorAll("li")];
  assert.equal(rows.length, 1);
  await act(async () => button(rows[0], "Resume session fix login").click());
  assert.deepEqual(calls.resumed, [["s1", PROJECT]]);
});
