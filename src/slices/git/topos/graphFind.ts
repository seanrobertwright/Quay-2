// Find (#368, #399): the client-side search over the rows already loaded.

import type { Badge } from "./graphRefs.ts";

/** The loaded rows as Find reads them; `GraphStore` is one. */
export interface FindRows {
  readonly rowCount: number;
  oid(row: number): string;
  subject(row: number): string;
  author(row: number): FindAuthor;
}

export interface FindAuthor {
  name: string;
  email: string;
}

/** A ref badge as Find reads it. */
export interface FindBadge {
  kind: Badge["kind"];
  name: string;
}

/**
 * Whether Find searches `badge`'s name: a branch, remote branch or tag does, but a worktree HEAD
 * marker names its folder, not a ref, so it doesn't. Matching and highlighting both ask this.
 */
export function isFindable(badge: FindBadge): boolean {
  return badge.kind !== "head";
}

/** What a query searches for: its text trimmed and lowered, or "" when it finds nothing. */
export function findNeedle(text: string): string {
  return text.trim().toLowerCase();
}

export class FindScan {
  private readonly needle: string;
  private buffer = new Int32Array(64);
  private count = 0;
  private next = 0;
  private readonly authors = new Map<FindAuthor, boolean>();

  /** The commits a matching ref name is on, found once from the few refs rather than per row. */
  private readonly refOids = new Set<string>();

  constructor(text: string, refs: ReadonlyMap<string, readonly FindBadge[]>) {
    this.needle = findNeedle(text);
    for (const [oid, badges] of refs) {
      if (badges.some((b) => isFindable(b) && b.name.toLowerCase().includes(this.needle))) this.refOids.add(oid);
    }
  }

  /**
   * Whether `author` matches, decided once per author: the store shares one object per author,
   * so a history of a million rows tests its few thousand authors, not a million names.
   */
  private authorMatches(author: FindAuthor): boolean {
    const known = this.authors.get(author);
    if (known !== undefined) return known;
    const hit = author.name.toLowerCase().includes(this.needle) || author.email.toLowerCase().includes(this.needle);
    this.authors.set(author, hit);
    return hit;
  }

  get matches(): Int32Array {
    return this.buffer.subarray(0, this.count);
  }

  scan(rows: FindRows, budget: number): boolean {
    if (this.needle === "") return true;
    const end = Math.min(rows.rowCount, this.next + budget);
    for (let row = this.next; row < end; row++) {
      if (
        // Oids are lowercase hex, so the lowered needle compares as it is.
        rows.oid(row).startsWith(this.needle) ||
        this.refOids.has(rows.oid(row)) ||
        this.authorMatches(rows.author(row)) ||
        rows.subject(row).toLowerCase().includes(this.needle)
      ) {
        if (this.count === this.buffer.length) {
          const next = new Int32Array(this.buffer.length * 2);
          next.set(this.buffer);
          this.buffer = next;
        }
        this.buffer[this.count++] = row;
      }
    }
    this.next = end;
    return end === rows.rowCount;
  }
}

/** The index of the first of the sorted `matches` greater than `row`, or their count when none is. */
function firstAbove(matches: ArrayLike<number>, row: number): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid] <= row) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The row Next (`1`) or Previous (`-1`) moves to from the selected `row` (null for none) among the
 * sorted `matches`: the nearest match past it in that direction, wrapping at the ends. Null when
 * nothing matches.
 */
export function steppedMatch(matches: ArrayLike<number>, row: number | null, direction: 1 | -1): number | null {
  const n = matches.length;
  if (n === 0) return null;
  if (row === null) return matches[direction === 1 ? 0 : n - 1];
  if (direction === 1) {
    const i = firstAbove(matches, row);
    return matches[i === n ? 0 : i];
  }
  // The last match below `row`: one before the first match at or past it.
  const i = firstAbove(matches, row - 1) - 1;
  return matches[i < 0 ? n - 1 : i];
}

/** The index of `row` among the sorted `matches`, or -1 when it isn't one. */
function matchIndex(matches: ArrayLike<number>, row: number): number {
  const i = firstAbove(matches, row) - 1;
  return i >= 0 && matches[i] === row ? i : -1;
}

/** Whether `row` is among the sorted `matches`; a binary search, so rows keep no find state. */
export function isMatch(matches: ArrayLike<number>, row: number): boolean {
  return matchIndex(matches, row) !== -1;
}

/**
 * The find counter: "3 of 41" while the selected `row` is a match, otherwise the total, with
 * "so far" while `scanning` hasn't reached the last loaded row.
 */
export function findCounter(matches: ArrayLike<number>, row: number | null, scanning: boolean): string {
  const n = matches.length;
  if (n === 0) return scanning ? "Searching…" : "No matches";
  const at = row === null ? -1 : matchIndex(matches, row);
  const text = at === -1 ? `${n.toLocaleString()} ${n === 1 ? "match" : "matches"}` : `${(at + 1).toLocaleString()} of ${n.toLocaleString()}`;
  return scanning ? `${text} so far` : text;
}

/** A run of a row's text, found by the query or not. */
export interface FindPart {
  text: string;
  hit: boolean;
}

/**
 * `text` split into the runs `query` finds and the runs between, for highlighting by text nodes
 * rather than markup. A text whose lowercase differs in length (a dotted capital I, say) can't map
 * its matches back, so it stays whole; its row still counts as a match.
 */
export function findParts(text: string, query: string): FindPart[] {
  const needle = findNeedle(query);
  const lower = text.toLowerCase();
  if (needle === "" || lower.length !== text.length) return [{ text, hit: false }];
  const parts: FindPart[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length || parts.length === 0) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

interface KeyPress {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type FindKey = "open" | "next" | "previous";

/** A keydown as Topos hands it to the find, with the element it came from. */
export interface FindKeyEvent extends KeyPress {
  target: EventTarget | null;
}

/**
 * What a key does to the find, or null for a key it leaves alone. Ctrl+F (Cmd+F on a Mac) opens
 * it and F3 and Shift+F3 step from anywhere in Topos; Enter and Shift+Enter step from the find
 * field, `inFindField`. Escape belongs to the overlay stack, which closes the find first.
 */
export function findKey(e: KeyPress, inFindField: boolean): FindKey | null {
  if (e.altKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) return !e.shiftKey && e.key.toLowerCase() === "f" ? "open" : null;
  if (e.key === "F3") return e.shiftKey ? "previous" : "next";
  if (e.key === "Enter" && inFindField) return e.shiftKey ? "previous" : "next";
  return null;
}
