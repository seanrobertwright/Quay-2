// The check of a raw call: a pre-pass of each message, the engine's own check of each surface's messages
// in order on a scratch copy, whether the surfaces they make are whole, and a post-check of what the engine
// lets through.
import { isObject } from "../../json.ts";
import type { AcceptedSurface, CheckError, CreateSurface, HeldSurface, SurfacePlace, Verdict } from "../../surfaceTypes.ts";
import { acceptedSurface, compact } from "../accepted.ts";
import { CATALOG_ID } from "../catalog.ts";
import { engineFor, scratchEngine } from "../engine.ts";
import { invalid, type Message } from "./callErrors.ts";
import { engineErrorAt } from "./engineErrors.ts";
import { postCheck, tooLarge, tooManyImages } from "./postCheck.ts";
import { prePass } from "./prePass.ts";

/** A raw call. Rust has checked `place`, unless it rejects the call, and that `messages` is a list. One that creates no surface needs no `place`. */
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

type CheckedMessage = Checked & { message: Message };

/** A surface that a call makes. */
interface Made {
  state: CreateSurface;
  /** The messages that make it: from its create on, if the call creates it. */
  messages: readonly Message[];
  /** The message that is told what is wrong with the whole of it. */
  toldAt: Message;
}

/**
 * Runs one surface's messages in order, on a scratch copy of the surface that is `held` if one is, adding
 * what is found wrong. `create` is the call's one create, of a surface in `place`. Returns what they make, or
 * null when the surface is gone by them or anything is wrong with them. Which ids they may name is Rust's to
 * tell, so a message that would find no surface, or another one, is not run.
 */
function run(its: readonly CheckedMessage[], held: HeldSurface | undefined, create: Message | undefined, place: SurfacePlace): Made | null {
  const scratch = scratchEngine();
  const all = its.map(({ message }) => message);
  try {
    if (held) scratch.run(held.state);
    let isThere = held !== undefined;
    let inPlace = held?.place;
    let made: Message[] = [];
    for (const { message, errors } of its) {
      const isCreate = message.kind === "createSurface";
      const isDelete = message.kind === "deleteSurface";
      if (isCreate || isDelete) made = [];
      if (isCreate) inPlace = place;
      const runs = isCreate ? message === create && !isThere : isDelete || isThere;
      if (runs && errors.length === 0) {
        try {
          scratch.run(forEngine(message));
          const surface = scratch.surface(message.surfaceId);
          isThere = surface !== undefined;
          if (surface && !isObject(surface.dataModel.get("/"))) {
            errors.push(invalid([...message.pointer, "value"], "A surface's data model is an object.", message.surfaceId));
          }
        } catch (error) {
          errors.push(engineErrorAt(error, message, all));
        }
      }
      errors.push(...postCheck(message, inPlace ?? "companion"));
      if (!isDelete) made.push(message);
    }
    const surface = its.every(({ errors }) => errors.length === 0) ? scratch.surface(all[0].surfaceId) : undefined;
    if (!surface) return null;
    const [first] = made;
    return { state: compact(surface), messages: made, toldAt: first.kind === "createSurface" ? first : made[made.length - 1] };
  } finally {
    scratch.dispose();
  }
}

/** What a call makes of a surface, or what is wrong with the whole of it. */
function whole({ state, messages, toldAt }: Made): AcceptedSurface | CheckError[] {
  const large = tooLarge(state, toldAt);
  if (large.length > 0) return large;
  try {
    // The engine asks only a surface with a component whether it has a root
    if (state.createSurface.components.length === 0) return [{ ...invalid(toldAt.pointer, "Missing root component: No component has id='root'", toldAt.surfaceId), code: "INTEGRITY_ERROR" }];
    const { surface, dispose } = engineFor(state);
    try {
      const accepted = acceptedSurface(surface, state);
      const many = tooManyImages(accepted, toldAt);
      return many.length > 0 ? many : { surface_id: toldAt.surfaceId, ...accepted };
    } finally {
      dispose();
    }
  } catch (error) {
    return [engineErrorAt(error, toldAt, messages)];
  }
}

/** The verdict on a raw call, which updates the surfaces that are `held`. */
export function checkRaw(args: unknown, held: readonly HeldSurface[]): Verdict {
  const { messages, place } = args as RawCall;
  const checked = messages.map((written, i): Checked => {
    const { message, errors } = prePass(written, i);
    return { message, errors: [...errors] };
  });
  const bySurface = new Map<string, CheckedMessage[]>();
  for (const { message, errors } of checked) {
    if (!message) continue;
    const its = bySurface.get(message.surfaceId);
    if (its) its.push({ message, errors });
    else bySurface.set(message.surfaceId, [{ message, errors }]);
  }
  const create = checked.find(({ message }) => message?.kind === "createSurface")?.message ?? undefined;
  const made = [...bySurface].flatMap(([id, its]) => run(its, held.find(({ state }) => state.createSurface.surfaceId === id), create, place) ?? []);
  const errors = checked.flatMap((one) => one.errors);
  if (errors.length > 0) return rejected(errors);
  const surfaces = made.map(whole);
  const broken = surfaces.flatMap((surface) => (Array.isArray(surface) ? surface : []));
  return broken.length > 0 ? rejected(broken) : { surfaces: surfaces.flatMap((surface) => (Array.isArray(surface) ? [] : [surface])) };
}
