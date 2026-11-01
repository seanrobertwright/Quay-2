/// <reference types="node" />
// Component tests for the template form's host status line and the Install on host… dialog
// (#451): each state the dialog opens on, and Check again. They render the real components into
// happy-dom and fake only Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TemplateHostState, TemplateHostView } from "./hostCatalog.ts";
import type { TemplateHost } from "./HostStatusLine.tsx";
import { createNewDraft } from "./drafts.ts";
import type { ChangeStatus } from "./types.ts";

const { InstallDialog } = await import("./InstallDialog.tsx");
const { HostStatusLine } = await import("./HostStatusLine.tsx");
const { TemplateForm } = await import("./TemplateForm.tsx");

const NOW = 1_800_000_000_000;
const NAME = "build-app";

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  mock.timers.reset();
});

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  return container;
}

const host = (state: TemplateHostState, extra: Partial<TemplateHostView> = {}, onCheckAgain = () => {}): TemplateHost => ({
  view: { state, checkedAt: NOW - 3 * 60_000, muted: false, checking: false, ...extra },
  condition: { state: "signedIn" },
  onCheckAgain,
});

// The saved template file and its diff, as the backend gives them.
function fakeBackend(): void {
  fakeInvoke(async (cmd) => {
    switch (cmd) {
      case "praxis_path":
        return `C:/project/.praxis/templates/${NAME}.json`;
      case "praxis_read":
        return { id: NAME, kind: "templates", missing: false, content: {} };
      case "praxis_diff":
        return { path: `.praxis/templates/${NAME}.json`, status: "modified", diff: "+x\n", truncated: false };
      case "praxis_validate":
        return { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
      default:
        throw new Error(`unexpected invoke ${cmd}`);
    }
  });
}

const dialog = (templateHost: TemplateHost | null, changed: ChangeStatus | undefined = undefined) =>
  createElement(InstallDialog, {
    rootRef: createRef<HTMLDivElement>(),
    projectPath: "C:/project",
    name: NAME,
    changed,
    refresh: 0,
    unsaved: false,
    host: templateHost,
    onClose: () => {},
  });

const text = (el: Element) => el.textContent ?? "";
const section = (root: HTMLElement, label: string) => root.querySelector(`section[aria-label="${label}"]`);
const checkAgainButton = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].find((b) => /Check again|Checking…/.test(text(b))) ?? null;

test("Not installed: the dialog opens on the copy steps, then Check again and both notes", async () => {
  fakeBackend();
  const root = await render(dialog(host({ kind: "notInstalled" })));
  assert.ok(section(root, "Template file"), "the steps are shown");
  assert.doesNotMatch(text(root), /replaces/);
  const onHost = section(root, "On the host");
  assert.ok(onHost);
  assert.match(text(onHost), /Not installed/);
  assert.match(text(onHost), /only after a restart/);
  assert.match(text(onHost), /never how/);
  assert.ok(checkAgainButton(onHost as HTMLElement));
  // Check again follows the steps.
  const steps = section(root, "Template file") as Element;
  assert.ok(steps.compareDocumentPosition(onHost) & 4 /* DOCUMENT_POSITION_FOLLOWING */);
});

test("Differs: the replace warning shows beside the uncommitted-diff warning, with the steps", async () => {
  fakeBackend();
  const root = await render(dialog(host({ kind: "differs" }), "modified"));
  assert.match(text(root), /changes that aren't committed/);
  assert.match(text(root), /Installing replaces the host's copy with this saved file/);
  assert.ok(section(root, "Template file"), "the steps are still shown");
});

test("Installed: the dialog says there's nothing to do and holds back the steps", async () => {
  fakeBackend();
  const root = await render(dialog(host({ kind: "installed" })));
  assert.match(text(root), /nothing to do/);
  assert.equal(section(root, "Template file"), null);
  assert.equal(root.querySelector('[aria-label^="Copy"]'), null);
  assert.ok(section(root, "On the host"), "Check again is still offered");
});

test("Name the host refuses: the steps are withheld and the rule is explained", async () => {
  fakeBackend();
  const root = await render(dialog(host({ kind: "nameRefused", rule: "Use lowercase letters, digits and dashes." })));
  const refused = section(root, "Name the host refuses");
  assert.ok(refused);
  assert.match(text(refused), /Use lowercase letters, digits and dashes\./);
  assert.equal(section(root, "Template file"), null);
  assert.doesNotMatch(text(root), /Reading /);
  assert.equal(checkAgainButton(root), null, "a refused name is never read, so there is nothing to check again");
});

test("without a host catalog the dialog opens on the steps, as before", async () => {
  fakeBackend();
  const root = await render(dialog(null));
  assert.ok(section(root, "Template file"));
  assert.equal(section(root, "On the host"), null);
});

test("Check again asks the catalog, and does nothing more while that check runs", async () => {
  const onCheckAgain = mock.fn();
  const root = await render(createElement(HostStatusLine, { host: host({ kind: "differs" }, {}, onCheckAgain) }));
  const button = checkAgainButton(root) as HTMLButtonElement;
  await act(async () => button.click());
  assert.equal(onCheckAgain.mock.callCount(), 1);

  await act(async () => mounted?.root.render(createElement(HostStatusLine, { host: host({ kind: "differs" }, { checking: true }, onCheckAgain) })));
  const busy = checkAgainButton(root) as HTMLButtonElement;
  assert.equal(text(busy), "Checking…");
  assert.equal(busy.getAttribute("aria-disabled"), "true");
  assert.equal(busy.disabled, false, "it keeps focus while the check runs");
  await act(async () => busy.click());
  assert.equal(onCheckAgain.mock.callCount(), 1);
});

test("'checked N min ago' moves forward each minute while the line is shown", async () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: NOW });
  const root = await render(createElement(HostStatusLine, { host: host({ kind: "installed" }) }));
  assert.match(text(root), /checked 3 min ago/);
  await act(async () => mock.timers.tick(60_000));
  assert.match(text(root), /checked 4 min ago/);
});

test("the template form shows the status line beside Install on host…, not the old shape-only line", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  fakeBackend();
  const draft = createNewDraft({ kind: "templates", id: NAME }, {});
  assert.ok(draft.ok);
  const root = await render(
    createElement(TemplateForm, {
      draft: draft.value,
      onEdit: () => {},
      onValidated: () => {},
      onInstall: () => {},
      host: host({ kind: "notReady", reason: "No runner is set up." }),
    })
  );
  assert.doesNotMatch(text(root), /Not previewed on a host/);
  const install = [...root.querySelectorAll("button")].find((b) => text(b).includes("Install on host…")) as HTMLElement;
  const row = install.parentElement as HTMLElement;
  assert.match(text(row), /Installed, not ready\. No runner is set up\. · checked 3 min ago/);
  assert.ok(checkAgainButton(row));
});
