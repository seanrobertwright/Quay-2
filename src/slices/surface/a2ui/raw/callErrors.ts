// What is wrong with a raw call, told by where it is in the call as its agent wrote it.
import type { EngineError } from "../../surfaceTypes.ts";

/** Where something is in a call, as the steps of a JSON Pointer. */
export type Place = readonly (string | number)[];

export const pointerTo = (place: Place): string => place.map((step) => `/${String(step).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");

type JsonObject = Record<string, unknown>;

export const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `key` is one of `value`'s own. */
export const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

/** The four messages a raw call may hold. */
const KINDS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

type Kind = (typeof KINDS)[number];

/** A message of one of the four kinds, and where its body is in the call. */
export interface Message {
  kind: Kind;
  body: unknown;
  /** The surface it is for. Empty when it names none. */
  surfaceId: string;
  place: Place;
  written: JsonObject;
}

/** The message `written` at `index` of a call, or null when it has more or less than a version and one of the four. */
export function messageAt(index: number, written: unknown): Message | null {
  if (!isObject(written)) return null;
  const [key, ...others] = Object.keys(written).filter((name) => name !== "version");
  const kind = KINDS.find((name) => name === key);
  if (!kind || others.length > 0) return null;
  const body = written[kind];
  const surfaceId = isObject(body) && typeof body.surfaceId === "string" ? body.surfaceId : "";
  return { kind, body, surfaceId, place: ["messages", index, kind], written };
}

/** An error of Quay's own at `place`, about `surfaceId` unless that is empty. */
export const invalid = (place: Place, message: string, surfaceId = ""): EngineError => ({
  code: "VALIDATION_FAILED",
  ...(surfaceId === "" ? {} : { surfaceId }),
  path: pointerTo(place),
  message,
});

/** The components a message defines, each with where it is. What is no component is left to the engine. */
export function componentsOf({ body, place }: Message): { component: JsonObject; at: Place }[] {
  const components: unknown = isObject(body) ? body.components : null;
  if (!Array.isArray(components)) return [];
  return components.flatMap((component: unknown, i) => (isObject(component) ? [{ component, at: [...place, "components", i] }] : []));
}
