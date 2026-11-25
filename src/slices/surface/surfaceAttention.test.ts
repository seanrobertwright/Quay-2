/// <reference types="node" />
// Surfaces that ask for attention (#718), with only Tauri's `invoke` and events faked: what waits on
// the operator while a surface asks, and the marks on its terminal.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, useEffect, type FC } from "react";
import type { AttentionItem } from "../attention/attentionQueue.ts";
import { nextWaitingTerminal, statusRows, waitingTerminals } from "../shell/terminalStatus.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { companionPrefs } from "../companion/companionPrefs.ts";
import { memoryStorage, terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import { answered, arrives, changed, emit, mount, redraw, removed, surface, unmount } from "./fixtures/surfaceFixtures.ts";
import type { SurfaceKey, SurfaceRecord } from "./surfaceTypes.ts";

const { startSurfaces } = await import("./surfaceHost.ts");
const { useAttentionQueue } = await import("../attention/useAttentionQueue.ts");
const { AgentsPanel } = await import("../agents/AgentsPanel.tsx");
const { TerminalStatusList } = await import("../shell/TerminalStatusList.tsx");
const { TerminalRow } = await import("../rail/TerminalRow.tsx");
const { Companion, COMPANION_VIEWS } = await import("../companion/Companion.tsx");
const { AskingButton } = await import("./AskingButton.tsx");

const PROJECT = "E:/alpha";
const T1: TerminalInfo = { ...terminalInfo("t1", PROJECT), name: "fix-75", claude_status: "working" };
const T2: TerminalInfo = { ...terminalInfo("t2", PROJECT), name: "docs", claude_status: "working" };

/** The surfaces Rust holds when the page loads. */
let list: SurfaceRecord[];

beforeEach(() => {
  list = [];
  fakeInvoke(async (cmd) => {
    if (cmd === "surface_open_page") return { page: 1, unsent: [] };
    if (cmd === "surface_list") return list;
    return cmd === "surface_checks" || cmd === "list_claude_sessions" || cmd === "get_pending_permissions" ? [] : null;
  });
});
afterEach(unmount);

const turnEnds = (terminalId: string) => emit("bridge-event", { type: "turn.completed", tag: terminalId, data: {} });

let opened: AttentionItem[] = [];
let nextWait: string | null = null;
let badge = 0;
let renders = 0;

/** What of Quay's window shows who waits: the Agents panel, its badge's count and the module bar's dots. */
const Waiting: FC<{ terminals: TerminalInfo[] }> = ({ terminals }) => {
  useEffect(startSurfaces, []);
  const queue = useAttentionQueue(terminals);
  const rows = statusRows(terminals, [], {}, waitingTerminals(queue.items));
  nextWait = nextWaitingTerminal(rows, null);
  badge = queue.items.length;
  renders += 1;
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

const waitingButtons = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('section[aria-label="Waiting on you"] li button')];
const waitingRows = (container: HTMLElement) => waitingButtons(container).map((row) => row.getAttribute("aria-label"));
const dots = (container: HTMLElement) => [...container.querySelectorAll('[aria-label="Terminals"] > li')].map((li) => li.getAttribute("data-status"));

test("a question is in Waiting on you, the badge's count, the module bar's dot and Next wait, until it settles", async () => {
  opened = [];
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  const ask = surface("ask_1", { terminal_id: "t2" });
  await arrives(ask);

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
  await arrives(ask);
  await arrives(surface("plain", { asks: false }));
  assert.deepEqual(waitingRows(container), ["fix-75: question for you"]);
  await removed(ask);
  assert.deepEqual(waitingRows(container), []);
});

test("an update of a surface that asks, or of one that does not, draws nothing of who waits again", async () => {
  const container = await mount(createElement(Waiting, { terminals: [T1] }));
  const [ask, board] = [surface("ask_1"), surface("board", { tool: "quay_board", asks: false })];
  await arrives(ask);
  await arrives(board);
  const before = renders;
  for (const record of [ask, board]) await arrives(changed(record, { revision: 2 }));
  assert.equal(renders, before);
  assert.deepEqual(waitingRows(container), ["fix-75: question for you"]);
});

test("a question takes the place of its terminal's finished turn, and another terminal's stays", async () => {
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  await turnEnds("t1");
  await turnEnds("t2");
  await arrives(surface("ask_1"));
  assert.deepEqual(waitingRows(container), ["docs: finished its turn", "fix-75: question for you"]);
});

test("questions Rust already holds when the page loads wait too, and those of a terminal that closes go", async () => {
  list = [surface("ask_1"), surface("ask_1", { terminal_id: "t2" })];
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  assert.deepEqual(waitingRows(container), ["fix-75: question for you", "docs: question for you"]);
  await redraw(createElement(Waiting, { terminals: [T2] }));
  await arrives(surface("ask_2", { terminal_id: "t2" }));
  assert.deepEqual(waitingRows(container), ["docs: question for you", "docs: question for you"]);
});

let openedSurfaces: SurfaceKey[] = [];
let selected = 0;

/** A terminal's row in the Projects panel, with the button of its pane title. */
const Marks: FC<{ terminal: TerminalInfo }> = ({ terminal }) => {
  useEffect(startSurfaces, []);
  const onOpenSurface = (key: SurfaceKey) => void openedSurfaces.push(key);
  return createElement(
    Fragment,
    null,
    createElement(TerminalRow, { index: 1, terminal, isActive: false, onSelect: () => void (selected += 1), onClose: () => {}, onOpenSurface }),
    createElement(AskingButton, { terminalId: terminal.id, onOpen: onOpenSurface }),
  );
};
async function mountMarks(terminal = T1): Promise<HTMLElement> {
  openedSurfaces = [];
  selected = 0;
  return mount(createElement(Marks, { terminal }));
}

const chips = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>("[data-surface-chips] button")];
const names = (buttons: HTMLButtonElement[]) => buttons.map((b) => [b.textContent, b.getAttribute("aria-label")]);
const iconDot = (container: HTMLElement) => container.querySelector("[data-surface-dot]");
const paneButton = (container: HTMLElement) => [...container.querySelectorAll("button")].find((b) => b.textContent?.endsWith("for you")) ?? null;

