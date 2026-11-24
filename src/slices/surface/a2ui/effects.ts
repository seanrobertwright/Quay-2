// The catalog's functions that cause something. The engine evaluates a function wherever it is called,
// as a value or inside a check too, so each one needs the click that its Button allows it.
import { z } from "zod";
import { OpenUrlApi } from "@a2ui/web_core/catalogs/basic/v1";
import { createFunctionImplementation, DynamicNumberSchema, DynamicStringSchema } from "@a2ui/web_core/v1_0";
import type { Effect } from "../clickOnly.ts";
import type { SurfaceEffects } from "../links.ts";
import type { EngineSurface } from "./engine.ts";
import { lineOf } from "./line.ts";

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
  schema: z
    .object({
      path: DynamicStringSchema.describe("REF:#/$defs/DynamicString|The file, absolute or relative to the terminal's working directory."),
      line: DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber|A line of the file.").optional(),
    })
    .strict(),
} as const;

const showFile = createFunctionImplementation(ShowFileApi, ({ path, line }, { surface }) =>
  effectsIn(surface).showFile(typeof path === "string" ? path : "", lineOf(line)),
);

export const EFFECTS = [openUrl, showFile];

/** The effect a Button's `action` is a call of, or null when it is none. */
export function effectOf(action: unknown): Effect | null {
  if (typeof action !== "object" || action === null || !("functionCall" in action)) return null;
  const call = action.functionCall;
  const name = typeof call === "object" && call !== null && "@call" in call ? call["@call"] : null;
  return name === "openUrl" || name === "showFile" ? name : null;
}
