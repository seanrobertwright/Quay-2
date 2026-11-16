/// <reference types="node" />
// The companion's Run view (#645): a run picked in the Workflows panel shows in the companion,
// for the selected terminal or with none selected.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo as terminal } from "./fixtures/companionFixtures.ts";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const projects = [{ path: "E:/alpha", name: "Alpha", terminal_ids: [] }];
const worktrees = { "E:/alpha": [{ path: "E:/alpha", head: "a1", branch: "main", is_main: true, is_bare: false, is_locked: false }] };
const RUN = { key: "archon:run-1", content: createElement("p", null, "The picked run") };

function render(selected: TerminalInfo | null, run: typeof RUN | null, showRequest: { terminalId: string; view: "run"; seq: number } | null = null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  act(() =>
    root.render(
      createElement(Companion, {
        selectedTerminal: selected,
        projects,
        projectWorktrees: worktrees,
        views: COMPANION_VIEWS,
        prefs: companionPrefs(memoryStorage()),
        run,
        showRequest,
      }),
    ),
  );
  return container;
}

const shownView = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-companion-view]")?.dataset.companionView;
const switchNames = (container: HTMLElement) => [...container.querySelectorAll('[role="radio"]')].map((r) => r.textContent);

test("a picked run adds Run to the view switch, and a request for it shows it", () => {
  const selected = terminal("t1", "E:/alpha");
  assert.ok(!switchNames(render(selected, null)).includes("Run"));
  mounted && act(() => mounted!.root.unmount());
  mounted = null;
  const container = render(selected, RUN, { terminalId: "t1", view: "run", seq: 1 });
  assert.ok(switchNames(container).includes("Run"));
  assert.equal(shownView(container), "run");
  assert.match(container.textContent ?? "", /The picked run/);
});

test("with no terminal selected, a picked run still shows in the Run view", () => {
  const container = render(null, RUN);
  assert.equal(shownView(container), "run");
  assert.match(container.textContent ?? "", /The picked run/);
});