test("a row has a chip for each live surface, an icon and a word, and a click opens that surface without selecting the row", async () => {
  const container = await mountMarks();
  assert.equal(chips(container).length, 0);
  await arrives(surface("ask_1"));
  await arrives(surface("view", { tool: "quay_surface", asks: false }));
  await arrives(surface("ask_1", { terminal_id: "t2" }));
  assert.deepEqual(names(chips(container)), [
    ["Question", "Question, surface 1 of 2 from fix-75, waiting on you"],
    ["Surface", "Surface, surface 2 of 2 from fix-75"],
  ]);
  assert.ok(chips(container).every((chip) => chip.querySelector("svg") !== null));
  assert.deepEqual(chips(container).map((chip) => chip.querySelector("[data-waiting-dot]") !== null), [true, false], "a shape says which asks, not a color alone");

  await act(async () => chips(container)[1].click());
  assert.deepEqual(openedSurfaces, [{ terminal_id: "t1", id: "view" }]);
  assert.equal(selected, 0);
});

test("past three the rest fold into one chip, which opens the oldest of them", async () => {
  const container = await mountMarks();
  for (const id of ["a", "b", "c"]) await arrives(surface(id));
  assert.deepEqual(chips(container).map((chip) => chip.textContent), ["Question", "Question", "Question"]);
  for (const id of ["d", "e"]) await arrives(surface(id));
  assert.deepEqual(chips(container).map((chip) => chip.textContent), ["Question", "Question", "Question", "+2"]);
  assert.equal(chips(container)[3].getAttribute("aria-label"), "+2 more surfaces from fix-75");
  await act(async () => chips(container)[3].click());
  assert.deepEqual(openedSurfaces, [{ terminal_id: "t1", id: "d" }]);
});

