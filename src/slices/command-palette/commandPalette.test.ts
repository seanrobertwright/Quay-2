/// <reference types="node" />
// The palette reports each command it runs, so the pie's Palette slices can copy the most recent
// ones, and runs a command by id for a slice, open or closed.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { CommandPalette } = await import("./CommandPalette.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

async function mount(isOpen: boolean) {
  const calls: string[] = [];
  const ran: { id: string; title: string }[] = [];
  const runner: { current: ((id: string) => boolean) | null } = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const noop = () => {};
  await act(async () =>
    root.render(
      createElement(CommandPalette, {
        isOpen,
        onClose: () => calls.push("close"),
        projects: [],
        activeProject: "",
        terminals: [],
        activeTerminalId: null,
        onSelectProject: noop,
        onSelectTerminal: noop,
        onSetLayout: (layout: string) => calls.push(`layout:${layout}`),
        onToggleZoom: noop,
        onFocusNextPane: noop,
        onNewTerminal: noop,
        onOpenWorkspaceSettings: noop,
        onOpenSwarmBuilder: noop,
        onLaunchSwarmPreset: noop,
        savedSwarms: [],
        onOpenActionLog: noop,
        onBroadcast: noop,
        onOpenDiffInspector: noop,
        onAddProject: noop,
        onRanCommand: (command: { id: string; title: string }) => ran.push(command),
        runnerRef: runner,
      })
    )
  );
  return { calls, ran, runner };
}

const button = (title: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(title))!;

test("a command run from the palette, by click or Enter, is reported with its id and title", async () => {
  const { calls, ran } = await mount(true);
  await act(async () => button("2x2 Quad Grid Layout").click());
  assert.deepEqual(calls, ["layout:grid", "close"]);
  assert.deepEqual(ran, [{ id: "layout-grid", title: "2x2 Quad Grid Layout" }]);

  const input = document.querySelector("input")!;
  await act(async () => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.equal(ran.length, 2);
  assert.equal(ran[1].id, "layout-single", "the first command, selected when the palette opens");
});

test("the runner runs a command by id with the palette closed, and says when no command has that id", async () => {
  const { calls, ran, runner } = await mount(false);
  let found = false;
  await act(async () => void (found = runner.current?.("layout-split-v") ?? false));
  assert.equal(found, true);
  assert.deepEqual(calls, ["layout:split-vertical"]);
  assert.equal(runner.current?.("gone"), false);
  assert.deepEqual(ran, [], "a run from the pie is not a run from the palette");
});
