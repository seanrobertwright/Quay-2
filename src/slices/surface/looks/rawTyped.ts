import type { DataValues } from "../differences.ts";
import { hasOwn, isObject } from "../json.ts";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import type { TypedText } from "./typedText.ts";

const isBinding = (value: unknown): value is { "@path": string } => isObject(value) && hasOwn(value, "@path");

/** The texts typed in a raw surface, of what is unsent in it: each by the label of the field that is bound to its data path, or else by that path. */
export function rawTypedIn(components: readonly SurfaceComponent[], unsent: DataValues): TypedText[] {
  return Object.entries(unsent).flatMap(([path, text]) => {
    if (typeof text !== "string" || text.trim() === "") return [];
    const field = components.find(({ value }) => isBinding(value) && `/${value["@path"].replace(/^\//, "")}` === path);
    return [{ part: path, question: typeof field?.label === "string" ? field.label : path, text }];
  });
}