test("past three, those that ask have chips before older ones that ask nothing, which fold", async () => {
  const container = await mountMarks();
  for (const id of ["a", "b", "c"]) await arrives(surface(id, { tool: "quay_board", asks: false }));
  await arrives(surface("d"));
  await arrives(surface("e", { tool: "quay_review" }));
  assert.deepEqual(names(chips(container)), [
    ["Question", "Question, surface 1 of 5 from fix-75, waiting on you"],
    ["Review", "Review, surface 2 of 5 from fix-75, waiting on you"],
    ["Board", "Board, surface 3 of 5 from fix-75"],
    ["+2", "+2 more surfaces from fix-75"],
  ]);
  assert.deepEqual(chips(container).map((chip) => chip.querySelector("[data-waiting-dot]") !== null), [true, true, false, false]);

  for (const chip of chips(container)) await act(async () => chip.click());
  assert.deepEqual(openedSurfaces.map(({ id }) => id), ["d", "e", "a", "b"]);
  assert.equal(selected, 0);
});

test("where more than three ask, the fold opens the oldest of those in it, before an older one that asks nothing", async () => {
  const container = await mountMarks();
  await arrives(surface("a", { tool: "quay_board", asks: false }));
  for (const id of ["b", "c", "d", "e", "f"]) await arrives(surface(id));
  assert.deepEqual(chips(container).map((chip) => chip.textContent), ["Question", "Question", "Question", "+3"]);
  for (const chip of chips(container)) await act(async () => chip.click());
  assert.deepEqual(openedSurfaces.map(({ id }) => id), ["b", "c", "d", "e"]);
});

test("where nothing folds, or none of them asks, chips are oldest first", async () => {
  const container = await mountMarks();
  await arrives(surface("a", { tool: "quay_board", asks: false }));
  const ask = surface("b");
  await arrives(ask);
  await arrives(surface("c", { tool: "quay_surface", asks: false }));
  assert.deepEqual(names(chips(container)), [
    ["Board", "Board, surface 1 of 3 from fix-75"],
    ["Question", "Question, surface 2 of 3 from fix-75, waiting on you"],
    ["Surface", "Surface, surface 3 of 3 from fix-75"],
  ]);

  await arrives(surface("d", { tool: "quay_review", asks: false }));
  assert.deepEqual(chips(container).map((chip) => chip.textContent), ["Question", "Board", "Surface", "+1"]);
  await arrives(surface("e", { tool: "quay_board", asks: false }));
  await answered(ask);
  assert.deepEqual(chips(container).map((chip) => chip.textContent), ["Board", "Surface", "Review", "+1"]);
  await act(async () => chips(container)[3].click());
  assert.deepEqual(openedSurfaces, [{ terminal_id: "t1", id: "e" }]);
});

test("a question puts an amber dot on the row's CLI icon and keeps the status text; a surface that asks nothing puts none", async () => {
  const container = await mountMarks({ ...T1, claude_status: "idle" });
  await arrives(surface("view", { asks: false }));
  assert.equal(iconDot(container) === null, true);
  await arrives(surface("ask_1"));
  const dot = iconDot(container)!;
  assert.ok(dot.className.includes("bg-[#d29922]"));
  assert.ok(dot.parentElement!.querySelector("svg") !== null, "on the CLI's icon");
  assert.equal(dot.textContent, "waiting on you", "in words too");
  assert.ok(container.textContent!.includes("Ready"));
});

test("the pane's button counts every question and opens the oldest", async () => {
  const container = await mountMarks();
  assert.equal(paneButton(container) === null, true);
  const first = surface("ask_1");
  await arrives(first);
  await arrives(surface("view", { asks: false }));
  assert.equal(paneButton(container)!.textContent, "1 question for you");
  await arrives(surface("ask_2"));
  assert.equal(paneButton(container)!.textContent, "2 questions for you");
  assert.equal(paneButton(container)!.getAttribute("aria-label"), "2 questions for you", "also where a narrow pane hides the words");
  await act(async () => paneButton(container)!.click());
  assert.deepEqual(openedSurfaces, [{ terminal_id: "t1", id: "ask_1" }]);
  await answered(first);
  await act(async () => paneButton(container)!.click());
  assert.deepEqual(openedSurfaces[1], { terminal_id: "t1", id: "ask_2" });
});

test("a question whose terminal exited waits on nobody", async () => {
  const container = await mount(createElement(Waiting, { terminals: [T1, T2] }));
  const ask = surface("ask_1");
  await arrives(ask);
  assert.deepEqual([waitingRows(container).length, badge, nextWait], [1, 1, "t1"]);
  await arrives(changed(ask, { ended_at: 1 }));
  assert.deepEqual([waitingRows(container).length, badge, nextWait], [0, 0, null]);
});

