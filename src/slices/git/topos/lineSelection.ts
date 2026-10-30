// The diff view's line selection (#366, #386): which changed lines a gutter click, Shift-click,
// drag or key picks, across the hunks of one file. A selection belongs to one diff of one file;
// the view drops it whenever the diff changes.

import type { DiffDoc, Hunk } from "./diffDoc.ts";
import { lineCount } from "./diffView.ts";
import type { DiffKeyAction, StageDirection } from "./stagingKeys.ts";

/** `LineRef` from `src-tauri/src/slices/git/diff.rs`: a line's hunk and its index in that hunk. */
export interface LineRef {
  hunk: number;
  line: number;
}

export function lineKey(ref: LineRef): string {
  return `${ref.hunk}:${ref.line}`;
}

export interface LineSelection {
  /** The lines the operator picked, by `lineKey`. */
  picked: ReadonlySet<string>;
  /** Where a Shift-click or Shift+↑/↓ range starts. */
  anchor: LineRef | null;
  /** The line the keys act on, which the view outlines. */
  cursor: LineRef | null;
}

export const emptySelection: LineSelection = { picked: new Set(), anchor: null, cursor: null };

/** The line on `row` of `doc` if it is an added or deleted line; context is never selected. */
export function changedAt(doc: DiffDoc, row: number): LineRef | null {
  const l = doc.lines[row];
  return l !== undefined && (l.kind === "add" || l.kind === "del") && l.line !== null ? { hunk: l.hunk, line: l.line } : null;
}

/** The changed lines of `doc` from row `a` to row `b`, both included, in either order. */
export function rangeRefs(doc: DiffDoc, a: number, b: number): LineRef[] {
  const out: LineRef[] = [];
  for (let row = Math.max(0, Math.min(a, b)); row <= Math.min(doc.lines.length - 1, Math.max(a, b)); row++) {
    const ref = changedAt(doc, row);
    if (ref !== null) out.push(ref);
  }
  return out;
}

/** The row of `doc` that shows `ref`, or -1 when this doc doesn't show it (a split view's other side). */
export function rowOf(doc: DiffDoc, ref: LineRef): number {
  return doc.lines.findIndex((l) => l.hunk === ref.hunk && l.line === ref.line);
}

function withRange(picked: ReadonlySet<string>, doc: DiffDoc, a: number, b: number): Set<string> {
  const next = new Set(picked);
  for (const ref of rangeRefs(doc, a, b)) next.add(lineKey(ref));
  return next;
}

/**
 * A gutter click on `row`: it toggles that changed line and makes it the anchor, or with `shift`
 * adds every changed line from the anchor to it. A click on a context line changes nothing.
 */
export function clickRow(s: LineSelection, doc: DiffDoc, row: number, shift: boolean): LineSelection {
  const ref = changedAt(doc, row);
  if (ref === null) return s;
  const anchorRow = s.anchor === null ? -1 : rowOf(doc, s.anchor);
  if (shift && anchorRow >= 0) return { picked: withRange(s.picked, doc, anchorRow, row), anchor: s.anchor, cursor: ref };
  const picked = new Set(s.picked);
  if (!picked.delete(lineKey(ref))) picked.add(lineKey(ref));
  return { picked, anchor: ref, cursor: ref };
}

/**
 * A gutter drag from row `from` to row `to`, as the selection `before` it began: every changed
 * line it passes is added. A drag that never left its first row is a click there.
 */
export function dragRows(before: LineSelection, doc: DiffDoc, from: number, to: number): LineSelection {
  if (from === to) return clickRow(before, doc, from, false);
  const anchor = changedAt(doc, from) ?? before.anchor;
  return { picked: withRange(before.picked, doc, from, to), anchor, cursor: changedAt(doc, to) ?? before.cursor };
}

/** `picked` as refs in diff order, as a `Lines` selection lists them. */
export function selectedRefs(picked: ReadonlySet<string>): LineRef[] {
  return [...picked]
    .map((key) => {
      const [hunk, line] = key.split(":").map(Number);
      return { hunk, line };
    })
    .sort((a, b) => a.hunk - b.hunk || a.line - b.line);
}

