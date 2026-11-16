/// <reference types="node" />
// Component tests for the Project panel (#647): the This project group, the Quay · every project
// group's inline settings, and the chords' focus targets.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ShellPrefKey, ShellPrefs } from "./shellPrefs.ts";

const { ProjectPanel } = await import("./ProjectPanel.tsx");

const DEFAULTS: ShellPrefs = {
  piePalette: "spectrum",
  pieLabelOutline: true,
  pieDisplayDelayMs: 150,
  mergeUndoSeconds: 5,
  companionOpensOn: "pull-request",
  soundChime: true,
};

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

type Props = Parameters<typeof ProjectPanel>[0];

async function render(over: Partial<Props> = {}) {
  const calls: string[] = [];
  const set: [ShellPrefKey, unknown][] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const props: Props = {
    projectName: "quay-2",
    hasProject: true,
    spendTodayUsd: 4.12,
    appVersion: "0.7.0",
    prefs: DEFAULTS,
    focusRequest: null,
    onOpenWorkspaceSettings: () => calls.push("settings"),
    onOpenInVsCode: () => calls.push("vscode"),
    onOpenTokenSpend: () => calls.push("spend"),
    onOpenLogsFolder: () => calls.push("logs"),
    onCheckForUpdates: () => calls.push("updates"),
    onSetPref: (key, value) => set.push([key, value]),
    ...over,
  };
  await act(async () => root.render(createElement(ProjectPanel, props)));
  const rerender = (next: Partial<Props>) => act(async () => root.render(createElement(ProjectPanel, { ...props, ...next })));
  return { container, calls, set, rerender };
}

const group = (container: HTMLElement, name: string): HTMLElement => {
  const found = [...container.querySelectorAll<HTMLElement>("[role=group]")].find((el) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    return labelledBy !== null && document.getElementById(labelledBy)?.textContent === name;
  });
  assert.ok(found, `group ${name}`);
  return found;
};
const buttonNamed = (scope: HTMLElement, name: string): HTMLButtonElement => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);
  assert.ok(found, `button ${name}`);
  return found;
};

test("This project holds workspace settings, Open in VS Code, token spend and the logs folder", async () => {
  const { container, calls } = await render();
  const thisProject = group(container, "This project");
  for (const [name, call] of [
    ["Workspace settings", "settings"],
    ["Open in VS Code", "vscode"],
    ["Token spend", "spend"],
    ["Logs folder", "logs"],
  ] as const) {
    await act(async () => buttonNamed(thisProject, name).click());
    assert.equal(calls[calls.length - 1], call);
  }
  assert.match(thisProject.textContent ?? "", /\$4\.12 today/);
});

test("without a project, workspace settings and Open in VS Code are disabled", async () => {
  const { container } = await render({ hasProject: false, projectName: null });
  const thisProject = group(container, "This project");
  assert.equal(buttonNamed(thisProject, "Workspace settings").disabled, true);
  assert.equal(buttonNamed(thisProject, "Open in VS Code").disabled, true);
  assert.equal(buttonNamed(thisProject, "Token spend").disabled, false);
  assert.equal(buttonNamed(thisProject, "Logs folder").disabled, false);
});

const radioGroup = (scope: HTMLElement, name: string): HTMLElement => {
  const found = [...scope.querySelectorAll<HTMLElement>("[role=radiogroup]")].find((el) => el.getAttribute("aria-label") === name);
  assert.ok(found, `radio group ${name}`);
  return found;
};
const radios = (scope: HTMLElement) =>
  [...scope.querySelectorAll<HTMLElement>("[role=radio]")].map((r) => [r.textContent?.trim(), r.getAttribute("aria-checked")]);

