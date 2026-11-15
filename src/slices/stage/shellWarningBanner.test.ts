/// <reference types="node" />
// Component tests for the shell-wide warning banner (#635): shown only while a warning is live,
// newest on top, each one dismissible.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { ShellWarningBanner } = await import("./ShellWarningBanner.tsx");
const { showShellWarning, dismissShellWarning } = await import("./shellWarnings.ts");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  act(() => {
    dismissShellWarning("redirection-guard");
    dismissShellWarning("disk");
  });
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(ShellWarningBanner)));
  mounted = { root, container };
  const lines = () => [...container.querySelectorAll('[data-shell-warning]')] as HTMLElement[];
  return { container, lines };
}

test("with no live warning the banner takes no room", () => {
  const { container } = render();
  assert.equal(container.innerHTML, "");
});

test("a live warning shows as one line with an alert role, newest on top", () => {
  const { lines } = render();
  act(() => showShellWarning({ id: "redirection-guard", message: "Terminals cannot follow symlinks." }));
  act(() => showShellWarning({ id: "disk", message: "The disk is almost full." }));
  assert.deepEqual(lines().map((l) => l.textContent?.includes("disk is almost full")), [true, false]);
  assert.ok(lines()[1].textContent?.includes("Terminals cannot follow symlinks."));
  assert.equal(lines()[0].getAttribute("role"), "alert");
});

test("each warning's Dismiss button removes only that warning", () => {
  const { container, lines } = render();
  act(() => showShellWarning({ id: "redirection-guard", message: "Terminals cannot follow symlinks." }));
  act(() => showShellWarning({ id: "disk", message: "The disk is almost full." }));
  const dismiss = lines()[1].querySelector('button[aria-label="Dismiss warning"]') as HTMLButtonElement;
  assert.ok(dismiss);
  act(() => dismiss.click());
  assert.equal(lines().length, 1);
  assert.ok(lines()[0].textContent?.includes("disk is almost full"));
  act(() => (lines()[0].querySelector("button") as HTMLButtonElement).click());
  assert.equal(container.innerHTML, "");
});
