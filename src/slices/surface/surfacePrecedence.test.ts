/// <reference types="node" />
// Which view the companion shows while a surface asks (#718), with only Tauri's `invoke` and events
// faked. It draws the real companion over the real attention queue and surface store.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useEffect, type ComponentProps, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { companionPrefs } from "../companion/companionPrefs.ts";
import { memoryStorage, terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

const { startSurfaces } = await import("./surfaceHost.ts");
const { useAttentionQueue } = await import("../attention/useAttentionQueue.ts");
const { Companion, COMPANION_VIEWS } = await import("../companion/Companion.tsx");

const PROJECT = "E:/alpha";
const T1: TerminalInfo = { ...terminalInfo("t1", PROJECT), name: "fix-75" };
const T2: TerminalInfo = { ...terminalInfo("t2", PROJECT), name: "docs" };

/** What Rust holds when the page loads, and when it says so. */
let surfaceList: () => Promise<SurfaceRecord[]>;
let permissionList: () => Promise<unknown[]>;
let mounted: { root: Root; container: HTMLElement } | null = null;
let change = 0;

beforeEach(() => {
  surfaceList = async () => [];
  permissionList = async () => [];
  change = 0;
  fakeInvoke(async (cmd) => {
    if (cmd === "surface_list") return surfaceList();
    if (cmd === "get_pending_permissions") return permissionList();
    if (cmd === "get_github_issue_status") return new Promise(() => {});
    return cmd === "surface_checks" ? [] : null;
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
  const text = { id: "root", component: "Text", text: `What ${id} says` };
  const state: SurfaceRecord["state"] = { version: "1.0", createSurface: { surfaceId: id, catalogId: "urn:quay:a2ui:catalog:v1", components: [text], dataModel: {} } };
  return { terminal_id: "t1", id, tool: "quay_ask", state, revision: 1, order: change, change, asks: true, answer: null, ...over };
}
const permission = (requestId: string, terminalId: string) => ({ requestId, sessionId: "s", tag: terminalId, tool: "Bash", input: { command: "ls" } });

async function emit(event: string, payload: unknown): Promise<void> {
  await act(async () => emitEvent(event, payload));
  await settle();
}
const arrives = (record: SurfaceRecord) => emit("surface-changed", record);
const answered = (record: SurfaceRecord) => emit("surface-changed", { ...record, change: (change += 1), answer: { answers: [] } });
const asksPermission = (requestId: string, terminalId = "t1") => emit("permission-requested", permission(requestId, terminalId));

type Extra = Partial<Pick<ComponentProps<typeof Companion>, "showRequest" | "run" | "inspector" | "ticket" | "onShowTicket">>;

/** The companion as Quay's window draws it, with `selected` selected. */
const Window: FC<{ selected: TerminalInfo | null; extra: Extra }> = ({ selected, extra }) => {
  useEffect(startSurfaces, []);
  const queue = useAttentionQueue([T1, T2]);
  return createElement(Companion, {
    selectedTerminal: selected,
    projects: [{ path: PROJECT, name: "Alpha", terminal_ids: ["t1", "t2"] }],
    projectWorktrees: {},
    views: COMPANION_VIEWS,
    prefs: companionPrefs(memoryStorage()),
    activity: { events: [], messages: [], waiting: queue.items, permissionsRead: queue.permissionsRead, answer: queue.answerPermission },
    ...extra,
  });
};

let current: { selected: TerminalInfo | null; extra: Extra };
async function open(selected: TerminalInfo | null = T1, extra: Extra = {}): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = { root: createRoot(container), container };
  current = { selected: null, extra: {} };
  await draw({ selected, extra });
  return container;
}
/** Draws the window again with `next` changed. */
async function draw(next: Partial<typeof current>): Promise<void> {
  current = { ...current, ...next };
  await act(async () => mounted!.root.render(createElement(Window, current)));
  await settle();
}
const select = (selected: TerminalInfo | null) => draw({ selected });

const view = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-companion-view]")?.dataset.companionView;
const entries = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[aria-label="Companion view"] [role="radio"]')];
const entry = (container: HTMLElement, name: string) => entries(container).find((e) => e.textContent === name)!;
const pick = async (container: HTMLElement, name: string) => {
  await act(async () => entry(container, name).click());
  await settle();
};
/** The entry's name as a screen reader says it. */
const said = (container: HTMLElement, name: string) => entry(container, name).getAttribute("aria-label") ?? name;
const dotted = (container: HTMLElement, name: string) => entry(container, name).querySelector("[data-waiting-dot]") !== null;

test("a question from the selected terminal switches to the Surface view, and back to the earlier view when it settles", async () => {
  const container = await open();
  await pick(container, "Activity");
  const ask = surface("ask_1");
  await arrives(ask);
  assert.equal(view(container), "surface");
  await answered(ask);
  assert.equal(view(container), "activity");
});

test("the view stays while another question of the terminal still waits", async () => {
  const container = await open();
  const [first, second] = [surface("ask_1"), surface("ask_2")];
  await arrives(first);
  await arrives(second);
  await answered(first);
  assert.equal(view(container), "surface");
  await answered(second);
  assert.equal(view(container), "repository");
});

test("a surface that asks nothing, and a question from another terminal, switch nothing", async () => {
  const container = await open();
  await arrives(surface("plain", { asks: false }));
  await arrives(surface("ask_1", { terminal_id: "t2" }));
  assert.equal(view(container), "repository");
});

test("a question does not switch off a pending permission in Activity; the Surface entry shows the waiting dot", async () => {
  const container = await open();
  await asksPermission("req-1");
  await pick(container, "Activity");
  const ask = surface("ask_1");
  await arrives(ask);
  assert.equal(view(container), "activity");
  assert.ok(dotted(container, "Surface"));
  assert.equal(said(container, "Surface"), "Surface, waiting on you");

  await pick(container, "Surface");
  assert.equal(view(container), "surface");
  assert.ok(!dotted(container, "Surface"), "it is on screen");
  await answered(ask);
  assert.equal(view(container), "activity", "where the permission still waits");
});

test("the dot goes when the question settles unseen, and deciding the card switches nothing", async () => {
  const container = await open();
  await asksPermission("req-1");
  await pick(container, "Activity");
  const ask = surface("ask_1");
  await arrives(ask);
  await emit("permission-resolved", { requestId: "req-1" });
  assert.equal(view(container), "activity");
  await answered(ask);
  assert.ok(!dotted(container, "Surface"));
  assert.equal(said(container, "Surface"), "Surface");
});

test("Activity with no card, or with another terminal's permission pending, does not hold a question back", async () => {
  const container = await open();
  await asksPermission("req-1", "t2");
  await pick(container, "Activity");
  await arrives(surface("ask_1"));
  assert.equal(view(container), "surface");
});

const run = (undecided: boolean) => ({ key: "archon:run-1", content: createElement("p", null, "The run"), undecided });

test("a question does not switch off a run's undecided card, and does off a run with nothing to decide", async () => {
  const container = await open(T1, { run: run(true), showRequest: { terminalId: "t1", view: "run", seq: 1 } });
  assert.equal(view(container), "run");
  await arrives(surface("ask_1"));
  assert.equal(view(container), "run");
  assert.ok(dotted(container, "Surface"));

  await draw({ extra: { ...current.extra, run: run(false) } });
  assert.equal(view(container), "run", "nothing new arrived");
  await arrives(surface("ask_2"));
  assert.equal(view(container), "surface");
});

test("an undecided run that is not on screen holds nothing back", async () => {
  const container = await open(T1, { run: run(true) });
  await arrives(surface("ask_1"));
  assert.equal(view(container), "surface");
});

test("a permission never switches the view by itself, with a question on screen or without", async () => {
  const container = await open();
  await asksPermission("req-1");
  assert.equal(view(container), "repository");
  await arrives(surface("ask_1"));
  assert.equal(view(container), "surface");
  await asksPermission("req-2");
  assert.equal(view(container), "surface");
});

test("selecting a terminal with a question opens the Surface view, and with a pending permission too, Activity", async () => {
  const container = await open();
  await arrives(surface("ask_1", { terminal_id: "t2" }));
  await select(T2);
  assert.equal(view(container), "surface");

  await select(T1);
  assert.equal(view(container), "repository");
  await asksPermission("req-1", "t2");
  await select(T2);
  assert.equal(view(container), "activity");
  assert.ok(dotted(container, "Surface"));
});

test("selecting a terminal with a pending permission and no question, or a settled one, opens what it opened before", async () => {
  const container = await open();
  await asksPermission("req-1", "t2");
  await arrives({ ...surface("ask_1", { terminal_id: "t2" }), answer: { answers: [] } });
  await select(T2);
  assert.equal(view(container), "repository");
});

test("a view picked over a question holds until another question arrives", async () => {
  const container = await open();
  await arrives(surface("ask_1"));
  await pick(container, "Repository");
  assert.equal(view(container), "repository");
  assert.ok(dotted(container, "Surface"));
  await arrives({ ...surface("ask_1"), order: 1, revision: 2 });
  assert.equal(view(container), "repository", "an update of the same question");
  await arrives(surface("ask_2"));
  assert.equal(view(container), "surface");
});

test("the Surface view picked with nothing asking is the earlier view of a question that comes later", async () => {
  const container = await open();
  await arrives(surface("plain", { asks: false }));
  await pick(container, "Surface");
  const ask = surface("ask_1");
  await arrives(ask);
  await answered(ask);
  assert.equal(view(container), "surface");
});

test("a request for a view is kept over a question, and one for the question returns to the earlier view", async () => {
  const container = await open();
  const ask = surface("ask_1", { terminal_id: "t2" });
  await arrives(ask);
  await draw({ selected: T2, extra: { showRequest: { terminalId: "t2", view: "activity", seq: 1 } } });
  assert.equal(view(container), "activity");
  await draw({ extra: { showRequest: { terminalId: "t2", view: "surface", seq: 2 } } });
  assert.equal(view(container), "surface");
  await answered(ask);
  assert.equal(view(container), "activity");
});

test("a question shows over a ticket that was handed in, which is back when it settles, and a ticket handed in later over the question", async () => {
  const ticket = { repoPath: PROJECT, repo: null, number: 12, seq: 1 };
  const container = await open(T1, { ticket });
  assert.equal(view(container), "ticket");
  const ask = surface("ask_1");
  await arrives(ask);
  assert.equal(view(container), "surface");
  await draw({ extra: { ticket: { ...ticket, number: 13, seq: 2 } } });
  assert.equal(view(container), "ticket");
  await arrives(surface("ask_2"));
  assert.equal(view(container), "surface");
  await pick(container, "Repository");
  assert.equal(view(container), "repository", "the pick leaves the ticket too");
});

test("a reload of the pull request after a merge is no ask to see it, and leaves the question on screen", async () => {
  const container = await open();
  const ask = surface("ask_1");
  await arrives(ask);
  const reload = { terminalId: "t1", view: "pull-request" as const, pullRequest: { kind: "reload" as const }, seq: 1 };
  await draw({ extra: { showRequest: reload } });
  assert.equal(view(container), "surface");
});

test("a card under a handed-in ticket is not on screen and holds nothing back", async () => {
  const container = await open();
  await asksPermission("req-1");
  await pick(container, "Activity");
  await draw({ extra: { ticket: { repoPath: PROJECT, repo: null, number: 12, seq: 1 } } });
  assert.equal(view(container), "ticket");
  await arrives(surface("ask_1"));
  assert.equal(view(container), "surface");
});

test("a question shows over the Praxis Builder's inspector and gives it back; opening the builder leaves the question", async () => {
  const inspector = { slot: () => {} };
  const container = await open(T1, { inspector });
  assert.equal(view(container), "inspector");
  const ask = surface("ask_1");
  await arrives(ask);
  assert.equal(view(container), "surface");
  await answered(ask);
  assert.equal(view(container), "inspector");

  await draw({ extra: {} });
  await arrives(surface("ask_2"));
  assert.equal(view(container), "surface");
  await draw({ extra: { inspector } });
  assert.equal(view(container), "inspector");
});

test("a request for one of several surfaces brings it into view, once a request", async () => {
  const container = await open();
  await arrives(surface("ask_1"));
  await arrives(surface("ask_2"));
  const scrolled: (string | undefined)[] = [];
  const { scrollIntoView } = Element.prototype;
  Element.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.surface);
  };
  try {
    const showRequest = { terminalId: "t1", view: "surface" as const, surfaceId: "ask_2", seq: 1 };
    await draw({ extra: { showRequest } });
    await arrives(surface("ask_3"));
    assert.deepEqual(scrolled, ["ask_2"]);
    await draw({ extra: { showRequest: { ...showRequest, surfaceId: "ask_1", seq: 2 } } });
    await draw({ extra: { showRequest: { ...showRequest, surfaceId: "gone", seq: 3 } } });
    assert.deepEqual(scrolled, ["ask_2", "ask_1"]);
    assert.equal(view(container), "surface");
  } finally {
    Element.prototype.scrollIntoView = scrollIntoView;
  }
});

