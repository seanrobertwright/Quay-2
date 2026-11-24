// What the tests of the catalog's components share: a raw surface that the check accepted, drawn in its
// frame as the Surface view does, and the operator's own acts on it.
import "../../../test-support/customElements.ts";
import { acceptedRaw, column, create, type Component } from "./rawFixtures.ts";
import { mount, unmount } from "./surfaceFixtures.ts";
import { calls, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fakeRust.ts";
import { terminalInfo } from "../../companion/fixtures/companionFixtures.ts";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import type { SurfaceRecord } from "../surfaceTypes.ts";

const { SurfaceView } = await import("../SurfaceView.tsx");

export type Data = Record<string, unknown>;

/** The terminal the surfaces are of. */
export const TERMINAL = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };

/** Starts a page with no surface, for a test. */
export async function startPage(): Promise<void> {
  startRust({ surface_list: () => [], surface_checks: () => [] });
  loadSurfaces();
  await settle();
}

export async function leavePage(): Promise<void> {
  await unmount();
  unloadSurfaces();
}

/** Draws `record` in its frame, and gives the box its agent's content is in. */
export async function drawRecord(record: SurfaceRecord): Promise<HTMLElement> {
  // The catalog's components are the surface's root, which the engine asks for, once they are drawn
  const container = await mount(createElement(SurfaceView, { terminal: TERMINAL, surfaces: [record] }));
  const content = () => container.querySelector<HTMLElement>("[data-surface-content]");
  await until(() => content() !== null && content()?.querySelector("a2ui-react-column") !== null, "the surface was never drawn");
  calls.length = 0;
  return content()!;
}

/** Draws a Column of `children`, which are among `components`, with `data` as its data model. */
export const drawTree = async (children: string[], components: Component[], data: Data = {}): Promise<HTMLElement> =>
  drawRecord(await acceptedRaw([create([{ id: "root", component: "Column", children }, ...components], { dataModel: data })]));

/** Draws a Column of `components`, in their order. */
export const drawAll = async (components: Component[], data: Data = {}): Promise<HTMLElement> =>
  drawRecord(await acceptedRaw([create(column(...components), { dataModel: data })]));

export const texts = (within: ParentNode, selector: string): (string | null)[] => [...within.querySelectorAll(selector)].map((el) => el.textContent);

export function one<E extends Element = HTMLElement>(within: ParentNode, selector: string): E {
  const found = within.querySelectorAll<E>(selector);
  assert.equal(found.length, 1, `${selector}: ${found.length}`);
  return found[0];
}

/** The texts that describe `element`, by its `aria-describedby`. */
export const describedBy = (element: Element): (string | undefined)[] =>
  (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? undefined);

/** What labels `input`, by a label that is for it. */
export const labelOf = (input: Element): string | null | undefined => document.querySelector(`label[for="${input.id}"]`)?.textContent;

export const buttonOf = (within: ParentNode, name: string): HTMLButtonElement => {
  const found = [...within.querySelectorAll("button")].find((button) => button.textContent === name);
  assert.ok(found !== undefined, `there is no button "${name}"`);
  return found;
};

export const click = (element: HTMLElement): Promise<void> => act(async () => element.click());

/** Puts `value` in a field as the operator does. */
export const put = (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
