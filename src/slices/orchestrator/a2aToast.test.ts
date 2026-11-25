/// <reference types="node" />
// Component tests for the A2A toast: which dispatched messages raise it. Tauri's events, the
// out-of-process boundary, are faked.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { A2ADispatchPayload } from "./A2AToast.tsx";

const { A2AToast } = await import("./A2AToast.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

async function toastFor(payload: Partial<A2ADispatchPayload>): Promise<string> {
  fakeInvoke(async (command) => {
    throw new Error(`no fake for ${command}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(A2AToast, { terminals: [] })));
  await act(async () =>
    emitEvent("a2a-message-dispatched", {
      id: "a2a-1",
      from_terminal: "user",
      to_terminal: "term-a",
      from_name: "You",
      to_name: "fix-75",
      content: "Run the suite again",
      as_user: true,
      timestamp: 1,
      status: "dispatched",
      ...payload,
    }),
  );
  return document.body.textContent ?? "";
}

test("a message the operator sent raises a toast", async () => {
  assert.equal((await toastFor({})).includes("Run the suite again"), true);
});

test("an answer to a surface raises none", async () => {
  const content = '[Quay surface "Which base?" (ask_1)]: {"dismissed":true}';
  assert.equal((await toastFor({ content, surface_answer: true })).includes("Quay surface"), false);
});

test("a message that only looks like an answer raises one", async () => {
  const content = '[Quay surface "Which base?" (ask_1)]: {"dismissed":true}';
  assert.equal((await toastFor({ content })).includes("Quay surface"), true);
});
