// What the tests of raw surfaces share: the messages an agent writes, and the check of a call that holds
// them.
import assert from "node:assert/strict";
import type { CheckError, SurfacePlace, SurfaceRecord, Verdict } from "../surfaceTypes.ts";
import { verdicts, verdictOn } from "./fakeRust.ts";
import { surface } from "./surfaceFixtures.ts";

export type Component = Record<string, unknown>;

/** The message that creates the surface `plan` with these components. */
export const create = (components: unknown, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: "1.0",
  createSurface: { surfaceId: "plan", components, ...more },
});

/** A Column of these components, in their order. */
export const column = (...components: Component[]): Component[] => [{ id: "root", component: "Column", children: components.map(({ id }) => id) }, ...components];

export const text = (id: string, said: unknown): Component => ({ id, component: "Text", text: said });

/** A button that asks the agent for something, with the Text that names it. */
export const button = (id: string, action: unknown, more: Component = {}): Component[] => [
  { id, component: "Button", child: `${id}_label`, action, ...more },
  text(`${id}_label`, `Press ${id}`),
];

/** A Column of one button with `action`. */
export const oneButton = (action: unknown, more: Component = {}): Component[] => {
  const [first, label] = button("go", action, more);
  return [{ id: "root", component: "Column", children: ["go"] }, first, label];
};

/** An action that asks the agent for something. */
export const EVENT = { event: { name: "go", context: {} } };

/** The verdict on a call that holds these messages, and creates the surface `creates` in `place`, or none when that is empty. */
export const verdictOnRaw = (messages: unknown, place: SurfacePlace = "companion", creates = "plan"): Promise<Verdict> =>
  verdictOn({ call: verdicts().length + 1, tool: "quay_surface", surface_id: creates, arguments: { messages, place, title: "Migration plan" } });

/** What was found wrong with these messages. */
export async function errorsIn(messages: unknown, place?: SurfacePlace): Promise<CheckError[]> {
  const verdict = await verdictOnRaw(messages, place);
  assert.ok("errors" in verdict, JSON.stringify(verdict));
  return verdict.errors;
}

/** Each error's code, path and message. */
export const told = (errors: readonly CheckError[]) => errors.map(({ code, path, message }) => [code, path, message]);

/** The raw surface `plan` of terminal `t1`, as Rust holds it once the webview has accepted these messages. */
export async function acceptedRaw(messages: unknown, over: Partial<SurfaceRecord> = {}): Promise<SurfaceRecord> {
  const verdict = await verdictOnRaw(messages, over.place);
  assert.ok("state" in verdict, JSON.stringify(verdict));
  return surface("plan", { tool: "quay_surface", title: "Migration plan", state: verdict.state, asks: verdict.asks, ...over });
}
