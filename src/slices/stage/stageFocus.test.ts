/// <reference types="node" />
// Component tests for the keyboard on the stage (#771): what a stage tab covers is inert, and closing a
// stage tab leaves the focus on the stage. They render the real stage, with real terminals, into
// happy-dom, with what App holds of the stage tabs around it, and fake only Tauri's `invoke`.
import "../../test-support/bundlerImports.ts";
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";

const { Stage } = await import("./Stage.tsx");
const { focusTerminal } = await import("../terminal/terminalRequests.ts");
const { useOverlay } = await import("../overlay/useOverlay.ts");
const { showShellWarning, dismissShellWarning } = await import("./shellWarnings.ts");

const PROJECT = "C:/work/repo";
const terminal = (id: string, name: string): TerminalInfo => ({
  id,
  name,
  project_path: PROJECT,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
});
const TERMINALS = [terminal("a", "planner"), terminal("b", "coder")];

type StageProps = ComponentProps<typeof Stage>;

let mounted: { root: Root; container: HTMLElement } | null = null;

/** The commands Quay's window has sent Rust. */
let sent: string[] = [];

beforeEach(() => {
  sent = [];
  fakeInvoke(async (command) => {
    sent.push(command);
    return command === "get_terminal_output" ? { data: "ready", last_seq: 1, rows: 24, cols: 80 } : null;
  });
});
afterEach(() => {
  act(() => dismissShellWarning("disk"));
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

/** Lets what the stage started, such as a terminal's timed focus, run its course. */
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 600))));

interface Drawn {
  /** Whether an overlay is open over the window. */
  overlay?: boolean;
  terminals?: TerminalInfo[];
  stage?: Partial<StageProps>;
  /** The open stage tabs, which are named for their ids. */
  tools?: string[];
  front?: string | null;
}

/** Draws the stage on `PROJECT`, and beside it a button of the companion's, as Quay's window has them. */
async function mountStage({ terminals = TERMINALS, stage = {}, tools = ["Swarm", "Factory"], front = null, overlay = false }: Drawn = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  let app!: { open: (id: string) => void; close: (id: string) => void; vanish: (id: string) => void; show: (id: string | null) => void; project: (path: string) => void };
  const Harness = () => {
    const [openIds, setOpenIds] = useState(tools);
    const [frontId, setFrontId] = useState(front);
    const [activeProject, setActiveProject] = useState(PROJECT);
    // A surface's tab shows with its terminal's project only, and a tool's with every one.
    const shownIds = openIds.filter((id) => id !== "Surface" || activeProject === PROJECT);
    const close = (id: string) => {
      setOpenIds((ids) => ids.filter((open) => open !== id));
      setFrontId((now) => (now === id ? null : now));
    };
    app = {
      open: (id) => {
        setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
        setFrontId(id);
      },
      close,
      // As a dismissed surface's tab does, whose id is in front until it is found to have gone.
      vanish: (id) => setOpenIds((ids) => ids.filter((open) => open !== id)),
      show: setFrontId,
      project: setActiveProject,
    };
    return createElement(
      "div",
      null,
      createElement(Stage, {
        terminals,
        activeProject,
        activeTerminalId: terminals[0]?.id ?? null,
        primaryTerminalId: terminals[0]?.id ?? null,
        secondaryTerminalId: terminals[1]?.id ?? null,
        gridTerminalIds: [terminals[0]?.id ?? null, terminals[1]?.id ?? null, null, null],
        layout: "single",
        focusedPane: "primary",
        splitRatio: 50,
        zoomedFromLayout: null,
        onSelectTerminal: () => setFrontId(null),
        onSelectPane: () => {},
        onSwitchPaneTerminal: () => {},
        onSetLayout: () => {},
        onSetSplitRatio: () => {},
        onToggleZoom: () => {},
        onUnsplit: () => {},
        onSplitHorizontal: () => {},
        onSplitVertical: () => {},
        onSplitGrid: () => {},
        onNewTerminal: () => {},
        tools: shownIds.map((id) => ({
          id,
          label: id,
          icon: null,
          content: createElement("button", { type: "button", onClick: () => close(id) }, `Cancel ${id}`),
        })),
        frontToolId: frontId,
        onSelectTool: setFrontId,
        onCloseTool: close,
        ...stage,
      }),
      createElement("button", { type: "button" }, "Companion"),
      overlay && createElement(EmptyOverlay),
      // What is drawn over a tab's panel rather than in it, as the Praxis Builder is.
      createElement("div", { hidden: frontId !== "Builder" }, createElement("input", { "aria-label": "Node id" })),
    );
  };
  await act(async () => root.render(createElement(Harness)));
  await settle();
  return {
    container,
    open: (id: string) => act(async () => app.open(id)),
    close: (id: string) => act(async () => app.close(id)),
    vanish: (id: string) => act(async () => app.vanish(id)),
    show: (id: string | null) => act(async () => app.show(id)),
    project: (path: string) => act(async () => app.project(path)),
  };
}

