/// <reference types="node" />
// Component tests for the companion column (#636): its width and divider, following the selected
// terminal, the Repository view, and the header's view switch.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalInfo } from "../terminal/types.ts";
import { companionPrefs, type PrefsStorage } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo as terminal } from "./fixtures/companionFixtures.ts";
import type { CompanionContext } from "./Companion.tsx";
import type { CompanionView } from "./companionViews.ts";

const { Companion, REPOSITORY_VIEW } = await import("./Companion.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
function unmount() {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
}
afterEach(unmount);

const projects = [
  { path: "E:/alpha", name: "Alpha", terminal_ids: [] },
  { path: "E:/beta", name: "Beta", terminal_ids: [] },
];
const worktrees = {
  "E:/alpha": [{ path: "E:/alpha", head: "a1", branch: "main", is_main: true, is_bare: false, is_locked: false }],
  "E:/beta": [{ path: "E:/beta", head: "b1", branch: "develop", is_main: true, is_bare: false, is_locked: false }],
};

interface Props {
  selected: TerminalInfo | null;
  storage?: PrefsStorage;
  views?: CompanionView<CompanionContext>[];
}
function render({ selected, storage = memoryStorage(), views = [REPOSITORY_VIEW] }: Props) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const element = (term: TerminalInfo | null) =>
    createElement(Companion, {
      selectedTerminal: term,
      projects,
      projectWorktrees: worktrees,
      views,
      prefs: companionPrefs(storage),
    });
  act(() => root.render(element(selected)));
  mounted = { root, container };
  const aside = container.querySelector("aside") as HTMLElement;
  const divider = container.querySelector('[role="separator"]') as HTMLElement;
  return { container, aside, divider, select: (term: TerminalInfo | null) => act(() => root.render(element(term))) };
}

test("the companion is a landmark 340 px wide by default", () => {
  const { aside } = render({ selected: null });
  assert.equal(aside.getAttribute("aria-label"), "Companion");
  assert.equal(getComputedStyle(aside).width, "340px");
});

const key = (el: HTMLElement, k: string, shiftKey = false) =>
  act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true })));

test("the divider is a focusable vertical splitter whose arrow keys resize the companion between 340 and 560 px", () => {
  const storage = memoryStorage();
  const { aside, divider } = render({ selected: null, storage });
  assert.equal(divider.tabIndex, 0);
  assert.equal(divider.getAttribute("aria-orientation"), "vertical");
  assert.equal(divider.getAttribute("aria-label"), "Resize the companion");
  assert.equal(divider.getAttribute("aria-valuemin"), "340");
  assert.equal(divider.getAttribute("aria-valuemax"), "560");
  assert.equal(divider.getAttribute("aria-valuenow"), "340");
  // The divider is on the companion's left edge, so ArrowLeft widens it.
  key(divider, "ArrowLeft");
  assert.equal(getComputedStyle(aside).width, "356px");
  key(divider, "ArrowRight");
  key(divider, "ArrowRight");
  assert.equal(getComputedStyle(aside).width, "340px");
  key(divider, "End");
  assert.equal(getComputedStyle(aside).width, "560px");
  assert.equal(divider.getAttribute("aria-valuenow"), "560");
  key(divider, "ArrowLeft");
  assert.equal(getComputedStyle(aside).width, "560px");
  key(divider, "Home");
  assert.equal(getComputedStyle(aside).width, "340px");
});

test("a width set with the divider is the companion's width the next time it opens", () => {
  const storage = memoryStorage();
  const first = render({ selected: null, storage });
  key(first.divider, "ArrowLeft", true);
  assert.equal(getComputedStyle(first.aside).width, "404px");
  unmount();
  const second = render({ selected: null, storage });
  assert.equal(getComputedStyle(second.aside).width, "404px");
});

test("the divider's hit area is several times as wide as the line it draws", () => {
  const { divider } = render({ selected: null });
  const line = divider.firstElementChild as HTMLElement;
  const hit = parseFloat(getComputedStyle(divider).width);
  const drawn = parseFloat(getComputedStyle(line).width);
  assert.ok(drawn >= 1, `drawn ${drawn}`);
  assert.ok(hit >= 3 * drawn, `hit ${hit} vs drawn ${drawn}`);
});

test("dragging the divider resizes the companion within 340 to 560 px and remembers where it stops", () => {
  const storage = memoryStorage();
  const { aside, divider } = render({ selected: null, storage });
  const PointerEvent = (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent;
  const pointer = (type: string, clientX: number) =>
    act(() => void divider.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX, bubbles: true } as MouseEventInit)));
  pointer("pointerdown", 1000);
  pointer("pointermove", 900);
  assert.equal(getComputedStyle(aside).width, "440px");
  pointer("pointermove", 100);
  assert.equal(getComputedStyle(aside).width, "560px");
  pointer("pointermove", 1200);
  assert.equal(getComputedStyle(aside).width, "340px");
  pointer("pointermove", 950);
  pointer("pointerup", 950);
  assert.equal(getComputedStyle(aside).width, "390px");
  assert.equal(companionPrefs(storage).readWidth(), 390);
});

