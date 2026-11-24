// What differs between two states of a surface's data model.
import { hasOwn, isObject, pointerStep, type JsonObject } from "./json.ts";

/** By data path, values of a surface's data model. */
export type DataValues = Readonly<Record<string, unknown>>;

const isListOfObjects = (value: unknown): value is JsonObject[] => Array.isArray(value) && value.length > 0 && value.every(isObject);

const step = (path: string, key: string | number) => path + pointerStep(key);

/**
 * What of `now` differs from `accepted`, by data path: set in `accepted`, it makes `now`. Both are
 * JSON. A list of plain values is given whole, and so are an object that lost a key and a list whose
 * length changed, which no path under them says.
 */
export function differences(accepted: unknown, now: unknown): DataValues {
  const found = new Map<string, unknown>();
  const compare = (was: unknown, is: unknown, path: string) => {
    if (JSON.stringify(was) === JSON.stringify(is)) return;
    if (isObject(is) && (was === undefined || (isObject(was) && Object.keys(was).every((key) => hasOwn(is, key))))) {
      for (const key of Object.keys(is)) compare(was && hasOwn(was, key) ? was[key] : undefined, is[key], step(path, key));
    } else if (isListOfObjects(was) && isListOfObjects(is) && was.length === is.length) {
      is.forEach((item, i) => compare(was[i], item, step(path, i)));
    } else {
      found.set(path === "" ? "/" : path, is);
    }
  };
  compare(accepted, now, "");
  return Object.fromEntries(found);
}
