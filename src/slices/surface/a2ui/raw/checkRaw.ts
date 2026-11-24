// The check of a raw call: a pre-pass of each message, the engine's own check of the messages in order
// on a scratch copy, whether the surface they make is whole, and a post-check of what the engine lets
// through.
import { isObject } from "../../json.ts";
import type { CreateSurface, CheckError, SurfacePlace, Verdict } from "../../surfaceTypes.ts";
import { acceptedVerdict, compact } from "../accepted.ts";
import { CATALOG_ID } from "../catalog.ts";
import { engineFor, scratchEngine } from "../engine.ts";
import { invalid, type Message } from "./callErrors.ts";
import { engineErrorAt } from "./engineErrors.ts";
import { postCheck, tooLarge, withFewImages } from "./postCheck.ts";
import { prePass } from "./prePass.ts";

/** A raw call. Rust has checked `place`, unless it rejects the call, and that `messages` is a list. */
interface RawCall {
  messages: readonly unknown[];
  place: SurfacePlace;
}

/** The most errors a verdict lists. Mirrors `MOST_LISTED`: Rust lists no more. */
const MOST_LISTED = 10;

const rejected = (errors: readonly CheckError[]): Verdict => ({ errors: errors.slice(0, MOST_LISTED), more: Math.max(0, errors.length - MOST_LISTED) });

/** A message of the call with what has been found wrong with it. */
interface Checked {
  message: Message | null;
  errors: CheckError[];
}

/** `message` as the engine is given it, with the catalog's id filled in. */
const forEngine = ({ kind, written, body }: Message): object =>
  kind === "createSurface" && isObject(body) ? { ...written, createSurface: { ...body, catalogId: CATALOG_ID } } : written;

/** The call's messages that make the surface `surfaceId`: its first create, and the updates after it. */
function making(checked: readonly Checked[], surfaceId: string): (Checked & { message: Message })[] {
  const its = checked.flatMap(({ message, errors }) => (message?.surfaceId === surfaceId ? [{ message, errors }] : []));
  const first = its.findIndex(({ message }) => message.kind === "createSurface");
  if (first < 0) return [];
  return [its[first], ...its.slice(first + 1).filter(({ message }) => message.kind.startsWith("update"))];
}

/** Runs the messages that make a surface, adding what the engine finds. Returns the state they make, or null when anything was wrong. */
function run(messages: readonly (Checked & { message: Message })[]): CreateSurface | null {
  const scratch = scratchEngine();
  const all = messages.map((one) => one.message);
  try {
    for (const { message, errors } of messages) {
      if (errors.length === 0) {
        try {
          scratch.run(forEngine(message));
          const surface = scratch.surface(message.surfaceId);
          if (surface && !isObject(surface.dataModel.get("/"))) {
            errors.push(invalid([...message.pointer, "value"], "A surface's data model is an object.", message.surfaceId));
          }
        } catch (error) {
          errors.push(engineErrorAt(error, message, all));
        }
      }
      // What follows could only say that there is no surface
      if (message.kind === "createSurface" && errors.length > 0) return null;
    }
    const surface = messages.every(({ errors }) => errors.length === 0) ? scratch.surface(messages[0].message.surfaceId) : null;
    return surface ? compact(surface) : null;
  } finally {
    scratch.dispose();
  }
}

/** Adds what the engine finds wrong with a delete. A scratch copy has no surface it could be of. */
function checkDeletes(checked: readonly Checked[]): void {
  const scratch = scratchEngine();
  try {
    for (const { message, errors } of checked) {
      if (message?.kind !== "deleteSurface" || errors.length > 0) continue;
      try {
        scratch.run(forEngine(message));
      } catch (error) {
        errors.push(engineErrorAt(error, message, []));
      }
    }
  } finally {
    scratch.dispose();
  }
}

/** The verdict on the surface that `messages` make, whose state is `state`. */
function whole(state: CreateSurface, messages: readonly Message[]): Verdict {
  const [create] = messages;
  const large = tooLarge(state, create);
  if (large.length > 0) return rejected(large);
  try {
    // The engine asks only a surface with a component whether it has a root
    if (state.createSurface.components.length === 0) return rejected([{ ...invalid(create.pointer, "Missing root component: No component has id='root'", create.surfaceId), code: "INTEGRITY_ERROR" }]);
    const { surface, dispose } = engineFor(state);
    try {
      return withFewImages(acceptedVerdict(surface, state), create);
    } finally {
      dispose();
    }
  } catch (error) {
    return rejected([engineErrorAt(error, create, messages)]);
  }
}

/** The verdict on a raw call that creates the surface `surfaceId`, or none when that is empty. */
export function checkRaw(args: unknown, surfaceId: string): Verdict {
  const { messages, place } = args as RawCall;
  const checked = messages.map((written, i): Checked => {
    const { message, errors } = prePass(written, i);
    return { message, errors: [...errors] };
  });
  checkDeletes(checked);
  const its = making(checked, surfaceId);
  const state = its.length > 0 ? run(its) : null;
  for (const { message, errors } of its) errors.push(...postCheck(message, place));
  const errors = checked.flatMap((one) => one.errors);
  return state && errors.length === 0 ? whole(state, its.map(({ message }) => message)) : rejected(errors);
}
