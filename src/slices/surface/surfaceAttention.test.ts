/// <reference types="node" />
// Surfaces that ask for attention (#718), with only Tauri's `invoke` and events faked: what waits on
// the operator while a surface asks, and the marks on its terminal.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, useEffect, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AttentionItem } from "../attention/attentionQueue.ts";
import { terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import { nextWaitingTerminal, statusRows, waitingTerminals } from "../shell/terminalStatus.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

const { startSurfaces } = await import("./surfaceHost.ts");
const { useAttentionQueue } = await import("../attention/useAttentionQueue.ts");
const { AgentsPanel } = await import("../agents/AgentsPanel.tsx");
const { TerminalStatusList } = await import("../shell/TerminalStatusList.tsx");

const PROJECT = "E:/alpha";
const T1: TerminalInfo = { ...terminalInfo("t1", PROJECT), name: "fix-75", claude_status: "working" };
const T2: TerminalInfo = { ...terminalInfo("t2", PROJECT), name: "docs", claude_status: "working" };

/** The surfaces Rust holds when the page loads. */
let list: SurfaceRecord[];
let mounted: { root: Root; container: HTMLElement } | null = null;
let change = 0;

beforeEach(() => {
  list = [];
  change = 0;
  fakeInvoke(async (cmd) => {
    if (cmd === "surface_list") return list;
    return cmd === "surface_checks" || cmd === "list_claude_sessions" || cmd === "get_pending_permissions" ? [] : null;
  });
});
afterEach(async () => {
  if (!mounted) return;
  const { root, container } = mounted;
  await act(async () => root.unmount());
  container.remove();
  mounted = null;
});

/** Lets what is under way finish: promises and what they draw. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 10))));

/** The surface `id`, of terminal `t1` unless `over` says another, as Rust holds it. */
function surface(id: string, over: Partial<SurfaceRecord> = {}): SurfaceRecord {
  change += 1;
  const state: SurfaceRecord["state"] = { version: "1.0", createSurface: { surfaceId: id, components: [], dataModel: {} } };
  return { terminal_id: "t1", id, tool: "quay_ask", state, revision: 1, order: change, change, asks: true, answer: null, ...over };
}
const shown = (record: SurfaceRecord) => act(async () => emitEvent("surface-changed", record));
const answered = (record: SurfaceRecord) => shown({ ...record, change: (change += 1), answer: { answers: [] } });
const removed = ({ terminal_id, id }: SurfaceRecord) => act(async () => emitEvent("surface-removed", { terminal_id, id }));
const turnEnds = (terminalId: string) => act(async () => emitEvent("bridge-event", { type: "turn.completed", tag: terminalId, data: {} }));

let opened: AttentionItem[] = [];
let nextWait: string | null = null;
let badge = 0;

/** What of Quay's window shows who waits: the Agents panel, its badge's count and the module bar's dots. */
const Waiting: FC<{ terminals: TerminalInfo[] }> = ({ terminals }) => {
  useEffect(startSurfaces, []);
  const queue = useAttentionQueue(terminals);
  const rows = statusRows(terminals, [], {}, waitingTerminals(queue.items));
  nextWait = nextWaitingTerminal(rows, null);
  badge = queue.items.length;
  return createElement(
    Fragment,
    null,
    createElement(TerminalStatusList, { rows, selectedTerminalId: null, onSelectTerminal: () => {}, onOpenProjects: () => {} }),
    createElement(AgentsPanel, {
      isOpen: true,
      project: PROJECT,
      terminals,
      messages: [],
      waiting: queue.items,
      selectedTerminalId: null,
      sessionHistoryRequest: null,
      onSelectTerminal: () => {},
      onOpenWaiting: (item) => void opened.push(item),
      onOpenReply: () => {},
      savedSwarms: [],
      onLaunchSwarm: () => {},
      onOpenSwarmBuilder: () => {},
      onResumeSession: () => {},
    }),
  );
};

async function mount(element: Parameters<Root["render"]>[0]): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  await settle();
  return container;
}

const waitingButtons = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('section[aria-label="Waiting on you"] li button')];
const waitingRows = (container: HTMLElement) => waitingButtons(container).map((row) => row.getAttribute("aria-label"));
const dots = (container: HTMLElement) => [...container.querySelectorAll('[aria-label="Terminals"] > li')].map((li) => li.getAttribute("data-status"));

test("a question is in Waiting on you, the badge's count, the module bar's dot and Next wait, until it settles", async () => {
  opened = [];
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  const ask = surface("ask_1", { terminal_id: "t2" });
  await shown(ask);

  assert.deepEqual(waitingRows(container), ["docs: question for you"]);
  assert.deepEqual([badge, nextWait], [1, "t2"]);
  assert.deepEqual(dots(container), ["working", "waiting"]);
  await act(async () => waitingButtons(container)[0].click());
  assert.deepEqual(
    opened.map((item) => item.kind === "surface" && [item.terminalId, item.surfaceId]),
    [["t2", "ask_1"]],
  );

  await answered(ask);
  assert.deepEqual(waitingRows(container), []);
  assert.deepEqual([badge, nextWait], [0, null]);
  assert.deepEqual(dots(container), ["working", "working"]);
});

test("a question removed, and a surface that asks nothing, do not wait on the operator", async () => {
  const container = await mount(createElement(Waiting, { terminals: [T1] }));
  const ask = surface("ask_1");
  await shown(ask);
  await shown(surface("plain", { asks: false }));
  assert.deepEqual(waitingRows(container), ["fix-75: question for you"]);
  await removed(ask);
  assert.deepEqual(waitingRows(container), []);
});

test("a question takes the place of its terminal's finished turn, and another terminal's stays", async () => {
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  await turnEnds("t1");
  await turnEnds("t2");
  await shown(surface("ask_1"));
  assert.deepEqual(waitingRows(container), ["docs: finished its turn", "fix-75: question for you"]);
});

test("questions Rust already holds when the page loads wait too, and those of a terminal that closes go", async () => {
  list = [surface("ask_1"), surface("ask_1", { terminal_id: "t2" })];
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  assert.deepEqual(waitingRows(container), ["fix-75: question for you", "docs: question for you"]);
  await act(async () => mounted!.root.render(createElement(Waiting, { terminals: [T2] })));
  await shown(surface("ask_2", { terminal_id: "t2" }));
  assert.deepEqual(waitingRows(container), ["docs: question for you", "docs: question for you"]);
});
