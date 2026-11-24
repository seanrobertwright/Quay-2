// What the engine finds wrong with a message, told at where it is in the call.
import { hasOwn, isObject } from "../../json.ts";
import type { CheckError } from "../../surfaceTypes.ts";
import { catalog } from "../catalog.ts";
import { engineError } from "../engine.ts";
import { componentsOf, pathOf, type Message, type Pointer } from "./callErrors.ts";

const NO_MEDIA = "Quay plays no media. Link the file with FileLink.";

/** What to do without a basic component that Quay does not draw. */
const INSTEAD: Readonly<Record<string, string>> = {
  Modal: "Quay draws no modal. Put the content in the surface, or use place tab.",
  Video: NO_MEDIA,
  AudioPlayer: NO_MEDIA,
};

const names = (what: string, of: ReadonlyMap<string, unknown>) => ` The catalog's ${what} are ${[...of.keys()].sort().join(", ")}.`;

/** What `path`, a JSON Pointer, points to in `body`. */
function valueAt(body: unknown, path: string): unknown {
  let value = body;
  for (const step of path.split("/").slice(1)) {
    const key = step.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof value !== "object" || value === null || !hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** What the catalog has instead, when the engine's `path` in `body` is to a component or a call of a function that it has not. */
function whatThereIs(body: unknown, path: string): string {
  const value = valueAt(body, path);
  if (/^\/components\/\d+\/component$/.test(path) && typeof value === "string" && !catalog.components.has(value)) {
    const instead = hasOwn(INSTEAD, value) ? ` ${INSTEAD[value]}` : "";
    return names("components", catalog.components) + instead;
  }
  const called = isObject(value) ? value["@call"] : null;
  return typeof called === "string" && !called.startsWith("@") && !catalog.functions.has(called) ? names("functions", catalog.functions) : "";
}

/** The component the engine's `message` names, as `messages` define it last. Its words are held by the contract tests. */
function namedIn(message: string, messages: readonly Message[]): Pointer | null {
  const id = /component '([^']+)'/i.exec(message)?.[1];
  const defined = messages.flatMap(componentsOf).filter(({ component }) => component.id === id);
  return defined.length > 0 ? defined[defined.length - 1].at : null;
}

/**
 * What the engine threw at `message`, one of the `messages` that make a surface, or at the whole surface
 * when `message` is the create.
 */
export function engineErrorAt(thrown: unknown, message: Message, messages: readonly Message[]): CheckError {
  const { code, path, message: said } = engineError(thrown, message.surfaceId);
  // Of data it gives the path in the data model, which is nowhere in the call
  const inBody = code === "DATA_ERROR" || path === "/" ? undefined : path;
  const own = pathOf(message.pointer);
  const named = inBody === undefined ? namedIn(said, messages) : null;
  const there = inBody === undefined ? "" : whatThereIs(message.body, inBody);
  return {
    code,
    surfaceId: message.surfaceId,
    path: named ? pathOf(named) : own + (inBody ?? ""),
    message: there === "" ? said : said.replace(/\.?$/, `.${there}`),
  };
}
