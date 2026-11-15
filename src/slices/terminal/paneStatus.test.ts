/// <reference types="node" />
// Component tests for the status in a terminal pane header (#635): agent state, current tool and
// the Skip/Ask toggle the status strip used to show.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "./types.ts";

const { PaneStatus } = await import("./PaneStatus.tsx");

const agent = (over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id: "a",
  name: "coder",
  project_path: "C:/work/repo",
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
  ...over,
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

function render(terminal: TerminalInfo, { activeTool = null as string | null, toggle = true } = {}) {
  const calls: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(PaneStatus, {
        terminal,
        activeTool,
        onToggleAsk: toggle ? () => void calls.push("toggle") : undefined,
      }),
    ),
  );
  mounted = { root, container };
  const pill = () => container.querySelector("button") as HTMLButtonElement | null;
  return { container, calls, pill };
}

test("a working agent shows its current tool and the tool's detail", () => {
  const { container } = render(agent({ claude_status: "working", current_tool: "Bash", tool_detail: "pnpm test" }));
  assert.ok(container.textContent?.includes("Working: Bash (pnpm test)"), container.textContent ?? "");
});

test("a working agent with no reported tool falls back to the bridge's active tool", () => {
  const { container } = render(agent({ claude_status: "working" }), { activeTool: "Edit" });
  assert.ok(container.textContent?.includes("Working: Edit"), container.textContent ?? "");
});

test("a waiting agent names the tool it waits on", () => {
  const { container } = render(agent({ claude_status: "waiting", current_tool: "Write" }));
  assert.ok(container.textContent?.includes("Waiting for decision (Write)"), container.textContent ?? "");
});

test("an idle agent shows Ready", () => {
  const { container } = render(agent({ claude_status: "idle" }));
  assert.equal(container.textContent?.startsWith("Ready"), true, container.textContent ?? "");
});

test("an exited agent shows its exit code", () => {
  const { container } = render(agent({ claude_status: "exited", exit_code: 2 }));
  assert.ok(container.textContent?.includes("Exited with code 2"), container.textContent ?? "");
});

test("the Skip/Ask pill names Skip and toggles the mode on click", () => {
  const skip = render(agent({ live_mode: "skip" }));
  assert.equal(skip.pill()?.getAttribute("aria-label"), "Mode: Skip");
  act(() => skip.pill()!.click());
  assert.deepEqual(skip.calls, ["toggle"]);
});

test("the Skip/Ask pill names Ask while the agent asks before tool calls", () => {
  const ask = render(agent({ live_mode: "normal" }));
  assert.equal(ask.pill()?.getAttribute("aria-label"), "Mode: Ask");
});

test("an agent that never asks before tools gets no pill, only a Skip badge", () => {
  const { pill, container } = render(agent({ run_kind: "pi", permission_mode: "skip", live_mode: "skip" }));
  assert.equal(pill(), null);
  assert.ok(container.textContent?.includes("SKIP"));
});

test("a shell terminal shows no agent state and no pill", () => {
  const { container, pill } = render(agent({ run_kind: "powershell", claude_status: "unknown" }));
  assert.equal(pill(), null);
  assert.equal(container.textContent, "");
});
