import type { DataValues } from "../differences.ts";
import { hasOwn, isObject } from "../json.ts";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import type { TypedText } from "./typedText.ts";

const isBinding = (value: unknown): value is { "@path": string } => isObject(value) && hasOwn(value, "@path") && typeof value["@path"] === "string";

/**
 * Whether a field bound to `written` may hold what is at `path`. A relative binding also holds it in each item
 * of a list the field is drawn for, at any depth: it is taken to, wherever an index comes before it.
 */
function mayHold(written: string, path: string): boolean {
  const absolute = `/${written.replace(/^\//, "")}`;
  if (absolute === path) return true;
  if (written.startsWith("/") || !path.endsWith(absolute)) return false;
  return /\/\d+$/.test(path.slice(0, -absolute.length));
}

/** The bindings of the obscured TextFields of `components`. */
const obscuredIn = (components: readonly SurfaceComponent[]): string[] =>
  components.flatMap(({ component, variant, value }) => (component === "TextField" && variant === "obscured" && isBinding(value) ? [value["@path"]] : []));

/**
 * The texts typed in a raw surface, of what is unsent in it: each by the label of the field that is bound to its
 * data path, or else by that path. What an obscured field may hold is left out, also where another field shares
 * its path.
 */
export function rawTypedIn(components: readonly SurfaceComponent[], unsent: DataValues): TypedText[] {
  const obscured = obscuredIn(components);
  return Object.entries(unsent).flatMap(([path, text]) => {
    if (typeof text !== "string" || text.trim() === "") return [];
    if (obscured.some((written) => mayHold(written, path))) return [];
    const field = components.find(({ value }) => isBinding(value) && `/${value["@path"].replace(/^\//, "")}` === path);
    return [{ part: path, question: typeof field?.label === "string" ? field.label : path, text }];
  });
}
