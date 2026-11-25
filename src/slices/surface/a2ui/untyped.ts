// What the components of a surface come to with nothing in it that the operator typed, which is all the
// surface record may have of a target.
import { createContext, useContext } from "react";
import { DataContext, type ComponentContext } from "@a2ui/web_core/v1_0";
import { differences, type DataValues } from "../differences.ts";
import { isObject, type JsonObject } from "../json.ts";
import type { CreateSurface } from "../surfaceTypes.ts";
import { engineFor } from "./engine.ts";

/** Evaluates `written`, properties of a component at `at`, in what its surface is with nothing typed. */
export type Untyped = (at: DataContext, written: JsonObject) => JsonObject;

/** `Untyped`, of the surface that is drawn, or null where none is. */
export const UntypedContext = createContext<Untyped | null>(null);

/** Evaluates properties of the component of `context` as they are with nothing typed, or gives null where no surface is drawn. */
export function useUntyped({ dataContext }: ComponentContext): (written: unknown) => JsonObject | null {
  const untyped = useContext(UntypedContext);
  return (written) => untyped && untyped(dataContext, isObject(written) ? written : {});
}

/** The values of the options that the ChoicePickers of `state` have, which are always written out. */
function optionsIn({ createSurface: { components } }: CreateSurface): Set<unknown> {
  const pickers = components.filter(({ component }) => component === "ChoicePicker");
  const options = pickers.flatMap(({ options: its }) => (Array.isArray(its) ? its : []));
  return new Set(options.map((option) => isObject(option) && option.value));
}

/**
 * What of `now` the operator picked in a surface accepted as `state`, by data path: a switch, an amount, or
 * options its agent wrote. A text in the data may be typed, so it is none.
 */
function picked(state: CreateSurface, now: unknown): DataValues {
  const options = optionsIn(state);
  const isPick = (value: unknown) =>
    typeof value === "boolean" || typeof value === "number" || (Array.isArray(value) && value.every((option) => typeof option === "string" && options.has(option)));
  return Object.fromEntries(Object.entries(differences(state.createSurface.dataModel, now)).filter(([, value]) => isPick(value)));
}

/** `Untyped`, of a surface accepted as `state` whose data model now holds `now`. */
export function untypedIn(state: CreateSurface, now: unknown, at: DataContext, written: JsonObject): JsonObject {
  const { surface, dispose } = engineFor(state);
  try {
    for (const [path, value] of Object.entries(picked(state, now))) surface.dataModel.set(path, value, true);
    const there = new DataContext(surface, at.path, at.getIndex());
    return Object.fromEntries(Object.entries(written).map(([name, value]) => [name, there.resolveDynamicValue<unknown>(value)]));
  } finally {
    dispose();
  }
}
