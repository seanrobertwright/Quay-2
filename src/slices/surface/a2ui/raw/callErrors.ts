// What is wrong with a raw call, told by where it is in the call as its agent wrote it.
import { isObject, pointerStep, type JsonObject } from "../../json.ts";
import type { CheckError } from "../../surfaceTypes.ts";

/** Where something is in a call, as the steps of a JSON Pointer. */
export type Pointer = readonly (string | number)[];

export const pathOf = (pointer: Pointer): string => pointer.map(pointerStep).join("");

/** The four messages a raw call may hold. */
const KINDS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

type Kind = (typeof KINDS)[number];

/** A message of one of the four kinds, and where its body is in the call. */
export interface Message {
  kind: Kind;
  body: unknown;
  /** The surface it is for. Empty when it names none. */
  surfaceId: string;
  pointer: Pointer;
  written: JsonObject;
}

/** The message `written` at `index` of a call, or null when, its version aside, it holds more or less than one of the four. */
export function messageAt(index: number, written: unknown): Message | null {
  if (!isObject(written)) return null;
  const [key, ...others] = Object.keys(written).filter((name) => name !== "version");
  const kind = KINDS.find((name) => name === key);
  if (!kind || others.length > 0) return null;
  const body = written[kind];
  const surfaceId = isObject(body) && typeof body.surfaceId === "string" ? body.surfaceId : "";
  return { kind, body, surfaceId, pointer: ["messages", index, kind], written };
}

/** An error of Quay's own at `pointer`, about `surfaceId` unless that is empty. */
export const invalid = (pointer: Pointer, message: string, surfaceId = ""): CheckError => ({
  code: "VALIDATION_FAILED",
  ...(surfaceId === "" ? {} : { surfaceId }),
  path: pathOf(pointer),
  message,
});

/** The components a message defines, each with where it is. What is no component is left to the engine. */
export function componentsOf({ body, pointer }: Message): { component: JsonObject; at: Pointer }[] {
  const components: unknown = isObject(body) ? body.components : null;
  if (!Array.isArray(components)) return [];
  return components.flatMap((component: unknown, i) => (isObject(component) ? [{ component, at: [...pointer, "components", i] }] : []));
}
