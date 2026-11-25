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
  terminals?: TerminalInfo[];
  stage?: Partial<StageProps>;
  /** The open stage tabs, which are named for their ids. */
  tools?: string[];
  front?: string | null;
}

/** Draws the stage on `PROJECT`, and beside it a button of the companion's, as Quay's window has them. */
async function mountStage({ terminals = TERMINALS, stage = {}, tools = ["Swarm", "Factory"], front = null }: Drawn = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  let app!: { open: (id: string) => void; close: (id: string) => void; show: (id: string | null) => void; project: (path: string) => void };
  const Harness = () => {
    const [openIds, setOpenIds] = useState(tools);
    const [frontId, setFrontId] = useState(front);
    const [activeProject, setActiveProject] = useState(PROJECT);
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
        tools: openIds.map((id) => ({
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
    );
  };
  await act(async () => root.render(createElement(Harness)));
  await settle();
  return {
    container,
    open: (id: string) => act(async () => app.open(id)),
    close: (id: string) => act(async () => app.close(id)),
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

/** The button named `name`. */
function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => nameOf(b) === name);
  assert.ok(found !== undefined, `no button named ${name}`);
  return found;
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
