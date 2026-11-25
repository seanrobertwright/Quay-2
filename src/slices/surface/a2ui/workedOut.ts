// What the values of a component are worked out from, told before the engine works them out: the data they are
// bound to, the functions they call, and the texts that formatString fills in, which may be in the data too.
import { DataContext, ExpressionParser, type DataModel } from "@a2ui/web_core/v1_0";
import { isObject } from "../json.ts";
import { LINK } from "./drawnLimits.ts";
import { blockTokens, isTooLong } from "./markdown/parse.ts";

/** Thrown of a value for which no bound can be told: to work it out may take any time. */
export class Unbounded extends Error {}

/** How many texts in the data may fill in one another, each in the next. */
export const DEEPEST_FILL = 20;

/** The most characters that are read as Markdown to count tokens. Of the texts past it each character counts as one. */
const MOST_READ = 300_000;

/** A text with no match has too few tokens to count for a component. */
const MARKUP = /[[<]|\d[.)]\s|[\n*_`|~>+#-][^]*[\n*_`|~>+#-]/;

/** The text that a call of formatString fills in: written out, bound to data, or null where only another call tells it. */
type Template = { text: string } | { path: string } | null;

/** What values are worked out from. */
export interface Sources {
  /** The paths of the data they are bound to, also in texts that are written out. */
  paths: string[];
  /** How many calls of a function they make. */
  calls: number;
  /** The paths, among `paths`, of the texts that they fill in. */
  templates: string[];
  /** Whether they fill in a text that only a call tells. */
  untold: boolean;
}

/** What it takes to work values out. */
export interface Work {
  /** How many values of the data they are bound to, and how many calls they make. */
  steps: number;
  /** The characters of those data. */
  characters: number;
}

interface Parsed {
  parts: unknown[];
  sources: Sources;
}

const isText = (value: unknown): value is string => typeof value === "string";

export const isRelative = (path: string): boolean => !path.startsWith("/");

/** The path that `path` is at `at`, as the engine tells it. */
export const pathAt = (data: DataModel, at: string, path: string): string => new DataContext(data, at).resolvePath(path);

/** The path that `value` is bound to, or null. A message writes `@path`; the engine's parser of texts writes `path`, and nothing else with it. */
export function bindingOf(value: unknown): string | null {
  if (!isObject(value)) return null;
  const path = value["@path"] ?? (Object.keys(value).length === 1 ? value.path : null);
  return isText(path) ? path : null;
}

const isCall = (value: Record<string, unknown>): boolean => isText(value["@call"] ?? value.call);

/** The text that `value` fills in, or undefined if it is no call of formatString. */
function templateOf(value: Record<string, unknown>): Template | undefined {
  if ((value["@call"] ?? value.call) !== "formatString") return undefined;
  const text = isObject(value.args) ? value.args.value : null;
  if (isText(text)) return { text };
  const path = bindingOf(text);
  return path === null ? null : { path };
}

/** What a text that formatString fills in is made of. */
function partsOf(text: string): unknown[] {
  try {
    return new ExpressionParser().parse(text);
  } catch {
    // The engine draws nothing of one it cannot parse
    return [];
  }
}

function collect(value: unknown, into: Sources): void {
  if (Array.isArray(value)) for (const item of value) collect(item, into);
  if (!isObject(value)) return;
  const path = bindingOf(value);
  if (path !== null) {
    into.paths.push(path);
    return;
  }
  if (isCall(value)) into.calls += 1;
  const template = templateOf(value);
  if (template === undefined) for (const inner of Object.values(value)) collect(inner, into);
  else if (template === null) into.untold = true;
  else if ("text" in template) for (const part of partsOf(template.text)) collect(part, into);
  else {
    into.paths.push(template.path);
    into.templates.push(template.path);
  }
}

/** What `values` are worked out from. */
export function sourcesOf(values: readonly unknown[]): Sources {
  const sources: Sources = { paths: [], calls: 0, templates: [], untold: false };
  for (const value of values) collect(value, sources);
  return sources;
}

/** The calls of formatString in `value`. */
export function fillsIn(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(fillsIn);
  if (!isObject(value)) return [];
  return templateOf(value) === undefined ? Object.values(value).flatMap(fillsIn) : [value];
}

/** Whether what is worked out from `sources` may depend on the row it is in. A text in the data may be bound to its row. */
export const dependOnRow = ({ paths, templates }: Sources): boolean => templates.length > 0 || paths.some(isRelative);

/** Tells what values come to over `data`, which is to stay as it is meanwhile. */
export function workedOut(data: DataModel) {
  const lengths = new Map<object, number>();
  const parsed = new Map<string, Parsed>();
  const filled = new Map<string, Map<string, Work>>();
  const filling = new Set<string>();
  const tokens = new Map<string, number>();
  let read = 0;

  const valueAt = (at: string, path: string): unknown => data.get(pathAt(data, at, path));

  /** How many characters of data `value` is. */
  const charactersOf = (value: unknown): number => {
    if (isText(value)) return value.length;
    if (typeof value !== "object" || value === null) return 1;
    const kept = lengths.get(value);
    if (kept !== undefined) return kept;
    const keys = Array.isArray(value) ? 0 : Object.keys(value).reduce((sum, key) => sum + key.length, 0);
    const length = Object.values(value).reduce((sum: number, inner) => sum + charactersOf(inner), keys);
    lengths.set(value, length);
    return length;
  };

  const parse = (text: string): Parsed => {
    const kept = parsed.get(text);
    if (kept) return kept;
    const parts = partsOf(text);
    const found = { parts, sources: sourcesOf(parts) };
    parsed.set(text, found);
    return found;
  };

  /** What it takes to fill in `text`, which is in the data, at the data path `at`. Throws `Unbounded`. */
  const fillOf = (text: string, at: string): Work => {
    const kept = filled.get(text)?.get(at);
    if (kept) return kept;
    if (filling.has(text) || filling.size >= DEEPEST_FILL) throw new Unbounded();
    filling.add(text);
    const work = workOf(parse(text).sources, at);
    filling.delete(text);
    const known = filled.get(text);
    if (known) known.set(at, work);
    else filled.set(text, new Map([[at, work]]));
    return work;
  };

  /** What it takes, at the data path `at`, to work out what `sources` are of. Throws `Unbounded`. */
  const workOf = ({ paths, calls, templates, untold }: Sources, at: string): Work => {
    if (untold) throw new Unbounded();
    let steps = paths.length + calls;
    let characters = paths.reduce((sum, path) => sum + charactersOf(valueAt(at, path)), 0);
    for (const path of templates) {
      const text = valueAt(at, path);
      if (!isText(text)) continue;
      const work = fillOf(text, at);
      steps += work.steps;
      characters += work.characters;
    }
    return { steps, characters };
  };

  /**
   * The text that `value` comes to at the data path `at`. In place of what a call gives, other than one of
   * formatString, it has the texts of its arguments. It takes as many steps as `workOf` tells.
   */
  const textAt = (value: unknown, at: string): string => {
    if (isText(value)) return value;
    if (Array.isArray(value)) return value.map((item) => textAt(item, at)).join("\n");
    if (!isObject(value)) return "";
    const path = bindingOf(value);
    const bound = path === null ? null : valueAt(at, path);
    if (path !== null) return isText(bound) ? bound : "";
    const template = templateOf(value);
    if (!template) return textAt(Object.values(isObject(value.args) ? value.args : {}), at);
    const text = "text" in template ? template.text : valueAt(at, template.path);
    return isText(text) ? parse(text).parts.map((part) => textAt(part, at)).join("") : "";
  };

  /** How many tokens `text` has as Markdown, with what its links count for more. One that is drawn as it is written has none. */
  const tokensIn = (text: string): number => {
    if (!MARKUP.test(text) || isTooLong(text)) return 0;
    const kept = tokens.get(text);
    if (kept !== undefined) return kept;
    read += text.length;
    let count = text.length;
    if (read <= MOST_READ) {
      count = 0;
      for (const { type, nesting } of blockTokens(text) ?? []) count += (nesting === -1 ? 0 : 1) + (type === "link_open" ? LINK : 0);
    }
    tokens.set(text, count);
    return count;
  };

  return { valueAt, charactersOf, workOf, textAt, tokensIn };
}
