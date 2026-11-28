/// <reference types="node" />
// What a component test that draws a real terminal on the stage asks of it: waits on real time,
// since the terminal's own focus runs on its real timers, and probes for its parts.
import assert from "node:assert/strict";
import { act } from "react";

const { setTimeout: later } = globalThis;

/** Lets the page run for `ms` of real time: what was promised, its frames and its timers. */
export const wait = (ms: number) => act(async () => void (await new Promise((done) => later(done, ms))));

/** Waits out a terminal's timed focus, whose last try runs half a second after it was asked. */
export const settleFocus = () => wait(700);

/** Waits, for up to two seconds, until `holds`. */
export async function until(holds: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !holds(); i += 1) await wait(20);
  assert.ok(holds(), what);
}

/** The textarea that takes terminal `terminalId`'s keys, once it has drawn. */
export const terminalKeys = (container: HTMLElement, terminalId: string) =>
  container.querySelector<HTMLTextAreaElement>(`[data-pie-terminal="${terminalId}"] .xterm-helper-textarea`);

/** Whether terminal `terminalId`'s "Find in terminal..." bar is open. */
export const terminalSearchOpen = (container: HTMLElement, terminalId: string) =>
  container.querySelector(`[data-pie-terminal="${terminalId}"] input`) !== null;
