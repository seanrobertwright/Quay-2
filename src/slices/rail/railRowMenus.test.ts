/// <reference types="node" />
// The project and worktree row menus (#509): the real `Rail` rendered into happy-dom, with only
// Tauri's `invoke` (the opener plugin), the clipboard and the confirmation prompt faked. They
// check what a user observes: that a menu opens without changing the active project, where it
// opens, and what choosing an item does. An element is compared as a boolean, since a failed
// assertion on a happy-dom element spends its time printing the whole document.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { Rail } = await import("./Rail.tsx");
type Project = import("../workspace/types.ts").Project;
type GitWorktree = import("../git/types.ts").GitWorktree;

const ALPHA: Project = { path: "C:\\src\\alpha", name: "alpha", terminal_ids: [] };
const BETA: Project = { path: "C:\\src\\beta", name: "beta", terminal_ids: [] };
const BETA_WT: GitWorktree = {
  path: "C:\\src\\beta-wt",
  head: "0123456789abcdef",
  branch: "refs/heads/ticket-509",
  is_main: false,
  is_bare: false,
  is_locked: false,
};
const BETA_MAIN: GitWorktree = { ...BETA_WT, path: BETA.path, branch: "refs/heads/master", is_main: true };

let invoked: { cmd: string; args: Record<string, unknown> }[] = [];
let mounted: { root: Root; container: HTMLElement } | null = null;
/** What the Rail's handlers were asked to do, in order. */
let calls: string[] = [];

beforeEach(() => {
  invoked = [];
  calls = [];
  fakeInvoke(async (cmd, args) => {
    invoked.push({ cmd, args });
    return null;
  });
});
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

/** Renders the Rail with `alpha` active, and `beta` holding one worktree besides its main one. */
function renderRail() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args.map(String)].join(" "));
  act(() =>
    root.render(
      createElement(Rail, {
        projects: [ALPHA, BETA],
        activeProject: ALPHA.path,
        terminals: [],
        activeTerminalId: null,
        bridgePort: 0,
        projectWorktrees: { [BETA.path]: [BETA_MAIN, BETA_WT] },
        onSelectTerminal: log("selectTerminal"),
        onCloseTerminal: log("closeTerminal"),
        onNewTerminal: log("newTerminal"),
        onSelectProject: log("select"),
        onAddProject: log("addProject"),
        onRemoveProject: log("removeProject"),
        onOpenA2APanel: log("a2a"),
        onOpenSettings: (project: Project) => void calls.push(`settings ${project.path}`),
        onOpenSwarm: log("swarm"),
        onOpenTopos: log("topos"),
        onOpenGithubDrawer: log("github"),
        onOpenNewWorktree: log("newWorktree"),
        onRemoveWorktree: log("removeWorktree"),
      })
    )
  );
  return container;
}

/** The row for the project or worktree whose row shows `name`. */
function row(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find((el) =>
    [...el.querySelectorAll("span")].some((span) => span.textContent === name)
  );
  assert.ok(found, `no row ${name}`);
  return found;
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

function rightClick(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
  });
}

test("right-clicking a project row that is not active opens its menu, and leaves the active project alone", () => {
  renderRail();
  rightClick(row("beta"));
  assert.equal(menu()?.getAttribute("aria-label"), "Workspace beta");
  assert.deepEqual(calls, []);
});

/** Opens the menu on `el` and chooses the item named `name`. */
function choose(el: HTMLElement, name: string) {
  rightClick(el);
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((i) => i.textContent?.startsWith(name));
  assert.ok(item, `no item ${name}`);
  act(() => item.click());
}

test("Swarm preset…, Open Topos and GitHub issues & PRs on a project that is not active select it, then open the tool", () => {
  renderRail();
  for (const [name, tool] of [["Swarm preset…", "swarm"], ["Open Topos", "topos"], ["GitHub issues & PRs", "github"]]) {
    calls = [];
    choose(row("beta"), name);
    assert.deepEqual(calls, [`select ${BETA.path}`, tool], name);
    assert.equal(menu() === null, true, "choosing an item closes the menu");
  }
});

/** Shows `beta`'s worktrees, which start folded away, and returns the worktree's row. */
function worktreeRow(): HTMLElement {
  const expand = document.querySelector<HTMLElement>('button[title="Expand worktrees"]');
  assert.ok(expand, "no Expand worktrees button");
  act(() => expand.click());
  return row("ticket-509");
}

test("right-clicking a worktree row opens its menu named for its branch, and leaves the active project alone", () => {
  renderRail();
  rightClick(worktreeRow());
  assert.equal(menu()?.getAttribute("aria-label"), "Worktree ticket-509");
  assert.deepEqual(
    [...menu()!.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent),
    ["New terminal here", "Copy path", "Copy branch name", "Open folder in Explorer", "Remove worktree…"]
  );
  assert.deepEqual(calls, []);
});

function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

