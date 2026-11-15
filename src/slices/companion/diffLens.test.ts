/// <reference types="node" />
// Component tests for the diff lens (#640): its file filter, file tree, stacked diffs, the reply
// strip at its foot, and how it closes. GitHub is reached through Tauri's `invoke`, the
// out-of-process boundary these tests fake.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PullRequestFile, PullRequestTimeline } from "../github/types.ts";

const { DiffLens } = await import("./DiffLens.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  fakeInvoke((cmd) => Promise.reject(new Error(`no fake for ${cmd}`)));
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

const files: PullRequestFile[] = [
  { path: "src/a.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old a\n+new a" },
  { path: "src/lib/b.ts", previousPath: null, status: "added", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+b one\n+b two" },
  { path: "README.md", previousPath: null, status: "modified", additions: 0, deletions: 1, patch: "@@ -1 +0,0 @@\n-gone" },
];
const timeline: PullRequestTimeline = {
  viewer: "me",
  truncated: false,
  items: [
    {
      kind: "thread",
      id: "t1",
      author: "rev",
      body: "Why?",
      createdAt: "2026-11-01T00:00:00Z",
      url: null,
      reviewState: null,
      path: "src/lib/b.ts",
      resolved: false,
      replies: [],
    },
  ],
};

async function render(props: Partial<Parameters<typeof DiffLens>[0]> = {}) {
  const calls: string[] = [];
  fakeInvoke(async (cmd) => {
    calls.push(cmd);
    if (cmd === "get_github_pr_files") return files;
    if (cmd === "get_github_pr_timeline") return timeline;
    throw new Error(`no fake for ${cmd}`);
  });
  const closes: number[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(DiffLens, {
        target: { terminalId: "a", repoPath: "E:/alpha", repo: "o/r", number: 12, file: null },
        onClose: () => closes.push(1),
        ...props,
      }),
    ),
  );
  mounted = { root, container };
  await settle();
  return { container, calls, closes };
}

const treeButtons = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Changed files"] button')];
const stackedDiffs = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("article[data-file]")].map((a) => a.dataset.file);

test("the diff lens shows a file tree and every diff stacked, and marks commented files", async () => {
  const { container } = await render();
  assert.deepEqual(stackedDiffs(container), ["src/a.ts", "src/lib/b.ts", "README.md"]);
  const tree = treeButtons(container).map((b) => b.textContent?.replace(/\s+/g, " ").trim());
  assert.equal(tree.length, 3);
  assert.match(tree[1] ?? "", /b\.ts.*1 comment/);
  assert.doesNotMatch(tree[0] ?? "", /comment/);
});

test("the file filter narrows the tree and the stacked diffs", async () => {
  const { container } = await render();
  const filter = container.querySelector<HTMLInputElement>('input[aria-label="Filter changed files"]');
  assert.ok(filter);
  const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(filter), "value")?.set;
  act(() => {
    setValue?.call(filter, "LIB");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.deepEqual(stackedDiffs(container), ["src/lib/b.ts"]);
  assert.equal(treeButtons(container).length, 1);
});

test("marking a diff viewed marks its file in the tree and counts it", async () => {
  const { container } = await render();
  const count = () => container.querySelector("[data-viewed-count]")?.textContent;
  assert.equal(count(), "0 of 3 viewed");
  const box = container.querySelector<HTMLInputElement>('article[data-file="README.md"] input[type="checkbox"]');
  assert.ok(box);
  act(() => box.click());
  assert.equal(count(), "1 of 3 viewed");
  assert.match(treeButtons(container)[2]?.textContent ?? "", /viewed/);
  assert.doesNotMatch(treeButtons(container)[0]?.textContent ?? "", /viewed/);
});

test("the lens opens on the file it was given", async () => {
  const { container } = await render({
    target: { terminalId: "a", repoPath: "E:/alpha", repo: "o/r", number: 12, file: "src/lib/b.ts" },
  });
  const current = treeButtons(container).filter((b) => b.getAttribute("aria-current") === "true");
  assert.deepEqual(current.map((b) => b.title), ["src/lib/b.ts"]);
});

/** A stand-in for terminal `id`'s pane: a textarea that takes focus when the pane is asked to. */
function terminalPane(id: string) {
  const textarea = document.createElement("textarea");
  document.body.append(textarea);
  const listener = (e: Event) => {
    if ((e as CustomEvent<{ terminalId?: string }>).detail?.terminalId === id) textarea.focus();
  };
  window.addEventListener("quay:focus-terminal", listener);
  return {
    textarea,
    remove: () => {
      window.removeEventListener("quay:focus-terminal", listener);
      textarea.remove();
    },
  };
}

for (const [how, close] of [
  ["its close button", (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => b.textContent === "Close lens")?.click()],
  [
    "Escape",
    () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  ],
] as const) {
  test(`closing the lens with ${how} returns keyboard focus to the selected terminal`, async () => {
    const pane = terminalPane("a");
    try {
      const { container, closes } = await render();
      assert.ok(document.activeElement !== pane.textarea, "the lens takes focus when it opens");
      act(() => void close(container));
      assert.equal(closes.length, 1);
      assert.ok(document.activeElement === pane.textarea, "focus is back on the terminal");
    } finally {
      pane.remove();
    }
  });
}
