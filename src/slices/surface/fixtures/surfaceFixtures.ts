// What the tests of asking surfaces share: the surfaces Rust sends, and something to draw in.
import { emitEvent } from "../../../test-support/dom.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SurfaceRecord } from "../surfaceTypes.ts";

let change = 0;

/** The surface `id`, of terminal `t1` unless `over` says another, as Rust holds it. One made later has a higher order and change. */
export function surface(id: string, over: Partial<SurfaceRecord> = {}): SurfaceRecord {
  change += 1;
  const text = { id: "root", component: "Text", text: `What ${id} says` };
  const state: SurfaceRecord["state"] = { version: "1.0", createSurface: { surfaceId: id, catalogId: "urn:quay:a2ui:catalog:v1", components: [text], dataModel: {} } };
  return { terminal_id: "t1", id, tool: "quay_ask", place: "companion", state, revision: 1, order: change, change, asks: true, shown_at: Date.now(), answer: null, answered_at: null, ended_at: null, board: null, ...over };
}

/** `record` changed by `over`, as Rust holds it after. */
export const changed = (record: SurfaceRecord, over: Partial<SurfaceRecord>): SurfaceRecord => ({ ...record, change: (change += 1), ...over });

/** Lets what is under way finish: promises and what they draw. */
export const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 10))));

/** Sends `event` from Rust and draws what comes of it. */
export async function emit(event: string, payload: unknown): Promise<void> {
  await act(async () => emitEvent(event, payload));
  await settle();
}
export const arrives = (record: SurfaceRecord) => emit("surface-changed", record);
export const answered = (record: SurfaceRecord) => arrives(changed(record, { answer: { answers: [] }, answered_at: 1 }));
export const removed = ({ terminal_id, id }: SurfaceRecord) => emit("surface-removed", { terminal_id, id });

type Drawn = Parameters<Root["render"]>[0];

let mounted: { root: Root; container: HTMLElement } | null = null;

/** Draws `element` in the page, until `unmount`. */
export async function mount(element: Drawn): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted = { root: createRoot(container), container };
  await redraw(element);
  return container;
}

/** Draws `element` where `mount` drew. */
export async function redraw(element: Drawn): Promise<void> {
  await act(async () => mounted!.root.render(element));
  await settle();
}

/** Takes what `mount` drew out of the page, if it drew. */
export async function unmount(): Promise<void> {
  if (!mounted) return;
  const { root, container } = mounted;
  await act(async () => root.unmount());
  container.remove();
  mounted = null;
}
