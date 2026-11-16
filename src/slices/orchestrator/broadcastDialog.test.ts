/// <reference types="node" />
// Component tests for Broadcast to all agents (#644), the palette command that took over Mission
// Control's Broadcast box: one line typed into every running agent of the active project. Tauri's
// `invoke`, the out-of-process boundary, is faked: `a2a_broadcast_toast` sends the line.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { BroadcastDialog } = await import("./BroadcastDialog.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

test("Broadcast sends the line to the active project's agents and closes", async () => {
  const sent: Record<string, unknown>[] = [];
  fakeInvoke(async (command, args) => {
    if (command !== "a2a_broadcast_toast") throw new Error(`no fake for ${command}`);
    sent.push(args);
    return [{}, {}];
  });
  let closed = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(BroadcastDialog, { isOpen: true, project: "C:/repo", onClose: () => closed++ })));

  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  assert.equal(dialog.getAttribute("aria-label"), "Broadcast to all agents");
  const field = dialog.querySelector("input") as HTMLInputElement;
  assert.equal(field.getAttribute("aria-label"), "Broadcast message");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    setValue.call(field, "FREEZE: release in progress");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Broadcast") as HTMLButtonElement;
  await act(async () => send.click());
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  assert.deepEqual(sent, [{ text: "FREEZE: release in progress", project: "C:/repo" }]);
  assert.equal(closed, 1);
});
