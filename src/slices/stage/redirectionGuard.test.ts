/// <reference types="node" />
// Component tests for the RedirectionGuard warning (#629): the startup check's answer, shown as a
// shell-wide warning over the real banner. They fake only Tauri's `invoke`, the out-of-process
// boundary.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { ShellWarningBanner } = await import("./ShellWarningBanner.tsx");
const { dismissShellWarning } = await import("./shellWarnings.ts");
const { REDIRECTION_GUARD_WARNING_ID, warnOfRedirectionGuard } = await import("./redirectionGuard.ts");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  act(() => dismissShellWarning(REDIRECTION_GUARD_WARNING_ID));
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

/** Runs the startup ask over a backend that answers `answer`, and returns what the banner shows. */
async function startUp(answer: () => Promise<unknown>, dismiss: () => Promise<unknown> = async () => null) {
  const calls: string[] = [];
  fakeInvoke(async (command) => {
    calls.push(command);
    if (command === "get_redirection_guard_warning") return answer();
    if (command === "dismiss_redirection_guard_warning") return dismiss();
    throw new Error(`no fake for ${command}`);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() => root.render(createElement(ShellWarningBanner)));
  await act(async () => warnOfRedirectionGuard());
  return { calls, container };
}

const quiet = (run: () => Promise<void>) => async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await run();
  } finally {
    console.warn = warn;
  }
};

test("with RedirectionGuard enforced the banner names the fix first, then the effect, as an alert", async () => {
  const { container } = await startUp(async () => true);
  const lines = container.querySelectorAll("[data-shell-warning]");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].getAttribute("role"), "alert");
  const text = lines[0].textContent ?? "";
  assert.match(text, /^Restart Quay from the Start menu, taskbar or Explorer:.*can't follow symlinks.*node_modules.*commit hooks/);
});

test("with RedirectionGuard off the banner shows nothing", async () => {
  const { container } = await startUp(async () => false);
  assert.equal(container.innerHTML, "");
});

test(
  "an ask that fails shows nothing",
  quiet(async () => {
    const { container } = await startUp(async () => {
      throw new Error("no command");
    });
    assert.equal(container.innerHTML, "");
  }),
);

test("an answer other than true shows nothing", async () => {
  const { container } = await startUp(async () => "true");
  assert.equal(container.innerHTML, "");
});

test("dismissing it removes it and tells the backend, so a reloaded window stays quiet", async () => {
  let show = true;
  const { calls, container } = await startUp(
    async () => show,
    async () => {
      show = false;
      return null;
    },
  );
  const dismiss = container.querySelector('button[aria-label="Dismiss warning"]') as HTMLButtonElement;
  await act(async () => dismiss.click());
  assert.equal(container.innerHTML, "");
  assert.deepEqual(calls, ["get_redirection_guard_warning", "dismiss_redirection_guard_warning"]);
  await act(async () => warnOfRedirectionGuard());
  assert.equal(container.innerHTML, "", "the reload's ask shows nothing");
});

test(
  "a dismissal the backend refuses still removes the banner",
  quiet(async () => {
    const { container } = await startUp(
      async () => true,
      async () => {
        throw new Error("no command");
      },
    );
    const dismiss = container.querySelector('button[aria-label="Dismiss warning"]') as HTMLButtonElement;
    await act(async () => dismiss.click());
    assert.equal(container.innerHTML, "");
  }),
);
