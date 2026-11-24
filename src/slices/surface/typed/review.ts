// quay_review's two pure functions: the surface its checked arguments make, and the result its action
// makes. The names of its parts are here too, for the layout that places them.
import type { CreateSurface, SurfaceAction, SurfaceComponent } from "../surfaceTypes.ts";
import { plainText, textOfPlain } from "./plainText.ts";

/** A checked `quay_review` call. Mirrors `Review`. */
export interface ReviewArguments {
  title: string;
  body: string;
  items?: { title: string; detail?: string; file?: string }[];
}

export type ReviewVerdict = "approved" | "changes_requested" | "rejected";

/** The operator's decision, as its agent gets it. */
export interface ReviewAnswer {
  title: string;
  verdict: ReviewVerdict;
  /** The titles of the items to leave out, in order. */
  dropped: string[];
  /** Left out when nothing was written. */
  comment?: string;
}

/** The part that says what is reviewed, in a line. */
export const TITLE_PART = "title";

/** The part that is reviewed. */
export const BODY_PART = "body";

/** The parts of item `i`. An item has the last two only when its call gives them. */
export const itemParts = (i: number) => ({ keep: `i${i}_keep`, detail: `i${i}_detail`, file: `i${i}_file` });

/** The part that takes the comment, and what it asks for. */
export const COMMENT_PART = "comment";
export const COMMENT_LABEL = "Comment for the agent";

/** The parts that decide. */
export const VERDICT_PARTS = { approve: "approve", requestChanges: "request_changes", reject: "reject" } as const;

/** Where in the data model it is whether item `i` is kept. */
export const keptPath = (i: number) => `/items/${i}/kept`;

/** Where in the data model the comment is. */
export const COMMENT = "/comment";

/** The frame's own path in the data model to what Approve reads. */
export const APPROVE_LABEL = "/frame/approveLabel";

/** The frame's own path that holds Request changes: true once there is a comment. */
export const COMMENTED = "/frame/commented";

/** What Approve reads with `dropped` items dropped. */
export const approveLabel = (dropped: number) =>
  dropped === 0 ? "Approve" : `Approve without ${dropped} ${dropped === 1 ? "item" : "items"}`;

/** An item, as the surface `expand` made holds it. */
export interface ReviewItem {
  parts: ReturnType<typeof itemParts>;
  title: string;
  detail: string | null;
  /** The file it names, as its call wrote it, or null. */
  file: string | null;
}

/** The verdict each button's action is. */
const VERDICTS: ReadonlyMap<string, ReviewVerdict> = new Map([
  [VERDICT_PARTS.approve, "approved"],
  [VERDICT_PARTS.requestChanges, "changes_requested"],
  [VERDICT_PARTS.reject, "rejected"],
]);

/** A path that may end in `:line`. The colon of a drive is none of a line's. */
const FILE_LINE = /^(.{2,}):(\d{1,9})$/s;

/** The file and line that `file` names. */
function fileLine(file: string): { path: string; line?: number } {
  const named = FILE_LINE.exec(file);
  return named && Number(named[2]) > 0 ? { path: named[1], line: Number(named[2]) } : { path: file };
}

const textAt = (components: ReadonlyMap<string, SurfaceComponent>, id: string): string | null => {
  const text = components.get(id)?.text;
  return typeof text === "string" ? text : null;
};

/** What a surface `expand` made reviews, in a line. */
export function titleIn(components: readonly SurfaceComponent[]): string {
  const text = components.find(({ id }) => id === TITLE_PART)?.text;
  return typeof text === "string" ? textOfPlain(text) : "Review";
}

/** The Markdown that a surface `expand` made reviews. */
export function bodyIn(components: readonly SurfaceComponent[]): string {
  const text = components.find(({ id }) => id === BODY_PART)?.text;
  return typeof text === "string" ? text : "";
}

/** The items of a surface `expand` made, in order. */
export function itemsIn(components: readonly SurfaceComponent[]): ReviewItem[] {
  const byId = new Map(components.map((component) => [component.id, component]));
  const items: ReviewItem[] = [];
  for (let parts = itemParts(0); byId.has(parts.keep); parts = itemParts(items.length)) {
    const detail = textAt(byId, parts.detail);
    const file = byId.get(parts.file);
    items.push({
      parts,
      title: String(byId.get(parts.keep)?.label),
      detail: detail === null ? null : textOfPlain(detail),
      file: file ? `${String(file.path)}${file.line === undefined ? "" : `:${String(file.line)}`}` : null,
    });
  }
  return items;
}

export function expand({ title, body, items = [] }: ReviewArguments, surfaceId: string): CreateSurface {
  const itemComponents = items.flatMap((item, i): SurfaceComponent[] => {
    const names = itemParts(i);
    const detail = item.detail?.trim() ? item.detail : null;
    const file = item.file?.trim() ? item.file : null;
    return [
      { id: names.keep, component: "CheckBox", label: item.title, value: { "@path": keptPath(i) } },
      ...(detail === null ? [] : [{ id: names.detail, component: "Text", variant: "caption", text: plainText(detail) }]),
      ...(file === null ? [] : [{ id: names.file, component: "FileLink", ...fileLine(file) }]),
    ];
  });
  const comment: SurfaceComponent = { id: COMMENT_PART, component: "TextField", variant: "longText", label: COMMENT_LABEL, value: { "@path": COMMENT } };
  const context = {
    title,
    comment: { "@path": COMMENT },
    ...Object.fromEntries(items.flatMap((item, i) => [[`item${i}`, item.title], [`kept${i}`, { "@path": keptPath(i) }]])),
  };
  const button = (id: string, label: unknown, rest: object): SurfaceComponent[] => [
    { id, component: "Button", child: `${id}_label`, action: { event: { name: id, context } }, ...rest },
    { id: `${id}_label`, component: "Text", text: label },
  ];
  const { approve, requestChanges, reject } = VERDICT_PARTS;
  const buttons = [
    ...button(approve, { "@path": APPROVE_LABEL }, { variant: "primary" }),
    ...button(requestChanges, "Request changes", { "@checks": [{ condition: { "@path": COMMENTED }, message: "Say what should change first." }] }),
    ...button(reject, "Reject", {}),
  ];
  const parts = [
    { id: TITLE_PART, component: "Text", text: plainText(title) },
    { id: BODY_PART, component: "Text", text: body },
    ...itemComponents,
    comment,
  ];
  return {
    version: "1.0",
    createSurface: {
      surfaceId,
      components: [
        { id: "root", component: "Column", children: [...parts.map(({ id }) => id), approve, requestChanges, reject] },
        ...parts,
        ...buttons,
      ],
      dataModel: { items: items.map(() => ({ kept: true })), comment: "", frame: { approveLabel: approveLabel(0), commented: false } },
    },
  };
}

export function collapse({ name, context }: SurfaceAction): ReviewAnswer {
  const verdict = VERDICTS.get(name);
  if (!verdict) throw new Error(`A review has no action "${name}".`);
  const fields = new Map(Object.entries(context));
  const dropped: string[] = [];
  for (let i = 0; fields.has(`item${i}`); i += 1) {
    if (fields.get(`kept${i}`) !== true) dropped.push(String(fields.get(`item${i}`)));
  }
  const comment = fields.get("comment");
  return {
    title: String(fields.get("title")),
    verdict,
    dropped,
    ...(typeof comment === "string" && comment.trim() !== "" ? { comment } : {}),
  };
}
