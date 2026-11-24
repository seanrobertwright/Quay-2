// Keys for what a container draws, told by the data each row is of and not by where it is: a row that
// moves stays the one it was, and so does one that is typed in.
import { useState } from "react";

interface Keyed {
  /** What each row is of, as text. */
  rows: readonly string[];
  keys: readonly string[];
}

const NONE: Keyed = { rows: [], keys: [] };

/**
 * The keys of `rows`, which were `before`. A row keeps its key where it is, or else where its data was
 * before, or else when only its data has changed. Any other gets a key made of its data.
 */
function keysOf(before: Keyed, rows: readonly string[]): string[] {
  const keys = rows.map((row, i): string | null => (before.rows[i] === row ? before.keys[i] : null));
  const left = new Set(before.keys.filter((_, i) => keys[i] !== before.keys[i]));
  const moved = new Map<string, string[]>();
  before.rows.forEach((row, i) => {
    const key = before.keys[i];
    if (!left.has(key)) return;
    const same = moved.get(row);
    if (same) same.push(key);
    else moved.set(row, [key]);
  });
  rows.forEach((row, i) => {
    const key = keys[i] === null ? moved.get(row)?.shift() : undefined;
    if (key !== undefined && left.delete(key)) keys[i] = key;
  });
  rows.forEach((_, i) => {
    if (keys[i] === null && left.delete(before.keys[i])) keys[i] = before.keys[i];
  });
  const used = new Set([...before.keys]);
  const next = new Map<string, number>();
  return keys.map((kept, i) => {
    if (kept !== null) return kept;
    const row = rows[i];
    let n = next.get(row) ?? 0;
    while (used.has(JSON.stringify([row, n]))) n += 1;
    next.set(row, n + 1);
    return JSON.stringify([row, n]);
  });
}

/** A key for each of `rows`, each of which says what its row is of. No two have the same. */
export function useRowKeys(rows: readonly string[]): readonly string[] {
  const [kept, setKept] = useState(() => ({ rows, keys: keysOf(NONE, rows) }));
  if (kept.rows.length === rows.length && kept.rows.every((row, i) => row === rows[i])) return kept.keys;
  const next = { rows, keys: keysOf(kept, rows) };
  setKept(next);
  return next.keys;
}
