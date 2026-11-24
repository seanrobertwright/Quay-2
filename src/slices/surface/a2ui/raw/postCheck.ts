// What a raw call is rejected for that the engine lets through: an effect that would run without a
// click, a strip surface that asks, and one that is larger than Quay draws.
import { hasOwn, isObject } from "../../json.ts";
import type { Accepted, CreateSurface, CheckError, SurfacePlace } from "../../surfaceTypes.ts";
import { hasEvent } from "../accepted.ts";
import { EFFECTS } from "../effects.ts";
import { componentsOf, invalid, type Message, type Pointer } from "./callErrors.ts";

/** Mirrors `MOST_COMPONENTS`, which Rust holds every surface to. */
const MOST_COMPONENTS = 500;

/** Mirrors `MOST_DATA`, which Rust holds every surface to, in bytes of JSON. */
const MOST_DATA = 256 * 1024;

/** Mirrors `MOST_IMAGES`, which Rust holds every surface to. */
const MOST_IMAGES = 12;

const effects: ReadonlySet<unknown> = new Set(EFFECTS.map(({ name }) => name));

/** The calls of a function with an effect in `value`, each by its name and where it is. */
function effectCalls(value: unknown, pointer: Pointer): { name: string; at: Pointer }[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => effectCalls(item, [...pointer, i]));
  if (!isObject(value)) return [];
  const name = hasOwn(value, "@call") && effects.has(value["@call"]) ? [{ name: String(value["@call"]), at: pointer }] : [];
  return [...name, ...Object.entries(value).flatMap(([key, inner]) => effectCalls(inner, [...pointer, key]))];
}

/** Whether `steps`, from a component, lead to the call that a Button's action is. */
const isAction = (component: string, [first, second, ...rest]: Pointer) => component === "Button" && first === "action" && second === "functionCall" && rest.length === 0;

/** What is wrong with the components of `message`, which is for a surface in `place`. */
export function postCheck(message: Message, place: SurfacePlace): CheckError[] {
  return componentsOf(message).flatMap(({ component, at }) => {
    const type = String(component.component);
    const found = effectCalls(component, at)
      .filter((call) => !isAction(type, call.at.slice(at.length)))
      .map((call) => invalid(call.at, `${call.name} runs only as a Button's action.`, message.surfaceId));
    if (place === "strip" && hasEvent(component)) {
      found.push(invalid([...at, "action"], "A strip surface cannot send an action to its agent. Use place companion or tab.", message.surfaceId));
    }
    return found;
  });
}

const overLimit = ({ pointer, surfaceId }: Message, limit: string, has: string) => [invalid(pointer, `A surface has at most ${limit}; this one would have ${has}.`, surfaceId)];

/** What of `state`, of which `message` is told, is more than Quay takes, before anything is resolved of it. */
export function tooLarge({ createSurface }: CreateSurface, message: Message): CheckError[] {
  const { length } = createSurface.components;
  const bytes = new TextEncoder().encode(JSON.stringify(createSurface.dataModel)).length;
  const inKb = (size: number) => `${Math.ceil(size / 1024)} kB`;
  return [
    ...(length > MOST_COMPONENTS ? overLimit(message, `${MOST_COMPONENTS} components`, String(length)) : []),
    ...(bytes > MOST_DATA ? overLimit(message, `${inKb(MOST_DATA)} of data`, inKb(bytes)) : []),
  ];
}

/** What `accepted`, of which `message` is told, has more images than Quay takes. */
export const tooManyImages = ({ images }: Accepted, message: Message): CheckError[] => (images > MOST_IMAGES ? overLimit(message, `${MOST_IMAGES} images`, String(images)) : []);