const nameOf = (element: Element | null): string => {
  if (element === null || element === document.body) return "nothing";
  if (element.matches(".xterm-helper-textarea")) return `terminal ${element.closest("[data-pie-terminal]")?.getAttribute("data-pie-terminal")}`;
  return element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent?.trim() ?? "";
};
/** What has the focus, by name. */
const focused = () => nameOf(document.activeElement);

const isDrawn = (element: HTMLElement): boolean => {
  for (let at: HTMLElement | null = element; at; at = at.parentElement) if (at.style.display === "none" || at.hidden) return false;
  return true;
};
/** The names of what Tab stops at, in the page's order. */
const tabStops = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]")]
    .filter((element) => element.tabIndex >= 0 && isDrawn(element) && element.closest("[inert]") === null)
    .map(nameOf);

/** An open overlay with nothing in it that takes the focus. */
const EmptyOverlay = () => {
  useOverlay({ isOpen: true, onClose: () => {} });
  return null;
};

/** The button named `name`. */
function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => nameOf(b) === name);
  assert.ok(found !== undefined, `no button named ${name}`);
  return found;
}
/** Takes the focus to the button named `name` and presses it, as the keyboard does. */
async function press(container: HTMLElement, name: string): Promise<void> {
  await act(async () => {
    button(container, name).focus();
    button(container, name).click();
  });
}

test("with a stage tab in front, Tab reaches the tab bar, the warnings and the tool, and no terminal or divider beneath", async () => {
  const { container, show } = await mountStage({ stage: { layout: "split-horizontal" } });
  act(() => showShellWarning({ id: "disk", message: "The disk is almost full." }));
  const beneath = ["Pane planner", "terminal a", "Pane coder", "terminal b", "Resize split panes"];
  const before = tabStops(container);
  assert.deepEqual(beneath.filter((name) => before.includes(name)), beneath, "with the terminals in front each can be reached");

  await show("Swarm");
  assert.deepEqual(tabStops(container), [
    ...["planner", "coder", "Swarm", "Close Swarm", "Factory", "Close Factory", "New terminal", "Split horizontal", "Zoom pane"],
    ...["Dismiss warning", "Cancel Swarm", "Companion"],
  ]);

  await show(null);
  assert.deepEqual(tabStops(container), before, "and again once the terminals are back in front");
});

test("with a stage tab in front of a grid, Tab reaches none of its empty slots", async () => {
  const { container, show } = await mountStage({ stage: { layout: "grid" } });
  assert.equal(tabStops(container).filter((name) => name.startsWith("Add Terminal to Slot")).length, 2);
  await show("Swarm");
  assert.deepEqual(tabStops(container).slice(-2), ["Cancel Swarm", "Companion"]);
  assert.equal(tabStops(container).some((name) => name.startsWith("Add Terminal to Slot")), false);
});

