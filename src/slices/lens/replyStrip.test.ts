/// <reference types="node" />
// Component tests for the reply strip at a lens's foot (#640): it shows the terminal's last
// question and answers it through the attention queue's `answerPermission`.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PermissionItem } from "../attention/attentionQueue.ts";

const { ReplyStrip } = await import("./ReplyStrip.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  act(() => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

const question: PermissionItem = {
  kind: "permission",
  requestId: "req-1",
  terminalId: "a",
  project: "E:/alpha",
  tool: "Bash",
  input: { command: "git push origin ticket-5" },
  reason: "Push the fix",
  waitingSince: 100,
  deferred: false,
};

function render(props: { question: PermissionItem | null }) {
  const answers: unknown[][] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(ReplyStrip, {
        terminalName: "implement 5",
        ...props,
        onAnswer: async (...args: unknown[]) => void answers.push(args),
      }),
    ),
  );
  mounted = { root, container };
  return { container, answers };
}

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

test("the reply strip shows the terminal's last question and its reply buttons", () => {
  const { container } = render({ question });
  const text = container.textContent ?? "";
  assert.match(text, /implement 5/);
  assert.match(text, /Bash/);
  assert.match(text, /git push origin ticket-5/);
  assert.match(text, /Push the fix/);
  for (const reply of ["Allow once", "Allow for session", "Deny"]) assert.ok(button(container, reply), reply);
});

test("each reply button answers the question", () => {
  const { container, answers } = render({ question });
  act(() => button(container, "Allow once")?.click());
  act(() => button(container, "Allow for session")?.click());
  act(() => button(container, "Deny")?.click());
  assert.deepEqual(answers, [
    ["req-1", "allow", undefined, false],
    ["req-1", "allow", undefined, true],
    ["req-1", "deny"],
  ]);
});

test("with no question waiting, the strip says so and offers no replies", () => {
  const { container } = render({ question: null });
  assert.match(container.textContent ?? "", /implement 5 is not asking anything/);
  assert.equal(container.querySelectorAll("button").length, 0);
});
