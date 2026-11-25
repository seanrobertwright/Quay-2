// How much of a surface is drawn, counted from its components and its data before anything resolves them.
// The engine resolves every row of every list, also those that are not drawn yet, so what there is with every
// row has a limit of its own. The drawn tree is not walked: a component is counted once, or once for each
// row where what it draws depends on the row, and the count stops once those are past the limit.
import { DataContext, ExpressionParser, MAX_DYNAMIC_CHILD_LIST_SIZE, type DataModel } from "@a2ui/web_core/v1_0";
import { PAGE } from "../../parts/usePaged.tsx";
import { hasOwn, isObject } from "../json.ts";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import { catalog } from "./catalog.ts";

/** The most components drawn at once. Mirrors `MOST_AT_ONCE`, which Rust holds every surface to. */
export const MOST_AT_ONCE = 2000;

/** The most components with every row drawn. Mirrors `MOST_WITH_ROWS`, which Rust holds every surface to. */
export const MOST_WITH_ROWS = 10_000;

/** A count goes no further than this, so that it stays a number that can be told. */
export const FARTHEST = 1_000_000_000;

// What takes about as long as one more component does, as #765 measured it.
/** Characters of text to draw. */
const TEXT = 250;
/** Characters of JSON that a component is written in. */
const WRITTEN = 1000;
/** Values of the data that a component is bound to. */
const BOUND = 4;
/** Characters of an id or a path that the engine names every component under it by. */
const NAME = 100;
/** Characters of the data that a container tells a page of its rows apart by. */
const ROW_DATA = 10_000;

const per = (unit: number, count: number): number => Math.floor(count / unit);

/** How many components are drawn. One that takes long to draw counts as more. */
interface Size {
  /** At least as many as are drawn at once: when the surface is first drawn, or by one press of what shows more. */
  atOnce: number;
  /** With every row. */
  withRows: number;
}

export interface DrawnSize extends Size {
  /** Whether the count stopped early. There are then more than `withRows`, and `atOnce` is not counted. */
  stopped: boolean;
}

/** Whether a surface that draws `size` is past the limit. */
export const isPast = ({ atOnce, withRows }: DrawnSize): boolean => atOnce > MOST_AT_ONCE || withRows > MOST_WITH_ROWS;

/** A component drawn once for each item of the list at `path`. */
interface Template {
  id: string;
  path: string;
  /** What each component of a row counts for more, as the engine names it by `path`. */
  name: number;
}

/** What is told of a component by how it is written. */
interface Shape {
  /** Lists of the components it holds, each drawn together. */
  lists: string[][];
  templates: Template[];
  /** Components it holds of which one is drawn at a time. */
  choices: string[];
  /** What it draws besides, all of it at once. */
  parts: number;
  /** A list that it draws itself as a container does: how long it is, or the path of it. */
  own: number | string;
  /** The paths of the data it draws. */
  bound: string[];
  /** The characters of its own text, and of its JSON, when they count. */
  text: number;
  written: number;
  /** What each component under it counts for more, as the engine names it by its id. */
  name: number;
}

/** Ends a count that is past the limit. */
class Stopped extends Error {}

const ONE: Size = { atOnce: 1, withRows: 1 };

/** The property of a component that lists what it draws itself, besides the components it holds. */
const OWN: Readonly<Record<string, string>> = { ChoicePicker: "options", Steps: "steps" };

/** Properties that are not drawn. An action is evaluated at the click. */
const NOT_DRAWN: ReadonlySet<string> = new Set(["id", "component", "action"]);

const isText = (value: unknown): value is string => typeof value === "string";

const isRelative = (path: string): boolean => !path.startsWith("/");

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** The path that `path` is at `at`, as the engine tells it. */
const pathAt = (data: DataModel, at: string, path: string): string => new DataContext(data, at).resolvePath(path);

/** The path that `value` is bound to, or null. A message writes `@path`; the engine's parser of texts writes `path`, and nothing else with it. */
function bindingOf(value: unknown): string | null {
  if (!isObject(value)) return null;
  const path = value["@path"] ?? (Object.keys(value).length === 1 ? value.path : null);
  return isText(path) ? path : null;
}

/** What a text that formatString fills in is made of. */
function filledIn(text: string): unknown[] {
  try {
    return new ExpressionParser().parse(text);
  } catch {
    // The engine draws nothing of one it cannot parse
    return [];
  }
}

/** The paths of the data that `value` is worked out from. */
function pathsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(pathsIn);
  if (!isObject(value)) return [];
  const path = bindingOf(value);
  if (path !== null) return [path];
  const { args } = value;
  const text = (value["@call"] ?? value.call) === "formatString" && isObject(args) ? args.value : null;
  return [...(isText(text) ? filledIn(text).flatMap(pathsIn) : []), ...Object.values(value).flatMap(pathsIn)];
}

/** How many characters of text are written in `value`. */
function textIn(value: unknown): number {
  if (isText(value)) return value.length;
  if (typeof value !== "object" || value === null) return 0;
  return Object.values(value).reduce((sum: number, inner) => sum + textIn(inner), 0);
}