test("with a stage tab in front of a project with no terminals, Tab does not reach Launch Terminal", async () => {
  const { container, show } = await mountStage({ terminals: [] });
  assert.equal(tabStops(container).includes("Launch Terminal"), true);
  await show("Swarm");
  assert.equal(tabStops(container).includes("Launch Terminal"), false);
  assert.equal(tabStops(container).includes("Cancel Swarm"), true);
});

test("an open tab's id that is no tool's covers nothing", async () => {
  const { container } = await mountStage({ front: "gone" });
  assert.equal(tabStops(container).includes("terminal a"), true);
});

test("a covered terminal is the one that was there, at its size, and still takes its output", async () => {
  const { container, show } = await mountStage();
  const screenOf = (id: string) => container.querySelector(`[data-pie-terminal="${id}"] .xterm`);
  const [planner, coder] = [screenOf("a"), screenOf("b")];
  const style = container.querySelector<HTMLElement>('[data-pie-terminal="a"]')!.style.cssText;
  sent = [];

  await show("Swarm");
  emitEvent("pty-output", { terminal_id: "a", seq: 2, data: " and building" });
  await settle();

  assert.deepEqual([screenOf("a") === planner, screenOf("b") === coder], [true, true], "neither was drawn again");
  assert.equal(container.querySelector<HTMLElement>('[data-pie-terminal="a"]')!.style.cssText, style);
  assert.equal(container.querySelector('[data-pie-terminal="a"] .xterm-rows')?.textContent?.includes("ready and building"), true);
  assert.deepEqual(sent, [], "and no program was told of a new size");
});

test("terminals outlive a project with none in front of them", async () => {
  const { container, project } = await mountStage();
  const planner = container.querySelector('[data-pie-terminal="a"] .xterm');
  await project("C:/work/empty");
  assert.equal(tabStops(container).includes("Launch Terminal"), true);
  assert.equal(container.querySelector('[data-pie-terminal="a"] .xterm') === planner, true);
  await project(PROJECT);
  assert.equal(container.querySelector('[data-pie-terminal="a"] .xterm') === planner, true);
});

test("a covered terminal takes no focus from the tool in front, whatever asks it to", async () => {
  const { container, open } = await mountStage({ tools: [] });
  await open("Swarm");
  act(() => button(container, "Cancel Swarm").focus());
  focusTerminal("a");
  emitEvent("pty-output", { terminal_id: "a", seq: 2, data: "more" });
  await settle();
  assert.equal(focused(), "Cancel Swarm");
});

test("closing the stage tab in front takes the focus to the focused terminal", async () => {
  const { container } = await mountStage({ front: "Swarm" });
  await press(container, "Close Swarm");
  assert.equal(focused(), "terminal a");
});

test("closing the stage tab in front from inside it takes the focus to the focused pane's terminal", async () => {
  const { container } = await mountStage({ front: "Swarm", stage: { layout: "split-vertical", focusedPane: "secondary" } });
  await press(container, "Cancel Swarm");
  assert.equal(focused(), "terminal b");
});

test("closing the stage tab in front takes the focus to a pane that shows a terminal when the focused one shows none", async () => {
  const { container } = await mountStage({ front: "Swarm", stage: { layout: "grid", focusedPane: "grid-3" } });
  await press(container, "Close Swarm");
  assert.equal(focused(), "terminal a");
});

test("in a project with no terminals, closing the stage tab in front takes the focus to Launch Terminal", async () => {
  const { container } = await mountStage({ terminals: [], front: "Swarm" });
  await press(container, "Close Swarm");
  assert.equal(focused(), "Launch Terminal");
});

test("closing the last stage tab of a project with no terminals takes the focus to Launch Terminal", async () => {
  const { container } = await mountStage({ terminals: [], tools: ["Swarm"], front: "Swarm" });
  await press(container, "Cancel Swarm");
  assert.equal(focused(), "Launch Terminal");
});

