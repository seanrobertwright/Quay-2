// What the tests of asks share: the check of an ask, and the companion it is drawn in, worked as the
// operator would. The test owns what it mounts.
import "../../../test-support/dom.ts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CheckRequest } from "../surfaceTypes.ts";
import { companionPrefs } from "../../companion/companionPrefs.ts";
import { memoryStorage, terminalInfo } from "../../companion/fixtures/companionFixtures.ts";
import type { TerminalInfo } from "../../terminal/types.ts";
import { settle } from "./fakeRust.ts";

const { Companion, COMPANION_VIEWS } = await import("../../companion/Companion.tsx");

/** The check of a `quay_ask` call that is to be the surface `ask_1`. */
export const askCheck = (call: number, args: unknown): CheckRequest => ({ call, tool: "quay_ask", surface_id: "ask_1", arguments: args });

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

/** The button that folds and unfolds a terminal's locked surfaces, if there are any. */
export const earlierButton = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) => button.textContent?.startsWith("Earlier"));

/** The line of the locked surface `id`, which opens it. Earlier is open. */
export const lockedLine = (container: HTMLElement, id: string) =>
  [...container.querySelectorAll<HTMLElement>("[data-locked]")].find((item) => item.dataset.locked === id)!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;

/** Opens Earlier, and the locked surface `id` in it. */
export async function openLocked(container: HTMLElement, id: string): Promise<void> {
  await act(async () => earlierButton(container)!.click());
  await act(async () => lockedLine(container, id).click());
}

/** Types `text` into a field as the operator would, so React hears it. */
export async function typeInto(field: HTMLTextAreaElement, text: string): Promise<void> {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
  await act(async () => void field.dispatchEvent(new Event("input", { bubbles: true })));
}