/** The lines a stage or unstage acts on: what was picked, plus the no-newline lines it needs. */
export interface EffectiveSelection {
  keys: ReadonlySet<string>;
  /** The lines added for a no-newline marker that the operator didn't pick, for the tooltip. */
  auto: ReadonlySet<string>;
}

/**
 * `picked` with the lines a no-newline-at-EOF marker makes it need (#366). When the old side's
 * last line has no newline, git shows it deleted, the marker, and the line again with its
 * newline among the additions after it. A patch can't keep any line after a side's last line, so:
 * staging a line after the marker adds the pair (the deletion and the first addition after the
 * marker); unstaging the deletion or a line after the marker adds the deletion and every addition
 * after the marker, since an unpicked addition stays as context in a reverse patch.
 */
export function withNoNewlinePairs(hunks: Hunk[], picked: ReadonlySet<string>, direction: StageDirection): EffectiveSelection {
  const keys = new Set(picked);
  hunks.forEach((h, hunk) => {
    h.lines.forEach((l, marker) => {
      if (l.kind !== "noNewline" || h.lines[marker - 1]?.kind !== "del") return;
      const del = marker - 1;
      const laterAdds: number[] = [];
      for (let i = marker + 1; i < h.lines.length; i++) if (h.lines[i].kind === "add") laterAdds.push(i);
      const later = [...picked].some((key) => {
        const [kh, kl] = key.split(":").map(Number);
        return kh === hunk && kl > marker;
      });
      const delPicked = picked.has(lineKey({ hunk, line: del }));
      let needs: number[] = [];
      if (direction === "stage" && later) needs = [del, ...laterAdds.slice(0, 1)];
      else if (direction === "unstage" && (later || delPicked)) needs = [del, ...laterAdds];
      for (const line of needs) keys.add(lineKey({ hunk, line }));
    });
  });
  const auto = new Set([...keys].filter((key) => !picked.has(key)));
  return { keys, auto };
}

/** Orders refs as the diff lists them. */
function compare(a: LineRef, b: LineRef): number {
  return a.hunk - b.hunk || a.line - b.line;
}

/** The changed lines `doc` shows, in order. */
function changedRows(doc: DiffDoc): { row: number; ref: LineRef }[] {
  const out: { row: number; ref: LineRef }[] = [];
  doc.lines.forEach((_, row) => {
    const ref = changedAt(doc, row);
    if (ref !== null) out.push({ row, ref });
  });
  return out;
}

/**
 * The changed line a move from `cursor` lands on in `doc`: the next or previous one, or the first
 * when there is no cursor. The cursor needn't be on a line `doc` shows, as when focus moves to the
 * other pane of the split view, so it is placed by its order in the diff.
 */
function moved(doc: DiffDoc, cursor: LineRef | null, dir: 1 | -1): LineRef | null {
  const rows = changedRows(doc);
  if (rows.length === 0) return cursor;
  if (cursor === null) return rows[0].ref;
  const hit = dir === 1 ? rows.find((r) => compare(r.ref, cursor) > 0) : rows.findLast((r) => compare(r.ref, cursor) < 0);
  return hit?.ref ?? (rows.some((r) => compare(r.ref, cursor) === 0) ? cursor : rows[dir === 1 ? rows.length - 1 : 0].ref);
}

/** The first changed line of the next or previous hunk `doc` shows one in. */
function hunkMoved(doc: DiffDoc, cursor: LineRef | null, dir: 1 | -1): LineRef | null {
  const rows = changedRows(doc);
  if (rows.length === 0) return cursor;
  if (cursor === null) return rows[0].ref;
  const firsts = rows.filter((r, i) => i === 0 || rows[i - 1].ref.hunk !== r.ref.hunk).map((r) => r.ref);
  const hit = dir === 1 ? firsts.find((r) => r.hunk > cursor.hunk) : firsts.findLast((r) => r.hunk < cursor.hunk);
  return hit ?? cursor;
}

