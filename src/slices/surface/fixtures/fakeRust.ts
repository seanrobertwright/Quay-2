// Rust as the surface tests have it, by faking Tauri's `invoke`: what it was told, and the surfaces it
// holds once the webview has accepted them.
import { emitEvent, fakeInvoke } from "../../../test-support/dom.ts";
import assert from "node:assert/strict";
import { act } from "react";
import type { CheckRequest, SurfaceRecord, Verdict } from "../surfaceTypes.ts";

const { startSurfaces } = await import("../surfaceHost.ts");

/** What each command does with its arguments. One that is not here returns null. */
type Commands = Record<string, (args: Record<string, unknown>) => unknown>;

/** Nothing is unsent in any surface, unless a test says otherwise. */
const NOTHING_UNSENT: Commands = { surface_open_page: () => ({ page: 1, unsent: [] }) };

/** Every command the webview called since `startRust`, in order. */
export const calls: { cmd: string; args: Record<string, unknown> }[] = [];
export const called = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

let commands: Commands = {};
let stop: (() => void) | null = null;

/** Starts Rust again for a test, with what its commands do. */
export function startRust(does: Commands): void {
  calls.length = 0;
  commands = { ...NOTHING_UNSENT, ...does };
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    return commands[cmd]?.(args) ?? null;
  });
}

/** Loads the page's surfaces, as a page that loads again does when they were loaded. */
export function loadSurfaces(): void {
  unloadSurfaces();
  stop = startSurfaces();
}

export function unloadSurfaces(): void {
  stop?.();
  stop = null;
}

// Node's own, so a test that mocks the timers can still wait for what is under way
const { setTimeout: later } = globalThis;

/** Lets what is under way finish: promises, the A2UI module's import and what they draw. */
export const settle = () => act(async () => void (await new Promise((resolve) => later(resolve, 20))));

/** Waits, for up to two seconds, until `holds`. */
export async function until(holds: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !holds(); i += 1) await settle();
  assert.ok(holds(), what);
}

/** The verdicts the webview gave, by call. */
export const verdicts = () => called("surface_verdict") as unknown as { call: number; verdict: Verdict }[];

/** The verdict on `request`, from a webview that has loaded. */
export async function verdictOn(request: CheckRequest): Promise<Verdict> {
  if (!stop) loadSurfaces();
  await settle();
  emitEvent("surface-check", request);
  await until(() => verdicts().some((v) => v.call === request.call), "no verdict was given");
  return verdicts().find((v) => v.call === request.call)!.verdict;
}

/** The question `id` of `terminal`, as Rust holds it once the webview has accepted `ask`. */
export async function acceptedAsk(id: string, ask: unknown, terminal = "t1", order = 1): Promise<SurfaceRecord> {
  const verdict = await verdictOn({ call: verdicts().length + 1, tool: "quay_ask", surface_id: id, arguments: ask });
  assert.ok("state" in verdict, JSON.stringify(verdict));
  return { terminal_id: terminal, id, tool: "quay_ask", state: verdict.state, revision: 1, order, change: order, asks: true, shown_at: Date.now(), answer: null, answered_at: null };
}
