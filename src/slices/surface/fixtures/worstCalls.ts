// The worst calls that the size limits allow (#765): those that would draw the most, and those that take the
// longest to count. A worker checks them (`drawnWorker.ts`), as one that nothing rejects takes all the time and
// memory there is.
import { button, create, EVENT, holds, listOf, rows, text, times, type Component } from "./rawFixtures.ts";

/** How many bytes of a request, which is at most 2 MB, its messages may take. */
const REQUEST = 2 * 1024 * 1024 - 1000;

const leaf = text("leaf", "x");

/** Containers, `depth` deep, each made by `make` of its id and the id of the next one, and the last of a leaf. */
const nest = (depth: number, make: (id: string, child: string) => Component): Component[] => [
  ...times(depth, (i) => make(i === 0 ? "root" : `c${i}`, i === depth - 1 ? "leaf" : `c${i + 1}`)),
  leaf,
];

/** As many components beside each other as a surface has room for with `rest`. */
const beside = (make: (id: string) => Component, ...rest: Component[]): Component[] => {
  const ids = times(499 - rest.length, (i) => `c${i}`);
  return [holds("root", ids), ...ids.map(make), ...rest];
};

/** As many items as the data may hold, and as many that are objects. */
const items = rows(131_000);
const objects = times(32_000, () => ({ n: 0 }));

/** Arrays in arrays. */
const nestedItems = (depth: number, width: number): unknown => (depth === 0 ? 0 : times(width, () => nestedItems(depth - 1, width)));

const long = "x".repeat(900_000);
const longKey = "x".repeat(200_000);

/** The longest text that is Markdown, written to make many elements. */
const dense = "- a\n".repeat(5000);

const of = (components: Component[], dataModel: object = {}) => create(components, { dataModel });

/** The call of each, whose name says what it is the worst of. */
export const WORST: Readonly<Record<string, object>> = {
  "templates in templates over one list": of(nest(49, (id, child) => listOf(id, child, "/rows")), { rows: items }),
  "templates in templates over a short list": of(nest(3, (id, child) => listOf(id, child, "/rows")), { rows: rows(200) }),
  "templates in templates of rows in rows": of(nest(15, (id, child) => listOf(id, child, id === "root" ? "/rows" : ".")), { rows: nestedItems(15, 2) }),
  "lists of one long list": of(
    beside((id) => listOf(id, "leaf", "/rows"), leaf),
    { rows: items },
  ),
  "lists of one long list, whose rows draw their own data": of(
    beside((id) => listOf(id, "leaf", "/rows"), text("leaf", { "@path": "n" })),
    { rows: objects },
  ),
  "lists of one long list, each a page of its data": of(
    beside((id) => listOf(id, "row", "/rows"), listOf("row", "leaf", "/two"), text("leaf", "x")),
    { rows: [0], two: times(2, () => "x".repeat(100_000)) },
  ),
  "a list of its own in each row": of([listOf("root", "row", "/rows"), holds("row", ["a", "b"]), listOf("a", "leaf", "/rows"), listOf("b", "leaf", "n"), leaf], { rows: objects }),
  "one component named over and over": of([holds("root", times(Math.floor(REQUEST / 7) - 40, () => "leaf")), leaf]),
  "components that share their children": of(nest(48, (id, child) => holds(id, times(Math.floor(REQUEST / 7 / 48) - 20, () => child)))),
  "components that share their children, by twos": of(nest(49, (id, child) => holds(id, [child, child]))),
  "a long id over many rows": of([holds("root", [long]), listOf(long, "leaf", "/rows"), leaf], { rows: items }),
  "a long path to rows that draw their own data": of([listOf("root", "leaf", `/${longKey}`), text("leaf", { "@path": "n" })], { [longKey]: times(5000, () => ({ n: 0 })) }),
  "one long text in each row": of([listOf("root", "leaf", "/rows"), text("leaf", { "@path": "/big" })], { big: dense, rows: rows(100) }),
  "one long text filled in, in each row": of([listOf("root", "leaf", "/rows"), text("leaf", { "@call": "formatString", args: { value: "${/big}" } })], { big: dense, rows: rows(100) }),
  "many values filled in, in each row": of([listOf("root", "leaf", "/rows"), text("leaf", { "@call": "formatString", args: { value: "${n}".repeat(900) } })], { rows: objects }),
  "many checks in each row": of([listOf("root", "go", "/rows"), ...button("go", EVENT, { "@checks": times(20_000, () => ({ condition: { "@path": "n" }, message: "" })) })], { rows: objects }),
  "long texts to fill in": of(
    beside((id) => text(id, { "@call": "formatString", args: { value: "${a/b}${/c}".repeat(350) } })),
    { c: "x".repeat(100_000) },
  ),
  "options of pickers": of(beside((id) => ({ id, component: "ChoicePicker", value: [], options: times(100, (i) => ({ label: "", value: `${i}` })) }))),
  "steps of one list": of(
    beside((id) => ({ id, component: "Steps", steps: { "@path": "/steps" } })),
    { steps: times(8000, () => ({ label: "", state: "done" })) },
  ),
  "tabs of one component": of([{ id: "root", component: "Tabs", tabs: times(60_000, () => ({ title: "", child: "leaf" })) }, leaf]),
  "a template that is its own ancestor": of([listOf("root", "c1", "/rows"), listOf("c1", "c2", "/rows"), holds("c2", ["c1", "c1"])], { rows: items }),
  "components that hold each other": of([holds("root", ["c1", "c1"]), holds("c1", ["c2", "c2"]), holds("c2", ["c1", "c1"])]),
};