const body = (container: HTMLElement) => container.querySelector('[data-companion-view]') as HTMLElement | null;

test("with no terminal selected the companion says so", () => {
  const { container } = render({ selected: null });
  assert.equal(body(container), null);
  assert.match(container.textContent ?? "", /Select a terminal/);
});

test("with no link the companion shows the Repository view for the selected terminal's repository", () => {
  const { container } = render({ selected: terminal("a", "E:/alpha") });
  const view = body(container);
  assert.equal(view?.dataset.companionView, "repository");
  assert.equal(view?.getAttribute("aria-label"), "Repository");
  assert.equal(view?.querySelector("h2")?.textContent, "Alpha");
  const facts = Object.fromEntries(
    [...(view?.querySelectorAll("dt") ?? [])].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
  );
  assert.deepEqual(facts, { Terminal: "term-a", Branch: "main", Folder: "E:/alpha" });
});

test("selecting another terminal changes what the companion shows, with no fetch", () => {
  const invoked: string[] = [];
  fakeInvoke((cmd) => {
    invoked.push(cmd);
    return Promise.resolve(null);
  });
  const { container, select } = render({ selected: terminal("a", "E:/alpha") });
  select(terminal("b", "E:/beta"));
  assert.deepEqual(invoked, []);
  const view = body(container);
  assert.equal(view?.querySelector("h2")?.textContent, "Beta");
  assert.match(view?.textContent ?? "", /develop/);
  select(null);
  assert.equal(body(container), null);
});

/** A stand-in for a later view, which only terminal "linked" has. */
const fakeView = (id: CompanionView<CompanionContext>["id"], label: string): CompanionView<CompanionContext> => ({
  id,
  label,
  available: ({ terminal }) => terminal.id === "linked",
  render: ({ terminal }) => createElement("p", null, `${label} for ${terminal.name}`),
});
const laterViews = [REPOSITORY_VIEW, fakeView("pull-request", "Pull request"), fakeView("ticket", "Ticket")];
const switchOf = (container: HTMLElement) => container.querySelector('header [role="radiogroup"]') as HTMLElement;
const radios = (container: HTMLElement) => [...switchOf(container).querySelectorAll('[role="radio"]')] as HTMLButtonElement[];

test("the header's view switch lists the views the selected terminal has, with the shown one checked", () => {
  const { container } = render({ selected: terminal("a", "E:/alpha") });
  assert.equal(switchOf(container).getAttribute("aria-label"), "Companion view");
  assert.deepEqual(radios(container).map((r) => [r.textContent, r.getAttribute("aria-checked")]), [["Repository", "true"]]);
});

test("the first view follows Companion opens on, Pull request by default, falling back to Repository", () => {
  const linked = terminal("linked", "E:/alpha");
  const byDefault = render({ selected: linked, views: laterViews });
  assert.equal(body(byDefault.container)?.dataset.companionView, "pull-request");
  byDefault.select(terminal("a", "E:/alpha"));
  assert.equal(body(byDefault.container)?.dataset.companionView, "repository");
  unmount();
  const ticketFirst = render({ selected: linked, views: laterViews, storage: memoryStorage({ quay_companion_opens_on: "ticket" }) });
  assert.equal(body(ticketFirst.container)?.dataset.companionView, "ticket");
});

test("picking a view on the switch shows it, and selecting another terminal starts again from the first view", () => {
  const { container, select } = render({ selected: terminal("linked", "E:/alpha"), views: laterViews });
  const ticket = radios(container).find((r) => r.textContent === "Ticket")!;
  act(() => ticket.click());
  assert.equal(body(container)?.dataset.companionView, "ticket");
  assert.equal(ticket.getAttribute("aria-checked"), "true");
  assert.match(body(container)?.textContent ?? "", /Ticket for term-linked/);
  select(terminal("a", "E:/beta"));
  assert.equal(body(container)?.dataset.companionView, "repository");
  select(terminal("linked", "E:/alpha"));
  assert.equal(body(container)?.dataset.companionView, "pull-request");
});

test("arrow keys move the view switch's choice, as a radio group does", () => {
  const { container } = render({ selected: terminal("linked", "E:/alpha"), views: laterViews });
  assert.deepEqual(radios(container).map((r) => r.textContent), ["Repository", "Pull request", "Ticket"]);
  assert.deepEqual(radios(container).map((r) => r.tabIndex), [-1, 0, -1]);
  key(radios(container)[1], "ArrowRight");
  assert.equal(body(container)?.dataset.companionView, "ticket");
  assert.equal(document.activeElement, radios(container)[2]);
  key(radios(container)[2], "ArrowRight");
  assert.equal(body(container)?.dataset.companionView, "repository");
  key(radios(container)[0], "ArrowLeft");
  assert.equal(body(container)?.dataset.companionView, "ticket");
});
