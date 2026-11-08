/// <reference types="node" />
// Component tests for the Open Project dialog's folder list and Recent list (#512): double-click
// goes into a folder, git repo or not, and only Open or Enter in the path bar opens a project.
// They render the real dialog into happy-dom and fake only Tauri's `invoke`, the out-of-process
// boundary, answering it with a small folder tree.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { OpenProjectDialog } = await import("./OpenProjectDialog.tsx");

const HOME = "C:\\Users\\me";
const REPO = "C:\\Users\\me\\repo";
const PLAIN = "C:\\Users\\me\\notes";
const RECENT = "C:\\Work\\recent-repo";

interface Entry {
  name: string;
  path: string;
  is_git: boolean;
  branch: string | null;
}

const entry = (path: string, isGit: boolean): Entry => ({
  name: path.slice(path.lastIndexOf("\\") + 1),
  path,
  is_git: isGit,
  branch: isGit ? "main" : null,
});

/** The fake disk: each folder's subfolders, and which folders are git repos. */
const TREE = new Map<string, Entry[]>([
  [HOME, [entry(REPO, true), entry(PLAIN, false)]],
  [REPO, [entry(`${REPO}\\packages`, false), entry(`${REPO}\\docs`, false)]],
  [PLAIN, [entry(`${PLAIN}\\2026`, false)]],
  ["C:\\Work", [entry(RECENT, true)]],
  [RECENT, []],
]);
const GIT = new Set([REPO, RECENT]);

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

/**
 * Renders the open dialog over the fake disk. Recent holds one project in another folder only
 * when `withRecent` is set, since the browser starts beside the first recent project.
 */
async function renderDialog({ withRecent = false } = {}) {
  const added: string[] = [];
  const selected: string[] = [];
  let closed = 0;
  fakeInvoke(async (command, args) => {
    const path = String(args?.path ?? "");
    switch (command) {
      case "open_project_places":
        return { home: HOME, drives: ["C:\\"] };
      case "list_recent_projects":
        return withRecent
          ? [{ path: RECENT, name: "recent-repo", last_opened: 1, exists: true, is_git: true, branch: "main" }]
          : [];
      case "list_folder":
        const entries = TREE.get(path);
        if (!entries) throw `Can't read ${path}`;
        return { path, entries, truncated: false };
      case "inspect_folder":
        return { exists: TREE.has(path), is_git: GIT.has(path), branch: GIT.has(path) ? "main" : null };
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  const element = () =>
    createElement(OpenProjectDialog, {
      isOpen: true,
      onClose: () => {
        closed += 1;
      },
      projects: [],
      onAddProject: async (path: string) => {
        added.push(path);
      },
      onSelectProject: (path: string) => {
        selected.push(path);
      },
    });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element()));
  await settle();
  return { container, added, selected, closed: () => closed };
}

/** Lets the fake backend answer, and the path bar's lookup run once its typing delay passes. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));

const text = (el: Element | null) => el?.textContent ?? "";
const folderList = (root: HTMLElement) => root.querySelector('ul[aria-label="Folders"]') as HTMLElement;
const folderNames = (root: HTMLElement) =>
  [...folderList(root).querySelectorAll("button")].map((b) => text(b.querySelector("span")));
const button = (scope: Element, name: RegExp) =>
  [...scope.querySelectorAll("button")].find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as
    | HTMLButtonElement
    | undefined;
const folder = (root: HTMLElement, name: string) => {
  const found = button(folderList(root), new RegExp(`^${name}`));
  assert.ok(found, `${name} is in the folder list`);
  return found;
};
const crumbs = (root: HTMLElement) =>
  [...(root.querySelector("nav") as HTMLElement).querySelectorAll("span > button")].map((b) => text(b));
const pathBar = (root: HTMLElement) => root.querySelector('input[aria-label="Folder path"]') as HTMLInputElement;

async function doubleClick(el: HTMLElement) {
  await act(async () => {
    el.click();
    el.click();
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
  });
  await settle();
}

test("double-clicking a git folder goes into it and lists its subfolders, without opening a project", async () => {
  const dialog = await renderDialog();
  assert.deepEqual(folderNames(dialog.container), ["repo", "notes"], "the browser starts at home");
  await doubleClick(folder(dialog.container, "repo"));
  assert.deepEqual(folderNames(dialog.container), ["packages", "docs"]);
  assert.deepEqual(crumbs(dialog.container), ["C:", "Users", "me", "repo"]);
  assert.equal(pathBar(dialog.container).value, REPO, "the path bar follows the browser");
  assert.deepEqual(dialog.added, [], "no project was added");
  assert.deepEqual(dialog.selected, [], "no project was switched to");
  assert.equal(dialog.closed(), 0, "the dialog stays open");
});

test("double-clicking a plain folder goes into it", async () => {
  const dialog = await renderDialog();
  await doubleClick(folder(dialog.container, "notes"));
  assert.deepEqual(folderNames(dialog.container), ["2026"]);
  assert.deepEqual(crumbs(dialog.container), ["C:", "Users", "me", "notes"]);
  assert.deepEqual(dialog.added, []);
});

test("a single click selects a git folder and fills the path bar, and Open then opens it", async () => {
  const dialog = await renderDialog();
  await act(async () => folder(dialog.container, "repo").click());
  await settle();
  assert.equal(pathBar(dialog.container).value, REPO);
  assert.deepEqual(folderNames(dialog.container), ["repo", "notes"], "the browser stays where it was");
  assert.match(text(dialog.container), /Git repo · main/, "the verdict chip describes the selection");
  assert.deepEqual(dialog.added, [], "a click alone opens nothing");
  const open = button(dialog.container, /^Open$/);
  assert.ok(open);
  assert.equal(open.disabled, false);
  await act(async () => open.click());
  assert.deepEqual(dialog.added, [REPO]);
  assert.equal(dialog.closed(), 1);
});

test("Enter in the path bar opens the folder it names", async () => {
  const dialog = await renderDialog();
  await act(async () => folder(dialog.container, "repo").click());
  await settle();
  await act(async () => {
    pathBar(dialog.container).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.deepEqual(dialog.added, [REPO]);
  assert.equal(dialog.closed(), 1);
});

test("double-clicking a Recent entry still opens it", async () => {
  const dialog = await renderDialog({ withRecent: true });
  const aside = dialog.container.querySelector("aside") as HTMLElement;
  const recent = button(aside, /^recent-repo/);
  assert.ok(recent, "the recent project is in the sidebar");
  await doubleClick(recent);
  assert.deepEqual(dialog.added, [RECENT]);
  assert.equal(dialog.closed(), 1);
});
