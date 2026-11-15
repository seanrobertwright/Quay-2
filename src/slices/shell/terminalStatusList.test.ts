/// <reference types="node" />
// Component tests for the module bar's terminal status list (#633): a labelled list of 48 x 24
// px rows from x = 0, names a screen reader hears, the selected row's bar, the gap between
// projects, clicks, and the +N row past the cap.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeStatus, TerminalInfo } from "../terminal/types.ts";
import type { StatusRow } from "./terminalStatus.ts";
import { dotStatus } from "./terminalStatus.ts";

const { TerminalStatusList } = await import("./TerminalStatusList.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

const row = (id: string, status: ClaudeStatus, projectName = "alpha"): StatusRow => {
  const terminal: TerminalInfo = {
    id,
    name: `term-${id}`,
    project_path: `C:/${projectName}`,
    run_kind: "claude",
    permission_mode: "normal",
    live_mode: "normal",
    claude_status: status,
    auto_approved_count: 0,
  };
  return { terminal, status: dotStatus(terminal), projectName, group: projectName };
};

function render(rows: StatusRow[], selectedTerminalId: string | null = null, maxHeight: number | null = null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const calls = { selected: [] as string[], openedProjects: 0 };
  act(() =>
    root.render(
      createElement(TerminalStatusList, {
        rows,
        maxHeight,
        selectedTerminalId,
        onSelectTerminal: (id: string) => calls.selected.push(id),
        onOpenProjects: () => calls.openedProjects++,
      }),
    ),
  );
  mounted = { root, container };
  const list = container.querySelector("ul");
  const buttons = () => [...container.querySelectorAll("button")] as HTMLButtonElement[];
  return { container, list, buttons, calls };
}

test("the rows form a list labelled Terminals, each named by terminal and status", () => {
  const { list, buttons } = render([row("1", "working"), row("2", "waiting"), row("3", "idle"), row("4", "exited")]);
  assert.ok(list);
  assert.equal(list.getAttribute("aria-label"), "Terminals");
  assert.equal(list.querySelectorAll(":scope > li").length, 4);
  assert.deepEqual(
    buttons().map((b) => b.getAttribute("aria-label")),
    ["term-1, working", "term-2, waiting on you", "term-3, idle", "term-4, exited"],
  );
});

test("each row is 48 x 24 px from x = 0 with nothing outside the button", () => {
  const { list, buttons } = render([row("1", "idle")]);
  assert.ok(list);
  const listStyle = getComputedStyle(list);
  assert.equal(listStyle.marginLeft, "0px");
  assert.equal(listStyle.paddingLeft, "0px");
  for (const b of buttons()) {
    const s = getComputedStyle(b);
    assert.equal(s.width, "48px");
    assert.equal(s.height, "24px");
    assert.equal(s.marginLeft, "0px");
    assert.equal(s.borderLeftWidth || "0px", "0px");
  }
});

test("the tooltip names project, terminal and status", () => {
  const { buttons } = render([row("1", "waiting", "beta")]);
  assert.match(buttons()[0].textContent ?? "", /beta · term-1 · waiting on you/);
});

test("clicking a row selects its terminal; only the selected row has the left bar", () => {
  const { buttons, calls, container } = render([row("1", "idle"), row("2", "idle")], "2");
  act(() => buttons()[0].click());
  assert.deepEqual(calls.selected, ["1"]);
  assert.equal(buttons()[1].getAttribute("aria-current"), "true");
  assert.equal(buttons()[0].getAttribute("aria-current"), null);
  assert.equal(container.querySelectorAll("[data-selected-bar]").length, 1);
  assert.ok(buttons()[1].querySelector("[data-selected-bar]"));
});

test("a 6 px gap separates one project's rows from the next", () => {
  const { list } = render([row("1", "idle", "alpha"), row("2", "idle", "alpha"), row("3", "idle", "beta")]);
  assert.ok(list);
  const items = [...list.querySelectorAll(":scope > li")] as HTMLElement[];
  assert.deepEqual(
    items.map((li) => li.style.marginTop),
    ["0px", "0px", "6px"],
  );
});

test("past the cap a last +N row opens the Projects panel and the waiting terminal keeps its row", () => {
  const rows = Array.from({ length: 15 }, (_, i) => row(String(i), i === 14 ? "waiting" : "idle"));
  const { buttons, calls } = render(rows);
  const all = buttons();
  assert.equal(all.length, 12);
  assert.ok(all.some((b) => b.getAttribute("aria-label") === "term-14, waiting on you"));
  const more = all[all.length - 1];
  assert.equal(more.getAttribute("aria-label"), "4 more terminals in the Projects panel");
  act(() => more.click());
  assert.equal(calls.openedProjects, 1);
});

test("with no terminals the list does not render", () => {
  const { list } = render([]);
  assert.equal(list, null);
});

test("on a short window fewer rows show and the waiting terminal keeps its row", () => {
  const rows = [row("1", "idle"), row("2", "idle"), row("3", "waiting")];
  // Room for two rows: one terminal and the +N row.
  const { buttons } = render(rows, null, 8 + 2 * 24);
  assert.deepEqual(
    buttons().map((b) => b.getAttribute("aria-label")),
    ["term-3, waiting on you", "2 more terminals in the Projects panel"],
  );
});
