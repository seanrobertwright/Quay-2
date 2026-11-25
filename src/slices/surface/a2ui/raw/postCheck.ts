// What a raw call is rejected for that the engine lets through: an effect that would run without a
// click, a strip surface that asks, and one that is larger than Quay draws.
import { hasOwn, isObject } from "../../json.ts";
import type { Accepted, CreateSurface, CheckError, SurfacePlace } from "../../surfaceTypes.ts";
import { hasEvent } from "../accepted.ts";
import { MOST_AT_ONCE, MOST_WITH_ROWS } from "../drawnLimits.ts";
import { FARTHEST, isPastAtOnce, isPastWithRows, type DrawnSize } from "../drawnSize.ts";
import { EFFECTS } from "../effects.ts";
import { DEEPEST_FILL } from "../workedOut.ts";
import { componentsOf, invalid, type Message, type Pointer } from "./callErrors.ts";

/** Mirrors `MOST_COMPONENTS`, which Rust holds every surface to. */
export const MOST_COMPONENTS = 500;

/** Mirrors `MOST_DATA`, which Rust holds every surface to, in bytes of JSON. */
export const MOST_DATA = 256 * 1024;

/** Mirrors `MOST_IMAGES`, which Rust holds every surface to. */
export const MOST_IMAGES = 12;

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

/** `size`, in bytes, as kB rounded up. */
export const inKb = (size: number): string => `${Math.ceil(size / 1024)} kB`;

const overLimit = ({ pointer, surfaceId }: Message, limit: string, has: string, also = "") => [
  invalid(pointer, `A surface has at most ${limit}; this one would have ${has}.${also}`, surfaceId),
];

/** What of `state`, of which `message` is told, is more than Quay takes, before anything is resolved of it. */
export function tooLarge({ createSurface }: CreateSurface, message: Message): CheckError[] {
  const { length } = createSurface.components;
  const bytes = new TextEncoder().encode(JSON.stringify(createSurface.dataModel)).length;
  return [
    ...(length > MOST_COMPONENTS ? overLimit(message, `${MOST_COMPONENTS} components`, String(length)) : []),
    ...(bytes > MOST_DATA ? overLimit(message, `${inKb(MOST_DATA)} of data`, inKb(bytes)) : []),
  ];
}

const toldCount = (count: number): string => (count < FARTHEST ? String(count) : `at least ${FARTHEST}`);

const UNBOUNDED = `formatString fills in a text that is written out or bound to the data, and that leads neither to itself nor through more than ${DEEPEST_FILL} others.`;

/**
 * What of a surface of this size, of which `message` is told, is more than Quay draws, before anything is resolved
 * of it. The engine has refused components that hold each other.
 */
export function drawsTooMuch(size: DrawnSize, message: Message): CheckError[] {
  const { atOnce, withRows, stopped, weighed } = size;
  if (stopped === "unbounded") return [invalid(message.pointer, UNBOUNDED, message.surfaceId)];
  const also = weighed.length > 0 ? ` Also counted: ${weighed.join(", ")}. See quay_surface_guide.` : "";
  return [
    ...(isPastAtOnce(size) ? overLimit(message, `${MOST_AT_ONCE} components drawn at once`, toldCount(atOnce), also) : []),
    ...(isPastWithRows(size) ? overLimit(message, `${MOST_WITH_ROWS} components with every row drawn`, stopped ? `more than ${MOST_WITH_ROWS}` : toldCount(withRows), also) : []),
  ];
}

/** What `accepted`, of which `message` is told, has more images than Quay takes. */
export const tooManyImages = ({ images }: Accepted, message: Message): CheckError[] => (images > MOST_IMAGES ? overLimit(message, `${MOST_IMAGES} images`, String(images)) : []);