test("closing a background stage tab takes the focus to the front tab's button, a tool's or a terminal's", async () => {
  const { container } = await mountStage({ tools: ["Swarm", "Factory", "Order"], front: "Factory" });
  await press(container, "Close Swarm");
  assert.equal(focused(), "Factory");
  await press(container, "Close Factory");
  assert.equal(focused(), "terminal a");
  await press(container, "Close Order");
  assert.equal(focused(), "planner");
});

test("closing a background stage tab over a project with no terminals takes the focus to Launch Terminal", async () => {
  const { container } = await mountStage({ terminals: [] });
  await press(container, "Close Swarm");
  assert.equal(focused(), "Launch Terminal");
  await press(container, "Close Factory");
  assert.equal(focused(), "Launch Terminal");
});

test("a stage tab that comes to the front takes the focus from what it covers to its own tab", async () => {
  const { container, open } = await mountStage({ tools: [] });
  assert.equal(focused(), "terminal a");
  await open("Swarm");
  assert.equal(focused(), "Swarm");
  act(() => button(container, "Cancel Swarm").focus());
  await open("Factory");
  assert.equal(focused(), "Factory", "and from the tab that was in front");
});

test("a stage tab that closes by itself leaves the focus where the operator is", async () => {
  const { container, close } = await mountStage({ tools: ["Swarm", "Factory", "Order"], front: "Factory" });
  act(() => button(container, "Companion").focus());
  await close("Factory");
  await settle();
  assert.equal(focused(), "Companion", "the one in front");
  await close("Swarm");
  assert.equal(focused(), "Companion", "one behind");
  act(() => button(container, "Zoom pane").focus());
  await close("Order");
  assert.equal(focused(), "Zoom pane", "on the stage itself");
});

test("a surface's stage tab that leaves with its project is not closed, and moves no focus", async () => {
  const { container, project } = await mountStage({ tools: ["Surface"] });
  act(() => (document.activeElement as HTMLElement).blur());
  await project("C:/work/empty");
  assert.equal(tabStops(container).includes("Surface"), false);
  assert.equal(focused(), "nothing");
});

test("a stage tab that is in front as it vanishes takes the focus to the focused terminal", async () => {
  const { container, vanish, show } = await mountStage({ front: "Swarm" });
  act(() => button(container, "Close Swarm").focus());
  await vanish("Swarm");
  assert.equal(focused(), "terminal a");
  await show(null);
  assert.equal(focused(), "terminal a");
});

test("closing a stage tab from what is drawn over its panel takes the focus to the focused terminal", async () => {
  const { container, close } = await mountStage({ tools: ["Builder"], front: "Builder" });
  act(() => container.querySelector("input")!.focus());
  assert.equal(focused(), "Node id");
  await close("Builder");
  assert.equal(focused(), "terminal a");
});

test("Ctrl+F opens the search of a terminal in front, and of none that a stage tab covers", async () => {
  const { container, show } = await mountStage();
  const searches = () => container.querySelectorAll('[data-pie-terminal="a"] input').length;
  const ctrlF = () => act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })));
  await show("Swarm");
  await ctrlF();
  assert.equal(searches(), 0);
  await show(null);
  await ctrlF();
  assert.equal(searches(), 1);
});

test("a stage tab that closes beneath an open overlay leaves the focus to the overlay", async () => {
  const { close } = await mountStage({ front: "Swarm", overlay: true });
  assert.equal(focused(), "nothing");
  await close("Swarm");
  assert.equal(focused(), "nothing");
});

test("closing the stage tab in front of empty panes takes the focus to the current terminal's tab", async () => {
  const { container } = await mountStage({ front: "Swarm", stage: { layout: "grid", gridTerminalIds: [null, null, null, null] } });
  await press(container, "Close Swarm");
  assert.equal(focused(), "planner");
});