test("Quay · every project holds each shell setting with its values, the current one checked", async () => {
  const { container } = await render();
  const quay = group(container, "Quay · every project");
  assert.deepEqual(radios(radioGroup(quay, "Pie palette")), [
    ["Spectrum", "true"],
    ["Cyan + magenta", "false"],
    ["Cyan + orange", "false"],
    ["Lime + cyan", "false"],
    ["Pink + yellow", "false"],
    ["Ice white + green", "false"],
  ]);
  assert.deepEqual(radios(radioGroup(quay, "Pie display delay")), [
    ["None", "false"],
    ["150 ms", "true"],
    ["300 ms", "false"],
  ]);
  assert.deepEqual(radios(radioGroup(quay, "Merge undo window")), [
    ["Off", "false"],
    ["3 s", "false"],
    ["5 s", "true"],
    ["10 s", "false"],
  ]);
  assert.deepEqual(radios(radioGroup(quay, "Companion opens on")), [
    ["Pull request", "true"],
    ["Ticket", "false"],
    ["Activity", "false"],
  ]);
  assert.equal(buttonNamed(quay, "Pie label outline").getAttribute("aria-pressed"), "true");
  assert.equal(buttonNamed(quay, "Sound chime").getAttribute("aria-pressed"), "true");
  assert.ok(buttonNamed(quay, "Check for updates"));
});

test("one click on a value or a switch sets that setting", async () => {
  const { container, set, calls } = await render();
  const quay = group(container, "Quay · every project");
  const radio = (groupName: string, label: string) =>
    [...radioGroup(quay, groupName).querySelectorAll<HTMLElement>("[role=radio]")].find((r) => r.textContent?.trim() === label)!;
  await act(async () => radio("Pie palette", "Pink + yellow").click());
  await act(async () => radio("Pie display delay", "None").click());
  await act(async () => radio("Merge undo window", "10 s").click());
  await act(async () => radio("Companion opens on", "Activity").click());
  await act(async () => buttonNamed(quay, "Pie label outline").click());
  await act(async () => buttonNamed(quay, "Sound chime").click());
  assert.deepEqual(set, [
    ["piePalette", "sunset"],
    ["pieDisplayDelayMs", 0],
    ["mergeUndoSeconds", 10],
    ["companionOpensOn", "activity"],
    ["pieLabelOutline", false],
    ["soundChime", false],
  ]);
  await act(async () => buttonNamed(quay, "Check for updates").click());
  assert.deepEqual(calls, ["updates"]);
});

// Compared by identity: on a failure, assert.equal would try to print two DOM elements.
const isFocused = (el: HTMLElement) => document.activeElement === el;

test("chords t and $ focus the This project group, and u focuses Check for updates, again on a repeat", async () => {
  const { container, rerender } = await render();
  await rerender({ focusRequest: { target: "this-project", seq: 1 } });
  assert.ok(isFocused(buttonNamed(group(container, "This project"), "Workspace settings")), "Workspace settings is focused");
  await rerender({ focusRequest: { target: "check-for-updates", seq: 2 } });
  const updates = buttonNamed(group(container, "Quay · every project"), "Check for updates");
  assert.ok(isFocused(updates), "Check for updates is focused");
  (document.activeElement as HTMLElement).blur();
  await rerender({ focusRequest: { target: "check-for-updates", seq: 3 } });
  assert.ok(isFocused(updates), "Check for updates is focused again");
});

test("arrow keys in a radio group pick the next or previous value, and only the checked one is tabbable", async () => {
  const { container, set } = await render();
  const delay = radioGroup(group(container, "Quay · every project"), "Pie display delay");
  const tabbable = [...delay.querySelectorAll<HTMLElement>("[role=radio]")].map((r) => r.tabIndex);
  assert.deepEqual(tabbable, [-1, 0, -1]);
  await act(async () => delay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  await act(async () => delay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  assert.deepEqual(set, [
    ["pieDisplayDelayMs", 300],
    ["pieDisplayDelayMs", 0],
  ]);
});

test("every control in the panel has a programmatic label", async () => {
  const { container } = await render();
  const controls = [...container.querySelectorAll<HTMLElement>("button, input, select")];
  assert.ok(controls.length > 20);
  for (const control of controls) {
    const name = control.getAttribute("aria-label") ?? control.textContent?.trim();
    assert.ok(name, control.outerHTML);
  }
});