/** What a selection key does in `doc`. `s` and `u` act on the selection and change nothing here. */
export function keyStep(s: LineSelection, doc: DiffDoc, action: DiffKeyAction): LineSelection {
  switch (action) {
    case "up":
    case "down": {
      const cursor = moved(doc, s.cursor, action === "down" ? 1 : -1);
      return { ...s, cursor, anchor: cursor };
    }
    case "extendUp":
    case "extendDown": {
      const anchor = s.anchor ?? s.cursor ?? moved(doc, null, 1);
      const cursor = s.cursor === null ? anchor : moved(doc, s.cursor, action === "extendDown" ? 1 : -1);
      if (anchor === null || cursor === null) return s;
      const picked = new Set(s.picked);
      for (const ref of [anchor, cursor]) picked.add(lineKey(ref));
      const [lo, hi] = compare(anchor, cursor) <= 0 ? [anchor, cursor] : [cursor, anchor];
      for (const { ref } of changedRows(doc)) if (compare(ref, lo) >= 0 && compare(ref, hi) <= 0) picked.add(lineKey(ref));
      return { picked, anchor, cursor };
    }
    case "toggle": {
      const cursor = s.cursor ?? moved(doc, null, 1);
      if (cursor === null) return s;
      const picked = new Set(s.picked);
      if (!picked.delete(lineKey(cursor))) picked.add(lineKey(cursor));
      return { picked, anchor: cursor, cursor };
    }
    case "nextHunk":
    case "prevHunk": {
      const cursor = hunkMoved(doc, s.cursor, action === "nextHunk" ? 1 : -1);
      return { ...s, cursor, anchor: cursor };
    }
    case "stage":
    case "unstage":
      return s;
  }
}

/** The longest stretch of a line's text an announcement reads. */
const ANNOUNCED_TEXT = 80;

/**
 * What the live region says when the cursor lands on `ref`: its kind, its number on its own side,
 * whether it is selected, and its text. `prefix` leads, as "Hunk 2 of 3" does after `n` or `p`.
 */
export function lineAnnouncement(hunks: Hunk[], ref: LineRef, selected: boolean, prefix?: string): string {
  const h = hunks[ref.hunk];
  if (h === undefined) return "";
  let oldNo = h.oldStart;
  let newNo = h.newStart;
  for (let i = 0; i < ref.line; i++) {
    const kind = h.lines[i]?.kind;
    if (kind === "context" || kind === "del") oldNo++;
    if (kind === "context" || kind === "add") newNo++;
  }
  const l = h.lines[ref.line];
  if (l === undefined) return "";
  const what = l.kind === "add" ? `added line ${newNo}` : `deleted line ${oldNo}`;
  const head = prefix === undefined ? what.charAt(0).toUpperCase() + what.slice(1) : `${prefix}, ${what}`;
  const text = l.text.length > ANNOUNCED_TEXT ? `${l.text.slice(0, ANNOUNCED_TEXT)}…` : l.text;
  return `${head}${selected ? ", selected" : ""}: ${text}`;
}

/** The size of the selection, and how many lines a no-newline marker added to it. */
export function selectionCount(n: number, auto: number): string {
  if (n === 0) return "No lines selected";
  const base = `${lineCount(n)} selected`;
  return auto === 0 ? base : `${base}, ${auto.toLocaleString("en-US")} added for a missing newline at end of file`;
}

/** The floating bar's main button: "Stage n lines" or "Unstage n lines". */
export function linesLabel(direction: StageDirection, n: number): string {
  return `${direction === "stage" ? "Stage" : "Unstage"} ${lineCount(n)}`;
}

/** The tooltip on a line a no-newline marker added to the selection. */
export const NO_NEWLINE_TIP =
  "Added automatically: the old last line has no newline at end of file, so a later line can only be staged or unstaged with this pair.";
