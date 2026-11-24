// An effect a surface may cause runs only inside a click on the control that causes it.
import type { SurfaceEffects } from "./links.ts";

/** The effects a surface may cause. */
export type Effect = keyof SurfaceEffects;

/** The effect the click being handled allows, until it has run. */
let allowed: Effect | null = null;

/** Runs `run` as a click's handler, in which `effect` may run once. What runs later is outside it. */
export function duringClick<T>(effect: Effect, run: () => T): T {
  allowed = effect;
  try {
    return run();
  } finally {
    allowed = null;
  }
}

/** Uses up the click that allows `effect`. It throws when there is none, whatever called. */
export function spendClick(effect: Effect): void {
  if (allowed !== effect) throw new Error(`${effect} runs only on the operator's click.`);
  allowed = null;
}