/** What a property of a component names components in. */
interface Held {
  value: unknown;
  /** The keys that name one in each item of `value`, when its items are not ids. */
  keys: readonly string[];
}

function heldBy(component: SurfaceComponent): Held[] {
  const refs = hasOwn(catalog.componentRefMap, component.component) ? catalog.componentRefMap[component.component] : null;
  if (!refs) return [];
  const names = Object.keys(component).filter((name) => refs.singleRefs.has(name) || refs.listRefs.has(name));
  return names.map((name) => ({ value: component[name], keys: [...(refs.nestedRefs?.[name] ?? [])] }));
}

/** `component`, whose own text and JSON count if it is drawn `again`. */
function shapeOf(component: SurfaceComponent, again: boolean): Shape {
  const { id, component: type } = component;
  const own = hasOwn(OWN, type) ? component[OWN[type]] : null;
  const drawn = Object.entries(component).filter(([name]) => !NOT_DRAWN.has(name));
  const shape: Shape = {
    lists: [],
    templates: [],
    choices: [],
    parts: 0,
    own: Array.isArray(own) ? own.length : (bindingOf(own) ?? 0),
    bound: drawn.flatMap(([, value]) => pathsIn(value)),
    text: again ? drawn.reduce((sum, [, value]) => sum + textIn(value), 0) : 0,
    written: again ? JSON.stringify(component).length : 0,
    name: per(NAME, id.length),
  };
  for (const { value, keys } of heldBy(component)) {
    if (isText(value)) shape.lists.push([value]);
    else if (Array.isArray(value)) {
      const held: unknown[] = value.slice(0, MAX_DYNAMIC_CHILD_LIST_SIZE);
      shape.lists.push(held.filter(isText));
      shape.choices.push(...held.filter(isObject).flatMap((item) => keys.map((key) => item[key]).filter(isText)));
      // The button that picks each
      if (keys.length > 0) shape.parts += value.length;
    } else if (isObject(value) && isText(value.componentId) && isText(value.path) && value.path !== "") {
      shape.templates.push({ id: value.componentId, path: value.path, name: per(NAME, value.path.length) });
    }
  }
  return shape;
}

/** The ids of the components that may be drawn more than once: what a template draws, what is named more than once, and all under them. */
function drawnAgain(components: readonly SurfaceComponent[]): ReadonlySet<string> {
  const under = new Map<string, string[]>();
  const again = new Set<string>();
  const namedBy = new Map<string, string>();
  for (const component of components) {
    const held = heldBy(component).flatMap(({ value, keys }): string[] => {
      if (isText(value)) return [value];
      if (Array.isArray(value)) return value.flatMap((item: unknown) => (isObject(item) ? keys.map((key) => item[key]) : [item])).filter(isText);
      if (!isObject(value) || !isText(value.componentId)) return [];
      again.add(value.componentId);
      return [value.componentId];
    });
    const here = new Set<string>();
    for (const id of held) {
      if (here.has(id) || (namedBy.get(id) ?? component.id) !== component.id) again.add(id);
      here.add(id);
      namedBy.set(id, component.id);
    }
    under.set(component.id, [...(under.get(component.id) ?? []), ...held]);
  }
  // It grows as it is gone through
  for (const id of again) for (const child of under.get(id) ?? []) again.add(child);
  return again;
}

const capped = ({ atOnce, withRows }: Size): Size => ({ atOnce: Math.min(atOnce, FARTHEST), withRows: Math.min(withRows, FARTHEST) });

const sumOf = (sizes: readonly Size[]): Size => {
  let atOnce = 0;
  let withRows = 0;
  for (const size of sizes) {
    atOnce += size.atOnce;
    withRows += size.withRows;
  }
  return { atOnce, withRows };
};

const largest = (sizes: readonly Size[]): number => sizes.reduce((most, { atOnce }) => Math.max(most, atOnce), 0);

/** What shows more of a list of `length`. */
const showsMore = (length: number): number => (length > PAGE ? 1 : 0);

/** A list of `length`, each item like `row`. */
const alike = (length: number, row: Size): Size => ({ atOnce: Math.min(length, PAGE) * row.atOnce + showsMore(length), withRows: length * row.withRows });

/** A list of `rows`, which is drawn a page at a time. */
function paged(rows: readonly Size[]): Size {
  const pages: Size[] = [];
  for (let i = 0; i < rows.length; i += PAGE) pages.push(sumOf(rows.slice(i, i + PAGE)));
  return { atOnce: largest(pages) + showsMore(rows.length), withRows: sumOf(pages).withRows };
}

/**
 * Counts what is drawn of `components`, which the engine has found to be whole, over `data`. Where more than one
 * has an id, what is counted is no less than what any of them would have drawn there. The count stops at
 * components that hold each other.
 */
