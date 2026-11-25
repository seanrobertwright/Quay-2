// How much of a surface is drawn, counted from its components and its data before anything resolves them.
// The engine resolves every row of every list, also those that are not drawn yet, so what there is with every
// row has a limit of its own. The drawn tree is not walked: a component is counted once, or once for each
// row where what it draws depends on the row, and the count stops once those are past the limit.
import { MAX_DYNAMIC_CHILD_LIST_SIZE, type DataModel } from "@a2ui/web_core/v1_0";
import { PAGE } from "../../parts/usePaged.tsx";
import { hasOwn, isObject } from "../json.ts";
import type { SurfaceComponent } from "../surfaceTypes.ts";
import { catalog } from "./catalog.ts";
import { MOST_AT_ONCE, MOST_WITH_ROWS, NAME, ROW_DATA, STEPS, TEXT, TOKENS, WRITTEN } from "./drawnLimits.ts";
import { bindingOf, dependOnRow, fillsIn, isRelative, pathAt, sourcesOf, Unbounded, workedOut, type Sources } from "./workedOut.ts";

/** A count goes no further than this, so that it stays a number that can be told. */
export const FARTHEST = 1_000_000_000;

/** What counts for more components than the one it is of, as an agent is told of it. */
const WEIGHED = ["long texts", "Markdown", "bindings and calls", "repeated properties", "long ids and paths", "row data"] as const;

type Weighed = (typeof WEIGHED)[number];

const per = (unit: number, count: number): number => Math.floor(count / unit);

/** How many components are drawn. One that takes long to draw counts as more. */
interface Size {
  /** At least as many as are drawn at once: when the surface is first drawn, by a press of what shows more, or by the pick of a tab. */
  atOnce: number;
  /** With every row. */
  withRows: number;
}

export interface DrawnSize extends Size {
  /**
   * Why the count stopped early, or null. `past`: there are at least `withRows`, which is past the limit, and
   * `atOnce` is not counted. `unbounded`: components hold each other, or `Unbounded` was thrown of a value, and
   * both counts are the farthest.
   */
  stopped: "past" | "unbounded" | null;
  /** What was counted for more components than the one it is of. */
  weighed: readonly Weighed[];
}

export const isPastAtOnce = ({ atOnce }: DrawnSize): boolean => atOnce > MOST_AT_ONCE;

export const isPastWithRows = ({ withRows }: DrawnSize): boolean => withRows > MOST_WITH_ROWS;

/** Whether a surface that draws `size` is past a limit. */
export const isPast = (size: DrawnSize): boolean => isPastAtOnce(size) || isPastWithRows(size);

/** A component drawn once for each item of the list at `path`. */
interface Template {
  id: string;
  path: string;
  /** What each component of a row counts for more, as the engine names it by `path`. */
  nameCost: number;
}

/** A list that a component draws itself as a container does. */
type OwnList = { from: "component"; length: number } | { from: "data"; path: string };

/** What is told of a component by how it is written. */
interface Shape {
  /** Lists of the components it holds, each drawn together. */
  lists: string[][];
  templates: Template[];
  /** Components it holds of which one is drawn at a time. */
  choices: string[];
  /** What it draws besides, all of it at once. */
  parts: number;
  own: OwnList | null;
  /** What its values are worked out from. */
  sources: Sources;
  /** The text it draws as Markdown, or null if it draws none. */
  markdown: unknown;
  /** The characters of its own text, and of its JSON, or 0 if they do not count. */
  textLength: number;
  jsonLength: number;
  /** What each component under it counts for more, as the engine names it by its id. */
  nameCost: number;
}

/** Ends a count that is past the limit with every row. */
class Past extends Error {}

const ONE: Size = { atOnce: 1, withRows: 1 };

/** The property of a component that lists what it draws itself, besides the components it holds. */
const OWN: Readonly<Record<string, string>> = { ChoicePicker: "options", Steps: "steps" };

/** Properties whose values are not drawn. */
const NOT_DRAWN: ReadonlySet<string> = new Set(["id", "component", "action"]);