test("a question whose terminal exited has no chip, no dot and no button", async () => {
  const container = await mountMarks();
  const ask = surface("ask_1");
  await arrives(ask);
  assert.ok(chips(container).length === 1 && iconDot(container) !== null && paneButton(container) !== null);
  await arrives(changed(ask, { ended_at: 1 }));
  assert.ok(chips(container).length === 0 && iconDot(container) === null && paneButton(container) === null);
});

test("when the last question settles, its chip, its dot and the pane's button go at once", async () => {
  const container = await mountMarks();
  const ask = surface("ask_1");
  await arrives(ask);
  assert.deepEqual([chips(container).length, iconDot(container) !== null, paneButton(container) !== null], [1, true, true]);
  await answered(ask);
  assert.deepEqual([chips(container).length, iconDot(container) !== null, paneButton(container) !== null], [0, false, false]);
});

/** `record`, which counts each time what it is waiting for is read, under its terminal. */
function counted(record: SurfaceRecord, reads: Map<string, number>): SurfaceRecord {
  return new Proxy(record, {
    get(target, property, receiver) {
      if (property === "asks" || property === "answer") reads.set(target.terminal_id, (reads.get(target.terminal_id) ?? 0) + 1);
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Every terminal's row and pane button, with who waits on the operator and the companion on the first terminal. */
const Everything: FC<{ terminals: TerminalInfo[]; tick: number }> = ({ terminals, tick }) => {
  useEffect(startSurfaces, []);
  const queue = useAttentionQueue(terminals);
  badge = queue.items.length;
  return createElement(
    Fragment,
    null,
    ...terminals.map((terminal) =>
      createElement(
        Fragment,
        { key: terminal.id },
        createElement(TerminalRow, { index: tick, terminal, isActive: false, onSelect: () => {}, onClose: () => {}, onOpenSurface: () => {} }),
        createElement(AskingButton, { terminalId: terminal.id, onOpen: () => {} }),
      ),
    ),
    createElement(Companion, {
      // On a view other than Surface, whose frames read their own surfaces
      selectedTerminal: { ...terminals[0], id: "none" },
      projects: [],
      projectWorktrees: {},
      views: COMPANION_VIEWS,
      prefs: companionPrefs(memoryStorage()),
      activity: { events: [], messages: [], waiting: queue.items, answer: queue.answerPermission },
    }),
  );
};

test("with the limits full in twelve terminals, a render reads no surface again, and a change reads its own terminal's", async () => {
  const terminals = Array.from({ length: 12 }, (_, i): TerminalInfo => ({ ...terminalInfo(`t${i}`, PROJECT), name: `agent-${i}` }));
  const reads = new Map<string, number>();
  for (const { id } of terminals) {
    // Four live in each of the three places, the strip's asking nothing, and ten locked
    for (let i = 0; i < 12; i += 1) list.push(counted(surface(`live_${i}`, { terminal_id: id, asks: i < 8 }), reads));
    for (let i = 0; i < 10; i += 1) list.push(counted(surface(`locked_${i}`, { terminal_id: id, answer: { answers: [] } }), reads));
  }
  const container = await mount(createElement(Everything, { terminals, tick: 1 }));
  assert.equal(badge, 12 * 8);
  assert.equal(container.querySelectorAll("[data-surface-chips] button").length, 12 * 4, "three and the rest, on each row");
  assert.equal(reads.size, 12, "each was read to know it");

  reads.clear();
  for (let tick = 2; tick < 12; tick += 1) await redraw(createElement(Everything, { terminals, tick }));
  assert.equal(reads.size, 0, "ten renders read nothing");

  const first = list.find(({ terminal_id, id }) => terminal_id === "t3" && id === "live_0")!;
  const settled = counted(changed(first, { answer: { answers: [] } }), reads);
  reads.clear();
  await arrives(settled);
  assert.equal(badge, 12 * 8 - 1);
  assert.deepEqual([...reads.keys()], ["t3"]);
});
