/// <reference types="node" />
// Component tests for what the builder shows after "Import to project" on a host-only workflow
// template (#563): the template joins the Workflow templates list, as a file new since the last
// commit, and leaves On host only, it opens in the editor, and the builder shows and announces
// where it was written. A refused import does none of these. Focus, which the Import to project
// button takes with it when its panel goes, moves to the template's row once the project's list has
// been read again (#591). hostCatalog.test.ts covers the import itself, and hostList.test.ts the
// button and its panel.
// They render the real builder into happy-dom and fake only Tauri's `invoke`, the out-of-process
// boundary.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { PraxisBuilderModal } = await import("./PraxisBuilderModal.tsx");

const PROJECT = "C:/project";
/** The template the project already has, which the host has too. */
const LOCAL = "release";
/** The template only the host has. */
const HOST_ONLY = "triage";
const PLAN = { nodes: [] };
const CONFIRMATION = "Imported triage into .praxis/templates/triage.json";
const REFUSAL = "praxis: The host doesn't know a workflow template named triage.";

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

/**
 * The backend: a project with one workflow template, LOCAL, and a signed-in host that has LOCAL
 * and HOST_ONLY. `show` is what the host answers `workflows show` for HOST_ONLY with: its plan, or
 * a refusal. A save of a template writes its file, so from then on the project lists it and git
 * has it as added. `listAfterImport` is how the project's lists answer once that file is written:
 * at once, with an error, or held back until `releaseLists` is called. Returns the names of the
 * commands sent.
 */
