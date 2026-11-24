/// <reference types="node" />
// Component tests for the reply strip at a lens's foot (#640): it shows the terminal's newest
// waiting permission request and answers it through the attention queue's `answerPermission`, and
// offers the way to the rest of the request's input where its one line leaves some out (#704).
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

const permission: PermissionItem = {
  kind: "permission",
  requestId: "req-1",
  terminalId: "a",
  project: "E:/alpha",
  tool: "Bash",
  input: { command: "git push origin ticket-5" },
  reason: "Push the fix",
  waitingSince: 100,
};

function render(props: { permission: PermissionItem | null }) {
  const answers: unknown[][] = [];
  const shown: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(ReplyStrip, {
        terminalName: "implement 5",
        ...props,
        onAnswer: async (...args: unknown[]) => void answers.push(args),
        onShowActivity: () => void shown.push("activity"),
      }),
    ),
  );
  mounted = { root, container };
  return { container, answers, shown };
}

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

test("the reply strip shows the terminal's newest permission request and its reply buttons", () => {
  const { container } = render({ permission });
  const text = container.textContent ?? "";
  assert.match(text, /implement 5/);
  assert.match(text, /Bash/);
  assert.match(text, /git push origin ticket-5/);
  assert.match(text, /Push the fix/);
  for (const reply of ["Allow once", "Allow for session", "Deny"]) assert.ok(button(container, reply), reply);
});

test("each reply button answers the permission request", () => {
  const { container, answers } = render({ permission });
  act(() => button(container, "Allow once")?.click());
  act(() => button(container, "Allow for session")?.click());
  act(() => button(container, "Deny")?.click());
  assert.deepEqual(answers, [
    ["req-1", "allow", undefined, false],
    ["req-1", "allow", undefined, true],
    ["req-1", "deny"],
  ]);
});

test("with no permission request waiting, the strip says so and offers no replies", () => {
  const { container } = render({ permission: null });
  assert.match(container.textContent ?? "", /implement 5 is not asking anything/);
  assert.equal(container.querySelectorAll("button").length, 0);
});

test("a request with more input than its summary offers Whole input, which shows the Activity view", () => {
  const { container, answers, shown } = render({
    permission: { ...permission, tool: "Write", input: { file_path: "src/a.ts", content: "one" } },
  });
  act(() => button(container, "Whole input")?.click());
  assert.deepEqual(shown, ["activity"]);
  assert.deepEqual(answers, [], "it answers nothing");
  for (const reply of ["Allow once", "Allow for session", "Deny"]) assert.ok(button(container, reply), reply);
});

test("a request whose summary shows all its input offers no Whole input", () => {
  const { container } = render({ permission });
  assert.ok(!button(container, "Whole input"));
});