export function drawnSize(components: readonly SurfaceComponent[], data: DataModel): DrawnSize {
  const again = drawnAgain(components);
  const shapes = new Map<string, Shape[]>();
  for (const component of components) {
    const shape = shapeOf(component, again.has(component.id));
    const others = shapes.get(component.id);
    if (others) others.push(shape);
    else shapes.set(component.id, [shape]);
  }
  const counting = new Set<string>();
  const depends = new Map<string, boolean>();
  const sizes = new Map<string, Map<string, Size>>();
  const lengths = new Map<object, number>();
  let counted = 0;

  /** Counts towards `withRows` what nothing else that is counted has in it. */
  const count = (size: number): void => {
    counted += size;
    if (counted > MOST_WITH_ROWS) throw new Stopped();
  };

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

  /** Whether what is drawn of `id` depends on the row it is in. */
  const ofRow = (id: string): boolean => {
    const kept = depends.get(id);
    if (kept !== undefined) return kept;
    // Until it is known, for one that holds itself
    depends.set(id, false);
    const is = shapes
      .get(id)!
      .some(({ lists, templates, choices, bound }) => bound.some(isRelative) || templates.some(({ path }) => isRelative(path)) || lists.some((list) => list.some(ofRow)) || choices.some(ofRow));
    depends.set(id, is);
    return is;
  };

  /** The size of a component at the data path `at`, without the components it holds. */
  const itself = ({ parts, own, bound, text, written }: Shape, at: string): Size => {
    const list = alike(typeof own === "number" ? own : lengthOf(valueAt(at, own)), ONE);
    const characters = bound.reduce((sum, path) => sum + charactersOf(valueAt(at, path)), text);
    const more = Math.max(per(TEXT, characters), per(WRITTEN, written), per(BOUND, bound.length));
    return { atOnce: 1 + parts + Math.max(list.atOnce, more), withRows: 1 + parts + Math.max(list.withRows, more) };
  };

  /**
   * The size of `id` at the data path `at`. `inRow` says whether what holds it depends on its row, and `above`
   * what it counts for more by what the engine names it by.
   */
  const sizeOf = (id: string, at: string, inRow: boolean, above: number): Size => {
    const its = ofRow(id);
    const key = its ? at : "/";
    const kept = sizes.get(id)?.get(key);
    if (kept) {
      if (its || inRow) count(kept.withRows);
      return kept;
    }
    if (counting.has(id)) throw new Stopped();
    counting.add(id);
    const each = shapes.get(id)!.map((shape) => sizeAs(shape, at, its, above));
    counting.delete(id);
    const size = capped({ atOnce: largest(each), withRows: each.reduce((most, { withRows }) => Math.max(most, withRows), 0) });
    const known = sizes.get(id);
    if (known) known.set(key, size);
    else sizes.set(id, new Map([[key, size]]));
    if (!its && inRow) count(size.withRows);
    return size;
  };

  /** The size of a component as `shape` has it, which depends on its row if `its`. The rest is as `sizeOf` has it. */
  const sizeAs = (shape: Shape, at: string, its: boolean, above: number): Size => {
    const self = itself(shape, at);
    if (its) count(self.withRows + above);
    const under = above + shape.name;
    const choices = shape.choices.map((child) => sizeOf(child, at, its, under));
    const held = sumOf([
      ...shape.lists.map((list) => paged(list.map((child) => sizeOf(child, at, its, under)))),
      ...shape.templates.map((template) => rowsOf(template, at, its, under)),
      { atOnce: largest(choices), withRows: sumOf(choices).withRows },
    ]);
    return { atOnce: self.atOnce + held.atOnce, withRows: self.withRows + held.withRows * (1 + shape.name) };
  };

  /** The size of a template's rows. The rest is as `sizeOf` has it, of what the template is of. */
  const rowsOf = ({ id, path, name }: Template, at: string, inRow: boolean, above: number): Size => {
    const listAt = pathAt(data, at, path);
    const list: unknown = data.get(listAt);
    if (!Array.isArray(list) || list.length === 0) return { atOnce: 0, withRows: 0 };
    const items: unknown[] = list.slice(0, MAX_DYNAMIC_CHILD_LIST_SIZE);
    const rowAt = (i: number): Size => sizeOf(id, pathAt(data, listAt, String(i)), inRow, above + name);
    const row = rowAt(0);
    if (inRow && !ofRow(id)) count(row.withRows * (items.length - 1));
    const rows = ofRow(id) ? paged([row, ...Array.from({ length: items.length - 1 }, (_, i) => rowAt(i + 1))]) : alike(items.length, row);
    let told = 0;
    for (let i = 0; i < items.length; i += PAGE) told = Math.max(told, per(ROW_DATA, charactersOf(items.slice(i, i + PAGE))));
    return { atOnce: rows.atOnce + told, withRows: rows.withRows * (1 + name) };
  };

  try {
    return { ...sizeOf("root", "/", false, 0), stopped: false };
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    return { atOnce: 0, withRows: counted, stopped: true };
  }
}