test("Shift+F10 or the Menu key on a focused project or worktree row opens its menu at the row's lower left corner", () => {
  renderRail();
  const rows: [HTMLElement, string, string][] = [
    [row("beta"), "Workspace beta", "New terminal"],
    [worktreeRow(), "Worktree ticket-509", "New terminal here"],
  ];
  for (const [el, label, first] of rows) {
    el.getBoundingClientRect = () => ({ left: 12, top: 30, right: 200, bottom: 64, width: 188, height: 34, x: 12, y: 30, toJSON: () => ({}) });
    for (const keys of [{ key: "F10", shiftKey: true }, { key: "ContextMenu" }]) {
      el.focus();
      press(keys.key, keys);
      assert.equal(menu()?.getAttribute("aria-label"), label, keys.key);
      assert.deepEqual([menu()?.style.left, menu()?.style.top], ["12px", "64px"], keys.key);
      assert.equal(document.activeElement?.textContent, first, "focus starts on the first item");
      press("Escape");
      assert.equal(menu() === null, true, "Escape closes the menu");
      assert.equal(document.activeElement === el, true, "focus goes back to the row");
    }
  }
  assert.deepEqual(calls, []);
});

test("the project menu's other items run what the row's own buttons run, without selecting the project first", () => {
  renderRail();
  choose(row("beta"), "New terminal");
  choose(row("beta"), "New worktree…");
  choose(row("beta"), "Workspace settings…");
  assert.deepEqual(calls, [`newTerminal ${BETA.path}`, `newWorktree ${BETA.path}`, `settings ${BETA.path}`]);
});

test("the worktree menu's New terminal here starts a terminal in the worktree, as its + button does", () => {
  renderRail();
  choose(worktreeRow(), "New terminal here");
  assert.deepEqual(calls, [`newTerminal ${BETA_WT.path}`]);
});

test("Collapse folds the project away, and the menu then offers Expand", () => {
  renderRail();
  assert.ok(document.querySelector('button[title="Expand worktrees"]'), "beta starts expanded");
  choose(row("beta"), "Collapse");
  assert.equal(document.querySelector('button[title="Expand worktrees"]') === null, true, "beta's contents are folded away");
  assert.ok(document.querySelector('button[title="Expand project"]'), "its row offers Expand");
  choose(row("beta"), "Expand");
  assert.ok(document.querySelector('button[title="Expand worktrees"]'), "beta is expanded again");
});

/** Fakes the clipboard; what is written to it lands in the returned list. */
function fakeClipboard(): string[] {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void written.push(text) }, configurable: true });
  return written;
}

test("Copy path and Copy branch name write the row's folder and branch to the clipboard", async () => {
  const written = fakeClipboard();
  renderRail();
  choose(row("beta"), "Copy path");
  choose(worktreeRow(), "Copy path");
  choose(row("ticket-509"), "Copy branch name");
  await act(async () => {});
  assert.deepEqual(written, [BETA.path, BETA_WT.path, "ticket-509"]);
});

test("Open folder in Explorer opens the row's folder through the opener plugin", async () => {
  renderRail();
  choose(row("beta"), "Open folder in Explorer");
  choose(worktreeRow(), "Open folder in Explorer");
  await act(async () => {});
  assert.deepEqual(
    invoked.filter((c) => c.cmd.startsWith("plugin:opener")),
    [
      { cmd: "plugin:opener|reveal_item_in_dir", args: { paths: [BETA.path] } },
      { cmd: "plugin:opener|reveal_item_in_dir", args: { paths: [BETA_WT.path] } },
    ]
  );
});

/** Answers the confirmation prompt with `answer`; the questions asked land in the returned list. */
function fakeConfirm(answer: boolean): string[] {
  const asked: string[] = [];
  (window as unknown as { confirm: (message: string) => boolean }).confirm = (message) => {
    asked.push(message);
    return answer;
  };
  return asked;
}

/** Presses the row's trash button, titled `title`. */
function trash(title: string) {
  const button = document.querySelector<HTMLElement>(`button[title="${title}"]`);
  assert.ok(button, `no button ${title}`);
  act(() => button.click());
}

test("Remove workspace… asks what the trash button asks, and removes nothing when declined", () => {
  renderRail();
  const asked = fakeConfirm(false);
  trash("Remove workspace beta");
  choose(row("beta"), "Remove workspace…");
  assert.equal(asked.length, 2);
  assert.equal(asked[1], asked[0]);
  assert.match(asked[0], /^Remove workspace "beta"\?/);
  assert.deepEqual(calls, []);
  fakeConfirm(true);
  choose(row("beta"), "Remove workspace…");
  assert.deepEqual(calls, [`removeProject ${BETA.path}`]);
});

test("Remove worktree… asks what the trash button asks, and removes nothing when declined", async () => {
  renderRail();
  const wt = worktreeRow();
  const asked = fakeConfirm(false);
  trash("Remove worktree ticket-509");
  choose(wt, "Remove worktree…");
  assert.equal(asked.length, 2);
  assert.equal(asked[1], asked[0]);
  assert.match(asked[0], /^Remove worktree "ticket-509"\?/);
  assert.deepEqual(calls, []);
  fakeConfirm(true);
  choose(wt, "Remove worktree…");
  await act(async () => {});
  assert.deepEqual(calls, [`removeWorktree ${BETA.path} ${BETA_WT.path}`]);
});
