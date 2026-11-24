// The catalog's functions that cause something. The engine evaluates a function wherever it is called,
// as a value or inside a check too, so each one needs the click that its Button allows it.
import { z } from "zod";
import { OpenUrlApi } from "@a2ui/web_core/catalogs/basic/v1";
import { createFunctionImplementation } from "@a2ui/web_core/v1_0";
import type { Effect } from "../clickOnly.ts";
import type { SurfaceEffects } from "../links.ts";
import type { EngineSurface } from "./engine.ts";
import { FILE_FIELDS, namedFile } from "./namedFile.ts";

const given = new WeakMap<object, SurfaceEffects>();

/** Gives the functions called in `surface` what they cause. Without it they throw. */
export function giveEffects(surface: EngineSurface, effects: SurfaceEffects): void {
  given.set(surface, effects);
}

function effectsIn(surface: object | undefined): SurfaceEffects {
  const effects = surface && given.get(surface);
  if (!effects) throw new Error("No function of this surface causes anything.");
  return effects;
}

const openUrl = createFunctionImplementation(OpenUrlApi, ({ url }, { surface }) => effectsIn(surface).openUrl(String(url)));

const ShowFileApi = {
  name: "showFile",
  returnType: "void",
  allowedCallers: "rendererOnly",
  requiresUserActivation: true,
  description: "Shows a file in its folder, or its changes when it has uncommitted ones.",
  schema: z.object(FILE_FIELDS).strict(),
} as const;

const showFile = createFunctionImplementation(ShowFileApi, (args, { surface }) => {
  const { path, line } = namedFile(args);
  effectsIn(surface).showFile(path, line);
});

const BY_NAME = { openUrl, showFile } satisfies Record<Effect, unknown>;

export const EFFECTS = Object.values(BY_NAME);

const isEffect = (name: unknown): name is Effect => EFFECTS.some((effect) => effect.name === name);

/** The effect a Button's `action` is a call of, or null when it is none. */
export function effectOf(action: unknown): Effect | null {
  if (typeof action !== "object" || action === null || !("functionCall" in action)) return null;
  const call = action.functionCall;
  const name = typeof call === "object" && call !== null && "@call" in call ? call["@call"] : null;
  return isEffect(name) ? name : null;
}
