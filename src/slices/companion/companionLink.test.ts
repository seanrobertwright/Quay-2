/// <reference types="node" />
// Component tests for the terminal link in the companion (#637): the header's link and pin mark,
// the candidate strip for a tie, and the Repository view's Link to... picker.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinkRef, LinkSlotName, TerminalInfo, TerminalLink } from "../terminal/types.ts";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";
import type { LinkChoice } from "./linkChoices.ts";

const { Companion, COMPANION_VIEWS } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
});

const projects = [{ path: "E:/alpha", name: "Alpha", terminal_ids: [] }];
const worktrees = {
  "E:/alpha": [{ path: "E:/alpha", head: "a1", branch: "ticket-637", is_main: true, is_bare: false, is_locked: false }],
};

function render(link: TerminalLink | null, choices: (query: string) => LinkChoice[] = () => []) {
  const pins: [string, LinkSlotName, LinkRef][] = [];
  const unpins: [string, LinkSlotName][] = [];
  const loads: string[] = [];
  const terminal: TerminalInfo = { ...terminalInfo("a", "E:/alpha"), link };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(Companion, {
        selectedTerminal: terminal,
        projects,
        projectWorktrees: worktrees,
        views: COMPANION_VIEWS,
        prefs: companionPrefs(memoryStorage()),
        linking: {
          linkOf: (t: TerminalInfo) => t.link ?? null,
          pin: (id: string, slot: LinkSlotName, ref: LinkRef) => void pins.push([id, slot, ref]),
          unpin: (id: string, slot: LinkSlotName) => void unpins.push([id, slot]),
          choices: (_t: TerminalInfo, query: string) => choices(query),
          loadChoices: (t: TerminalInfo) => void loads.push(t.id),
        },
      }),
    ),
  );
  mounted = { root, container };
  return { container, pins, unpins, loads };
}

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name) as
    | HTMLButtonElement
    | undefined;

const linked: TerminalLink = {
  ticket: { repo: null, number: 637, source: "branch", pinned: false, at: 1 },
  pull_request: { repo: null, number: 659, source: "pin", pinned: true, at: 2 },
  candidates: [],
};

test("the header shows the terminal's link and the source that set each slot", () => {
  const { container } = render(linked);
  const header = container.querySelector("header") as HTMLElement;
  assert.match(header.textContent ?? "", /Pull request #659/);
  assert.match(header.textContent ?? "", /Ticket #637/);
  assert.match(header.textContent ?? "", /from the branch/);
});

test("a pull request that closes several tickets lists them all", () => {
  const { container } = render({
    ...linked,
    pull_request: { repo: null, number: 659, source: "branch", pinned: false, at: 2, state: "OPEN", closes: [636, 640] },
  });
  const header = container.querySelector("header") as HTMLElement;
  assert.match(header.textContent ?? "", /closes #636, #640/);
});

test("a pinned slot shows a pin mark that unpins it", () => {
  const { container, unpins } = render(linked);
  assert.equal(button(container, "Unpin ticket #637"), undefined, "an unpinned slot has no pin mark");
  const mark = button(container, "Unpin pull request #659");
  assert.ok(mark, "the pinned pull request has a pin mark");
  act(() => mark.click());
  assert.deepEqual(unpins, [["a", "pull_request"]]);
});

test("tied candidates ask which pull request the terminal belongs to, and one click pins", () => {
  const { container, pins } = render({
    ticket: null,
    pull_request: null,
    candidates: [{ slot: "pull_request", source: "branch", options: [{ repo: null, number: 14 }, { repo: null, number: 15 }], at: 1 }],
  });
  const strip = container.querySelector('[aria-label="Link candidates"]') as HTMLElement;
  assert.match(strip.textContent ?? "", /This terminal may belong to:/);
  const fifteen = button(strip, "#15")!;
  act(() => fifteen.click());
  assert.deepEqual(pins, [["a", "pull_request", { repo: null, number: 15 }]]);
});

const choice = (slot: LinkSlotName, number: number, label: string | null = null): LinkChoice => ({
  slot,
  ref: { repo: null, number },
  label,
});

const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

test("with nothing linked, Link to... lists guesses first, then search, and picking one pins it", () => {
  const { container, pins, loads } = render(null, (query) =>
    query ? [choice("pull_request", 12, "Searched")] : [choice("ticket", 637), choice("pull_request", 661, "Terminal link")],
  );
  const open = button(container, "Link to...")!;
  assert.equal(open.getAttribute("aria-expanded"), "false");
  act(() => open.click());
  assert.equal(open.getAttribute("aria-expanded"), "true");
  assert.deepEqual(loads, ["a"]);
  const list = document.getElementById(open.getAttribute("aria-controls")!) as HTMLElement;
  assert.deepEqual(
    [...list.querySelectorAll("button")].map((b) => b.textContent),
    ["Ticket #637", "Pull request #661 Terminal link"],
  );
  const search = container.querySelector('input[type="search"]') as HTMLInputElement;
  assert.equal(search.getAttribute("aria-label"), "Search tickets and pull requests");
  type(search, "12");
  const results = [...list.querySelectorAll("button")];
  assert.deepEqual(results.map((b) => b.textContent), ["Pull request #12 Searched"]);
  act(() => results[0].click());
  assert.deepEqual(pins, [["a", "pull_request", { repo: null, number: 12 }]]);
  assert.equal(open.getAttribute("aria-expanded"), "false");
});

test("Link to... shows only while nothing is linked", () => {
  const { container } = render(linked);
  assert.equal(button(container, "Link to..."), undefined);
});