const isText = (value: unknown): value is string => typeof value === "string";

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** How many characters of text are written in `value`. */
function textIn(value: unknown): number {
  if (isText(value)) return value.length;
  if (typeof value !== "object" || value === null) return 0;
  return Object.values(value).reduce((sum: number, inner) => sum + textIn(inner), 0);
}

/** What of an `action` counts: a call, whose arguments are worked out as it is drawn, and the texts that a click fills in. */
const countedOf = (action: unknown): unknown[] => (isObject(action) ? [action.functionCall, ...fillsIn(action.event)] : []);

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

function ownListOf(component: SurfaceComponent): OwnList | null {
  const own = hasOwn(OWN, component.component) ? component[OWN[component.component]] : null;
  if (Array.isArray(own)) return { from: "component", length: own.length };
  const path = bindingOf(own);
  return path === null ? null : { from: "data", path };
}

/** `component`, whose own text and JSON count if it is drawn `again`. */
function shapeOf(component: SurfaceComponent, again: boolean): Shape {
  const { id, component: type } = component;
  const drawn = Object.keys(component).flatMap((name) => (NOT_DRAWN.has(name) ? [] : [component[name]]));
  const shape: Shape = {
    lists: [],
    templates: [],
    choices: [],
    parts: 0,
    own: ownListOf(component),
    sources: sourcesOf([...drawn, ...countedOf(component.action)]),
    markdown: type === "Text" ? component.text : null,
    textLength: again ? textIn(drawn) : 0,
    jsonLength: again ? JSON.stringify(component).length : 0,
    nameCost: per(NAME, id.length),
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
      shape.templates.push({ id: value.componentId, path: value.path, nameCost: per(NAME, value.path.length) });
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
 * has an id, what is counted is no less than what any of them would have drawn there.
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
  const { valueAt, charactersOf, workOf, textAt, tokensIn } = workedOut(data);
  const counting = new Set<string>();
  const depends = new Map<string, boolean>();
  const sizes = new Map<string, Map<string, Size>>();
  const weighed = new Set<Weighed>();
  let counted = 0;

  /** Counts towards `withRows` what nothing else that is counted has in it. */
  const count = (size: number): void => {
    counted += size;
    if (counted > MOST_WITH_ROWS) throw new Past();
  };

  /** Whether what is drawn of `id` depends on the row it is in. */
  const ofRow = (id: string): boolean => {
    const kept = depends.get(id);
    if (kept !== undefined) return kept;
    // Until it is known, for one that holds itself
    depends.set(id, false);
    const known = shapes
      .get(id)!
      .some(({ lists, templates, choices, sources }) => dependOnRow(sources) || templates.some(({ path }) => isRelative(path)) || lists.some((list) => list.some(ofRow)) || choices.some(ofRow));
    depends.set(id, known);
    return known;
  };

  const ownLength = (own: OwnList | null, at: string): number => {
    if (own === null) return 0;
    return own.from === "component" ? own.length : lengthOf(valueAt(at, own.path));
  };

  /** How many components what a component draws at the data path `at` counts for besides itself, and what of it counts for the most. */
  const weightOf = ({ sources, markdown, textLength, jsonLength }: Shape, at: string): [Weighed, number] => {
    const { steps, characters } = workOf(sources, at);
    const weights: [Weighed, number][] = [
      ["long texts", per(TEXT, characters + textLength)],
      ["bindings and calls", per(STEPS, steps)],
      ["repeated properties", per(WRITTEN, jsonLength)],
    ];
    // Where one of these is past the limit, the text would take too long to make
    if (weights.every(([, weight]) => weight <= MOST_AT_ONCE)) weights.push(["Markdown", per(TOKENS, tokensIn(textAt(markdown, at)))]);
    return weights.reduce((most, one) => (one[1] > most[1] ? one : most));
  };

  /** The size of a component at the data path `at`, without the components it holds. */
  const itself = (shape: Shape, at: string): Size => {
    const list = alike(ownLength(shape.own, at), ONE);
    const [what, weight] = weightOf(shape, at);
    if (weight > list.atOnce) weighed.add(what);
    return { atOnce: 1 + shape.parts + Math.max(list.atOnce, weight), withRows: 1 + shape.parts + Math.max(list.withRows, weight) };
  };

  /**
   * The size of `id` at the data path `at`. `inRow` says whether what holds it depends on its row, and `above`
   * what it counts for more by what the engine names it by.
   */
  const sizeOf = (id: string, at: string, inRow: boolean, above: number): Size => {
    const dependent = ofRow(id);
    const key = dependent ? at : "/";
    const kept = sizes.get(id)?.get(key);
    if (kept) {
      if (dependent || inRow) count(kept.withRows);
      return kept;
    }
    if (counting.has(id)) throw new Unbounded();
    counting.add(id);
    const each = shapes.get(id)!.map((shape) => sizeAs(shape, at, dependent, above));
    counting.delete(id);
    const size = capped({ atOnce: largest(each), withRows: each.reduce((most, { withRows }) => Math.max(most, withRows), 0) });
    const known = sizes.get(id);
    if (known) known.set(key, size);
    else sizes.set(id, new Map([[key, size]]));
    if (!dependent && inRow) count(size.withRows);
    return size;
  };

  /** The size of a component as `shape` has it, which depends on its row if `dependent`. The rest is as `sizeOf` has it. */
  const sizeAs = (shape: Shape, at: string, dependent: boolean, above: number): Size => {
    const self = itself(shape, at);
    if (shape.nameCost > 0) weighed.add("long ids and paths");
    if (dependent) count(self.withRows + above);
    const under = above + shape.nameCost;
    const choices = shape.choices.map((child) => sizeOf(child, at, dependent, under));
    const held = sumOf([
      ...shape.lists.map((list) => paged(list.map((child) => sizeOf(child, at, dependent, under)))),
      ...shape.templates.map((template) => rowsOf(template, at, dependent, under)),
      { atOnce: largest(choices), withRows: sumOf(choices).withRows },
    ]);
    return { atOnce: self.atOnce + held.atOnce, withRows: self.withRows + held.withRows * (1 + shape.nameCost) };
  };

  /** The size of a template's rows. The rest is as `sizeOf` has it, of what the template is of. */
  const rowsOf = ({ id, path, nameCost }: Template, at: string, inRow: boolean, above: number): Size => {
    const listAt = pathAt(data, at, path);
    const list: unknown = data.get(listAt);
    if (!Array.isArray(list) || list.length === 0) return { atOnce: 0, withRows: 0 };
    if (nameCost > 0) weighed.add("long ids and paths");
    const items: unknown[] = list.slice(0, MAX_DYNAMIC_CHILD_LIST_SIZE);
    const rowAt = (i: number): Size => sizeOf(id, pathAt(data, listAt, String(i)), inRow, above + nameCost);
    const row = rowAt(0);
    if (inRow && !ofRow(id)) count(row.withRows * (items.length - 1));
    const rows = ofRow(id) ? paged([row, ...Array.from({ length: items.length - 1 }, (_, i) => rowAt(i + 1))]) : alike(items.length, row);
    let told = 0;
    for (let i = 0; i < items.length; i += PAGE) told = Math.max(told, per(ROW_DATA, charactersOf(items.slice(i, i + PAGE))));
    if (told > 0) weighed.add("row data");
    return { atOnce: rows.atOnce + told, withRows: rows.withRows * (1 + nameCost) };
  };

  /** What is counted, up to where the count stops. */
  const found = (): Omit<DrawnSize, "weighed"> => {
    try {
      return { ...sizeOf("root", "/", false, 0), stopped: null };
    } catch (error) {
      if (error instanceof Past) return { atOnce: 0, withRows: counted, stopped: "past" };
      if (error instanceof Unbounded) return { atOnce: FARTHEST, withRows: FARTHEST, stopped: "unbounded" };
      throw error;
    }
  };
  const size = found();
  return { ...size, weighed: WEIGHED.filter((what) => weighed.has(what)) };
}
