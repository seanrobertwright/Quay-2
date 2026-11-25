// An effect a surface may cause runs only inside a click on the control that causes it.
import type { SurfaceEffects } from "./links.ts";

/** The effects a surface may cause. Mirrors `FiredFunction`. */
export type Effect = keyof SurfaceEffects;

/** Works out what an effect's target is with nothing in it that the operator typed. Null when that cannot be told. */
export type UntypedTarget = () => string | null;

/** The effect the click being handled allows, until it has run, and its target without what was typed. */
let allowed: { effect: Effect; untyped: UntypedTarget } | null = null;

/** Runs `run` as a click's handler, in which `effect` may run once. What runs later is outside it. */
export function duringClick<T>(effect: Effect, run: () => T, untyped: UntypedTarget = () => null): T {
  allowed = { effect, untyped };
  try {
    return run();
  } finally {
    allowed = null;
  }
}

/** Uses up the click that allows `effect`, and gives its target without what was typed. It throws when there is none, whatever called. */
export function spendClick(effect: Effect): UntypedTarget {
  if (allowed?.effect !== effect) throw new Error(`${effect} runs only on the operator's click.`);
  const { untyped } = allowed;
  allowed = null;
  return untyped;
}
