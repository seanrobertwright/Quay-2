/// <reference types="node" />
// Component tests for the panel beside the module bar (#632): it shows the open module's content,
// folds away, and keeps every module's content mounted so a panel's own state survives a switch.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ModuleId } from "./modules.ts";

const { ModulePanel, LauncherList } = await import("./ModulePanel.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

function mount(node: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted = { root, container };
  return container;
}

/** A counter that holds its own state, standing in for a panel with state of its own. */
const Counter = () => {
  const [count, setCount] = useState(0);
  return createElement("button", { type: "button", onClick: () => setCount((c) => c + 1) }, `Clicked ${count}`);
};

const panels = (counter: ReturnType<typeof createElement>) => ({
  projects: counter,
  "source-control": "Source control content",
  agents: "Agents content",
  workflows: "Workflows content",
  project: "Project content",
});

function renderPanel(initial: ModuleId | null) {
  let setOpen: (m: ModuleId | null) => void = () => {};
  const Harness = () => {
    const [open, set] = useState<ModuleId | null>(initial);
    setOpen = set;
    return createElement(ModulePanel, { id: "panel", openModule: open, panels: panels(createElement(Counter)) });
  };
  const container = mount(createElement(Harness));
  const aside = container.querySelector("aside") as HTMLElement;
  const shown = () => [...aside.children].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent);
  return { aside, shown, open: (m: ModuleId | null) => act(() => setOpen(m)) };
}

test("the panel is a 280 px landmark named for the open module, showing only that module", () => {
  const { aside, shown } = renderPanel("agents");
  assert.equal(aside.getAttribute("aria-label"), "Agents panel");
  assert.equal(aside.id, "panel");
  assert.equal(getComputedStyle(aside).width, "280px");
  assert.deepEqual(shown(), ["Agents content"]);
});

test("a folded panel is hidden", () => {
  const { aside } = renderPanel(null);
  assert.equal(aside.hidden, true);
});

test("a module's panel keeps its state while another module shows or the panel folds", () => {
  const { aside, open, shown } = renderPanel("projects");
  act(() => (aside.querySelector("button") as HTMLButtonElement).click());
  open("workflows");
  open(null);
  open("projects");
  assert.deepEqual(shown(), ["Clicked 1"]);
});

test("a launcher list names its tools, each opening its tool", () => {
  const opened: string[] = [];
  const container = mount(
    createElement(LauncherList, {
      label: "Workflows",
      className: "",
      launchers: [
        { id: "archon", label: "Archon & SDD Graph", shortcut: "Ctrl+Shift+B r", icon: null, onClick: () => opened.push("archon") },
        { id: "machina", label: "Machina", icon: null, onClick: () => opened.push("machina") },
        { id: "vscode", label: "Open in VS Code", icon: null, disabled: true, onClick: () => opened.push("vscode") },
      ],
    }),
  );
  assert.equal(container.querySelector("ul")?.getAttribute("aria-label"), "Workflows");
  const buttons = [...container.querySelectorAll("button")] as HTMLButtonElement[];
  assert.deepEqual(buttons.map((b) => b.getAttribute("aria-label")), ["Archon & SDD Graph", "Machina", "Open in VS Code"]);
  // The shortcut describes the button rather than running into its name.
  const described = buttons[0].getAttribute("aria-describedby");
  assert.ok(described);
  assert.equal(container.querySelector(`[id="${described}"]`)?.textContent, "Ctrl+Shift+B r");
  assert.equal(buttons[1].getAttribute("aria-describedby"), null);
  act(() => buttons[1].click());
  act(() => buttons[2].click());
  assert.deepEqual(opened, ["machina"]);
  assert.equal(buttons[2].disabled, true);
});