function fakeBackend(show: "plan" | "refused", listAfterImport: "answers" | "fails" | "held" = "answers"): { sent: string[]; releaseLists: () => void } {
  const sent: string[] = [];
  let releaseLists = () => {};
  const listsReleased = new Promise<void>((resolve) => (releaseLists = resolve));
  const files = new Map<string, unknown>([[LOCAL, PLAN]]);
  const added: string[] = [];
  const hostTemplate = (name: string) => ({ name, revision: 2, description: `Runs ${name}`, validity: "VALID", diagnostics: [] });
  fakeInvoke(async (command, args) => {
    sent.push(command);
    switch (command) {
      case "praxis_list":
        if (added.length > 0 && listAfterImport === "fails") throw new Error("can't read .praxis");
        if (added.length > 0 && listAfterImport === "held") await listsReleased;
        return { entries: args.kind === "templates" ? [...files.keys()].map((id) => ({ id, templateDigest: `digest-${id}` })) : [], truncated: false };
      case "praxis_changes":
        return { files: added.map((id) => ({ kind: "templates", id, status: "added" })) };
      case "praxis_check_context":
        return { contracts: [], unchecked: [] };
      case "praxis_host_condition":
        return { state: "signedIn" };
      case "praxis_host_workflows_list":
        return { kind: "record", record: { templates: [hostTemplate(LOCAL), hostTemplate(HOST_ONLY)] } };
      case "praxis_host_workflow_show":
        if (args.name === HOST_ONLY && show === "refused") return { kind: "hostRefused", message: REFUSAL, hostCode: "NOT_FOUND", record: {} };
        return { kind: "record", record: { ...hostTemplate(String(args.name)), plan: PLAN, templateDigest: `digest-${String(args.name)}`, runnable: true } };
      case "praxis_save":
        files.set(String(args.id), args.content);
        added.push(String(args.id));
        return { status: "saved", content: args.content, contentHash: "hash", templateDigest: `digest-${String(args.id)}` };
      case "praxis_read":
        return files.has(String(args.id))
          ? { id: args.id, kind: args.kind, missing: false, contentHash: "hash", content: files.get(String(args.id)) }
          : { id: args.id, kind: args.kind, missing: true };
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  return { sent, releaseLists };
}

const buttons = (root: Element) => [...root.querySelectorAll("button")];
const press = (button: HTMLElement) => act(async () => button.click());

/** The Workflow templates group of the builder's list. */
function templatesGroup(root: HTMLElement): HTMLElement {
  const group = root.querySelector<HTMLElement>('section[aria-label="Workflow templates"]');
  assert.ok(group, "the list has a Workflow templates group");
  return group;
}

/** The names under On host only, which is collapsed until it is opened; none when it isn't shown. */
const hostOnlyNames = (root: HTMLElement) =>
  [...templatesGroup(root).querySelectorAll('ul[aria-label="Workflow templates on the host only"] > li > div:first-child > button')].map((b) => b.textContent);

/** The project's own templates, as the Workflow templates group lists them. */
const listedNames = (root: HTMLElement) => buttons(templatesGroup(root)).flatMap((b) => (b.title === LOCAL || b.title === HOST_ONLY ? [b.title] : []));

/** The rows of the Workflow templates group marked as new since the last commit, by their badges' names. */
const newSinceCommit = (root: HTMLElement) =>
  buttons(templatesGroup(root)).flatMap((b) => ((b.getAttribute("aria-label") ?? "").includes("new since last commit") ? [b.getAttribute("aria-label")] : []));

/** The workflow template open in the editor, by its form's name; null when none is. */
const editorName = (root: HTMLElement) => root.querySelector('form[aria-label^="Workflow template "]')?.getAttribute("aria-label") ?? null;

/** The builder's notice, which a person sees. */
const notices = (root: HTMLElement) => [...root.querySelectorAll('[role="status"]:not([aria-live]), [role="alert"]')].map((el) => el.textContent ?? "");

/** What the builder's live region says, without the space that makes a repeat a change. */
function announced(root: HTMLElement): string {
  const region = root.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]');
  assert.ok(region, "the builder has a live region");
  return (region.textContent ?? "").replace(/\u00a0/g, "");
}

/** The builder's dialog, where focus goes when the element that had it is gone. */
function dialogOf(root: HTMLElement): HTMLElement {
  const dialog = root.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  assert.ok(dialog, "the builder is a dialog");
  return dialog;
}

/** The button that opens a project's template, in its row of the Workflow templates group. */
function rowOf(root: HTMLElement, name: string): HTMLElement {
  const row = buttons(templatesGroup(root)).find((b) => b.title === name);
  assert.ok(row, `${name} has a row under Workflow templates`);
  return row;
}

/** Names an element in a failure, shortly: printing a whole element of the test DOM never ends. */
const named = (el: Element | null) => (el === null ? "nothing" : `<${el.tagName.toLowerCase()}> ${JSON.stringify((el.textContent ?? "").slice(0, 40))}`);

/** Asserts where focus is, by identity. */
const assertFocusOn = (expected: Element) =>
  assert.ok(document.activeElement === expected, `focus is on ${named(document.activeElement)}, not on ${named(expected)}`);

/**
 * Shows the builder on the project, opens On host only and HOST_ONLY's panel, and presses Import to
 * project from the keyboard: the button has focus when it is pressed.
 */
async function importFromHost(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  const builder = createElement(PraxisBuilderModal, { isOpen: true, project: { path: PROJECT, name: "project" }, onClose: () => {}, onAddProject: () => {} });
  await act(async () => root.render(builder));

  const subsection = buttons(templatesGroup(container)).find((b) => b.textContent === "On host only (1)");
  assert.ok(subsection, "the host's one template the project lacks is under On host only");
  await press(subsection);
  assert.deepEqual(hostOnlyNames(container), [HOST_ONLY]);
  assert.deepEqual(listedNames(container), [LOCAL]);
  assert.deepEqual(newSinceCommit(container), []);
  assert.equal(editorName(container), null);

  const row = buttons(templatesGroup(container)).find((b) => b.textContent === HOST_ONLY);
  assert.ok(row);
  await press(row);
  const importButton = buttons(templatesGroup(container)).find((b) => b.textContent === "Import to project");
  assert.ok(importButton, "the template's panel offers Import to project");
  importButton.focus();
  assertFocusOn(importButton);
  await press(importButton);
  return container;
}

test("an imported template is listed under Workflow templates, as read from the project again, and no longer under On host only", async () => {
  fakeBackend("plan");
  const root = await importFromHost();
  assert.deepEqual(listedNames(root), [LOCAL, HOST_ONLY]);
  // Only a list read after the import knows the file is new: a template open in the editor has a row either way.
  assert.deepEqual(newSinceCommit(root), ["triage: new since last commit. Show the diff"]);
  assert.deepEqual(hostOnlyNames(root), []);
  assert.equal(
    buttons(templatesGroup(root)).some((b) => (b.textContent ?? "").startsWith("On host only")),
    false,
    "with nothing left on the host only, the subsection is gone",
  );
});

test("an imported template opens in the editor", async () => {
  fakeBackend("plan");
  const root = await importFromHost();
  assert.equal(editorName(root), "Workflow template triage");
});

test("an import is confirmed with where the template was written, shown and announced", async () => {
  fakeBackend("plan");
  const root = await importFromHost();
  assert.ok(notices(root).includes(CONFIRMATION), JSON.stringify(notices(root)));
  assert.equal(announced(root), CONFIRMATION);
});

test("a refused import lists nothing new, opens nothing and confirms nothing", async () => {
  const { sent } = fakeBackend("refused");
  const root = await importFromHost();
  assert.ok(notices(root).includes(REFUSAL), "the panel says why the host refused");
  assert.deepEqual(listedNames(root), [LOCAL]);
  assert.deepEqual(newSinceCommit(root), []);
  assert.deepEqual(hostOnlyNames(root), [HOST_ONLY]);
  assert.equal(editorName(root), null);
  assert.equal(notices(root).some((text) => text.startsWith("Imported")), false, JSON.stringify(notices(root)));
  assert.equal(announced(root), "");
  assert.equal(sent.includes("praxis_save"), false, "no file was written");
});

test("after an import, focus is on the imported template's row under Workflow templates", async () => {
  fakeBackend("plan");
  const root = await importFromHost();
  assertFocusOn(rowOf(root, HOST_ONLY));
});

test("focus moves to the imported template's row only once the project's list has been read again", async () => {
  const { releaseLists } = fakeBackend("plan", "held");
  const root = await importFromHost();
  // The template is open in the editor, so it has a row already, but the list isn't read yet.
  assert.equal(editorName(root), "Workflow template triage");
  assert.ok(document.activeElement !== rowOf(root, HOST_ONLY), "focus waits for the list");
  await act(async () => releaseLists());
  assert.deepEqual(newSinceCommit(root), ["triage: new since last commit. Show the diff"]);
  assertFocusOn(rowOf(root, HOST_ONLY));
});

test("when the project's list can't be read after an import, focus is in the builder, not on the page", async () => {
  fakeBackend("plan", "fails");
  const root = await importFromHost();
  assert.ok(notices(root).some((text) => text.includes("can't read .praxis")), JSON.stringify(notices(root)));
  assertFocusOn(dialogOf(root));
});

test("focus the user moved to another control while the list was read stays there", async () => {
  const { releaseLists } = fakeBackend("plan", "held");
  const root = await importFromHost();
  const other = rowOf(root, LOCAL);
  other.focus();
  await act(async () => releaseLists());
  assert.deepEqual(newSinceCommit(root), ["triage: new since last commit. Show the diff"]);
  assertFocusOn(other);
});

test("a refused import leaves focus on Import to project", async () => {
  fakeBackend("refused");
  const root = await importFromHost();
  const importButton = buttons(templatesGroup(root)).find((b) => b.textContent === "Import to project");
  assert.ok(importButton, "the panel still offers the import");
  assertFocusOn(importButton);
});

test("an import is announced once, and moving focus to the row announces nothing more", async () => {
  fakeBackend("plan");
  const root = await importFromHost();
  assertFocusOn(rowOf(root, HOST_ONLY));
  // The live region ends each odd announcement with a no-break space and each even one without,
  // so a second announcement of the same words would have taken the space away again.
  const region = root.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]');
  assert.equal(region?.textContent, `${CONFIRMATION} `);
});
