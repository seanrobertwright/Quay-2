/// <reference types="node" />
// The shell look on a Projects panel row (#652): the selected terminal's row glows in the pie
// palette's accent; any other row stays as it was.
import "../../test-support/dom.ts";
import { installShellLook } from "../../test-support/shellLook.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";

const { TerminalRow } = await import("./TerminalRow.tsx");

const TERMINAL: TerminalInfo = {
  id: "t1",
  name: "claude-1",
  project_path: "C:\\src\\repo",
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
};

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

function renderRow(isActive: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(createElement(TerminalRow, { index: 1, terminal: TERMINAL, isActive, onSelect: () => {}, onClose: () => {} })));
  return getComputedStyle(container.querySelector<HTMLElement>('[role="button"]')!);
}

test("the selected terminal's row has a glowing border in the accent", () => {
  installShellLook("acid");
  const row = renderRow(true);
  assert.equal(row.borderColor, "rgba(182, 255, 26, 0.55)", "the accent at 55%");
  assert.match(row.boxShadow, /#b6ff1a/);
});

test("a row that is not selected does not glow", () => {
  installShellLook("acid");
  assert.equal(renderRow(false).boxShadow, "");
});
