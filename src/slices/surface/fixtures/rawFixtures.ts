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

/** A container of these children, which may be named more than once. */
export const holds = (id: string, children: readonly string[]): Component => ({ id, component: "Column", children });

/** A container of one `child` for each item at `path`. */
export const listOf = (id: string, child: string, path: string, component = "Column"): Component => ({ id, component, children: { componentId: child, path } });

export const times = <T>(count: number, make: (i: number) => T): T[] => Array.from({ length: count }, (_, i) => make(i));

/** `count` items of data, each `row`. */
export const rows = (count: number, row: unknown = 0): unknown[] => times(count, () => row);

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

/** The verdict on a call that holds these messages, and creates a surface in `place` if one of them does. */
export const verdictOnCall = (messages: unknown, place: SurfacePlace = "companion"): Promise<Verdict> =>
  verdictOn({ call: verdicts().length + 1, tool: "quay_surface", surface_id: "plan", arguments: { messages, place, title: "Migration plan" } });

/** `verdictOnCall`, of a call that makes the one surface `plan` if it is accepted: what was made of that. */
export async function verdictOnRaw(messages: unknown, place?: SurfacePlace): Promise<Exclude<Verdict, { surfaces: unknown }>> {
  const verdict = await verdictOnCall(messages, place);
  if (!("surfaces" in verdict)) return verdict;
  assert.equal(verdict.surfaces.length, 1);
  return verdict.surfaces[0];
}

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
