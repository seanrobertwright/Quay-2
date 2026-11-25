// The catalog's functions that cause something. The engine evaluates a function wherever it is called: as
// a value, inside a check or in another call's argument. So it runs none of these. A Button whose action
// is a call of one runs it itself, on the click.
import { z } from "zod";
import { OpenUrlApi } from "@a2ui/web_core/catalogs/basic/v1";
import { createFunctionImplementation, DynamicStringSchema } from "@a2ui/web_core/v1_0";
import type { Effect } from "../clickOnly.ts";
import { hasOwn, isObject, type JsonObject } from "../json.ts";
import type { SurfaceEffects } from "../links.ts";
import { FILE_FIELDS, namedFile } from "./namedFile.ts";
import { textOf } from "./textOf.ts";

/** What every function with an effect is to the engine. */
const ON_A_CLICK = { returnType: "void", allowedCallers: "rendererOnly", requiresUserActivation: true } as const;

const APIS = {
  openUrl: OpenUrlApi,
  showFile: {
    ...ON_A_CLICK,
    name: "showFile",
    description: "Shows a file in its folder, or its changes when it has uncommitted ones.",
    schema: z.object(FILE_FIELDS).strict(),
  },
  focusTerminal: {
    ...ON_A_CLICK,
    name: "focusTerminal",
    description: "Selects a terminal of the surface's own project.",
    schema: z.object({ terminal: DynamicStringSchema.describe("REF:#/$defs/DynamicString|The terminal's id, or its exact name.") }).strict(),
  },
  copyText: {
    ...ON_A_CLICK,
    name: "copyText",
    description: "Puts a text on the clipboard.",
    schema: z.object({ text: DynamicStringSchema.describe("REF:#/$defs/DynamicString|The text.") }).strict(),
  },
} as const satisfies Record<Effect, unknown>;

/** A function the engine refuses to run. */
const refused = <Api extends Parameters<typeof createFunctionImplementation>[0]>(api: Api) =>
  createFunctionImplementation(api, () => {
    throw new Error(`${api.name} runs only on the operator's click.`);
  });

export const EFFECTS = Object.values(APIS).map((api) => refused(api));

/** What each is at, of a call's arguments once they are evaluated. A text that is copied is no target. */
const TARGETS = {
  openUrl: ({ url }) => textOf(url),
  showFile: (args) => namedFile(args).path,
  focusTerminal: ({ terminal }) => textOf(terminal),
  copyText: () => null,
} as const satisfies Record<Effect, (args: JsonObject) => string | null>;

/** What `effect` is at, of `args`, which are evaluated, or null when it has no target. */
export const targetOf = (effect: Effect, args: JsonObject): string | null => TARGETS[effect](args);

/** What each causes, of a call's arguments once they are evaluated. */
const CAUSES: Record<Effect, (args: JsonObject, effects: SurfaceEffects) => void> = {
  openUrl: (args, effects) => effects.openUrl(TARGETS.openUrl(args)),
  showFile: (args, effects) => {
    const { path, line } = namedFile(args);
    effects.showFile(path, line);
  },
  focusTerminal: (args, effects) => effects.focusTerminal(TARGETS.focusTerminal(args)),
  copyText: ({ text }, effects) => effects.copyText(textOf(text)),
};

const isEffect = (name: unknown): name is Effect => typeof name === "string" && hasOwn(CAUSES, name);

/** A call of a function with an effect, with its arguments as they are written. */
export interface EffectCall {
  effect: Effect;
  args: unknown;
}

/** The call of an effect that a Button's `action` is, or null when it is none. */
export function effectCallOf(action: unknown): EffectCall | null {
  if (!isObject(action) || !hasOwn(action, "functionCall")) return null;
  const call = action.functionCall;
  const name = isObject(call) && hasOwn(call, "@call") ? call["@call"] : null;
  return isEffect(name) && isObject(call) ? { effect: name, args: call.args } : null;
}

/** Runs `effect` with `args`, which are evaluated. It throws unless the click that allows it is being handled. */
export const cause = (effect: Effect, args: JsonObject, effects: SurfaceEffects): void => CAUSES[effect](args, effects);