/** A promise the test resolves. */
function later<T>(): { promise: Promise<T>; resolve: (value: T) => Promise<void> } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return {
    promise,
    resolve: async (value) => {
      resolve(value);
      await settle();
    },
  };
}

for (const order of ["surfaces first", "permissions first"]) {
  test(`a reload that restores a terminal with a question and a pending permission opens Activity, ${order}`, async () => {
    const [surfaces, permissions] = [later<SurfaceRecord[]>(), later<unknown[]>()];
    surfaceList = () => surfaces.promise;
    permissionList = () => permissions.promise;
    const container = await open();
    assert.equal(view(container), "repository");
    const answers = [() => surfaces.resolve([surface("ask_1")]), () => permissions.resolve([permission("req-1", "t1")])];
    if (order === "permissions first") answers.reverse();
    for (const answer of answers) {
      assert.equal(view(container), "repository", "not before both are read");
      await answer();
    }
    assert.equal(view(container), "activity");
    assert.ok(dotted(container, "Surface"));
  });
}

test("a reload that restores a terminal with only a question opens the Surface view, also when the selection comes last", async () => {
  surfaceList = async () => [surface("ask_1")];
  const container = await open(null);
  await select(T1);
  assert.equal(view(container), "surface");
});

test("a question shows when the pending permissions cannot be read", async () => {
  permissionList = async () => {
    throw "no";
  };
  const { error } = console;
  console.error = () => {};
  try {
    const container = await open();
    await arrives(surface("ask_1"));
    assert.equal(view(container), "surface");
  } finally {
    console.error = error;
  }
});

test("a question shows when the list of surfaces cannot be read", async () => {
  surfaceList = async () => {
    throw "no";
  };
  const { error } = console;
  console.error = () => {};
  try {
    const container = await open();
    await arrives(surface("ask_1"));
    assert.equal(view(container), "surface");
  } finally {
    console.error = error;
  }
});

test("a view picked while the page loads is kept", async () => {
  const surfaces = later<SurfaceRecord[]>();
  surfaceList = () => surfaces.promise;
  const container = await open();
  await pick(container, "Activity");
  await surfaces.resolve([]);
  assert.equal(view(container), "activity");
});
