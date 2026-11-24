// What the tests of asks share: waiting, the record Rust makes of an accepted ask, and the companion
// it is drawn in, worked as the operator would. The test owns what it mounts.
import "../../../test-support/dom.ts";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CheckRequest, SurfaceRecord } from "../surfaceTypes.ts";
import { companionPrefs } from "../../companion/companionPrefs.ts";
import { memoryStorage, terminalInfo } from "../../companion/fixtures/companionFixtures.ts";
import type { TerminalInfo } from "../../terminal/types.ts";

const { Companion, COMPANION_VIEWS } = await import("../../companion/Companion.tsx");

/** Lets what is under way finish: promises, the A2UI module's import and what they draw. */
export const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));

/** Waits, for up to two seconds, until `holds`. */
export async function until(holds: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !holds(); i += 1) await settle();
  assert.ok(holds(), what);
}

/** The check of a `quay_ask` call that is to be the surface `ask_1`. */
export const askCheck = (call: number, args: unknown): CheckRequest => ({ call, tool: "quay_ask", surface_id: "ask_1", arguments: args });

/** An ask as Rust holds it once the webview has accepted it with `state`, before any answer. */
export const askRecord = (state: SurfaceRecord["state"], { id = "ask_1", terminal = "t1", order = 1 } = {}): SurfaceRecord => ({
  terminal_id: terminal,
  id,
  tool: "quay_ask",
  state,
  revision: 1,
  order,
  change: order,
  asks: true,
  shown_at: Date.now(),
  answer: null,
  answered_at: null,
});

/** The terminal that asks, unless a test says otherwise. */
export const TERMINAL: TerminalInfo = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };

/** The companion with `terminal` selected. */
export function companion(terminal: TerminalInfo) {
  const props = { projects: [], projectWorktrees: {}, views: COMPANION_VIEWS, prefs: companionPrefs(memoryStorage()) };
  return createElement(Companion, { ...props, selectedTerminal: terminal });
}

export interface Mounted {
  root: Root;
  container: HTMLElement;
}

/** The companion, drawn with `terminal` selected. */
export async function mountCompanion(terminal: TerminalInfo): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(companion(terminal)));
  await settle();
  return { root, container };
}

/** Takes what `mountCompanion` drew off the page. */
export async function unmount({ root, container }: Mounted): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

/** What shows the companion view `name`, if the companion has it. */
export const viewEntry = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLElement>('[aria-label="Companion view"] [role="radio"]')].find((entry) => entry.textContent === name);

/** The button named `name`, if there is one. */
export const findButton = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === name);

/** Types `text` into a field as the operator would, so React hears it. */
export async function typeInto(field: HTMLTextAreaElement, text: string): Promise<void> {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
  await act(async () => void field.dispatchEvent(new Event("input", { bubbles: true })));
}
