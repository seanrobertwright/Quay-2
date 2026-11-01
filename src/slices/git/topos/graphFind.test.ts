/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { findCounter, findKey, findParts, FindScan, isFindable, isMatch, steppedMatch, type FindBadge, type FindRows } from "./graphFind.ts";
import { countingStore, withStringOids } from "./fixtures/oidRows.ts";

interface Row {
  oid: string;
  subject: string;
  author: { name: string; email: string };
}

const ada = { name: "Ada Lovelace", email: "ada@example.com" };
const bob = { name: "Bob Ross", email: "bob@paint.test" };

function rowsOf(rows: Row[]): FindRows {
  return withStringOids({
    rowCount: rows.length,
    oid: (r: number) => rows[r].oid,
    subject: (r: number) => rows[r].subject,
    author: (r: number) => rows[r].author,
  });
}

const HISTORY: Row[] = [
  { oid: "a1b2c3d4e5", subject: "Add the parser", author: ada },
  { oid: "ff00ee11dd", subject: "Fix the build (again)", author: bob },
  { oid: "0123456789", subject: "Parse dates through the helper", author: ada },
  { oid: "deadbeef00", subject: "Release v1.0", author: bob },
];

/** The rows `text` finds in `rows`, scanned in one go. */
function find(text: string, rows: Row[] = HISTORY, refs: ReadonlyMap<string, readonly FindBadge[]> = new Map()): number[] {
  const scan = new FindScan(text, refs);
  scan.scan(rowsOf(rows), Infinity);
  return [...scan.matches];
}

test("Find matches a row by its subject", () => {
  assert.deepEqual(find("build"), [1]);
});

test("Find ignores case in the text and in the query", () => {
  assert.deepEqual(find("PARSE"), [0, 2]);
});

test("Find matches a row by its author's name or email", () => {
  assert.deepEqual(find("lovelace"), [0, 2]);
  assert.deepEqual(find("paint.test"), [1, 3]);
});

test("Find matches a row by a prefix of its SHA, in either case, but not by the middle of it", () => {
  assert.deepEqual(find("DEADB"), [3]);
  assert.deepEqual(find("beef"), []);
});

test("Find matches a row by the name of a branch, remote branch or tag on it", () => {
  const refs = new Map<string, FindBadge[]>([
    ["ff00ee11dd", [{ kind: "local", name: "feature/Login" }]],
    ["0123456789", [{ kind: "remote", name: "origin/main" }]],
    ["deadbeef00", [{ kind: "tag", name: "v1.0-rc" }]],
  ]);
  assert.deepEqual(find("login", HISTORY, refs), [1]);
  assert.deepEqual(find("origin/", HISTORY, refs), [2]);
  assert.deepEqual(find("-rc", HISTORY, refs), [3]);
});

test("Find leaves out a worktree HEAD marker, which names a folder rather than a ref", () => {
  const refs = new Map<string, FindBadge[]>([["a1b2c3d4e5", [{ kind: "head", name: "scratch-tree" }]]]);
  assert.deepEqual(find("scratch", HISTORY, refs), []);
});

test("Find searches the name of a branch, remote branch or tag badge, not a worktree HEAD marker", () => {
  assert.equal(isFindable({ kind: "local", name: "main" }), true);
  assert.equal(isFindable({ kind: "remote", name: "origin/main" }), true);
  assert.equal(isFindable({ kind: "tag", name: "v1.0" }), true);
  assert.equal(isFindable({ kind: "head", name: "scratch-tree" }), false);
});

test("Find takes regex metacharacters as literal text", () => {
  assert.deepEqual(find("(again)"), [1]);
  assert.deepEqual(find("v1.0"), [3]);
  assert.deepEqual(find("v1x0"), []);
  assert.deepEqual(find(".*"), []);
  assert.deepEqual(find("[a-z]"), []);
});

test("An empty or blank query finds nothing", () => {
  assert.deepEqual(find(""), []);
  assert.deepEqual(find("   "), []);
});

test("Find keeps every match however many rows match", () => {
  const many: Row[] = Array.from({ length: 5000 }, (_, i) => ({ oid: `${i}`.padStart(10, "f"), subject: `step ${i}`, author: ada }));
  const found = find("step", many);
  assert.equal(found.length, 5000);
  assert.equal(found[4999], 4999);
});

test("Rows loaded after the query are matched as they arrive, and the rows before aren't matched twice", () => {
  const loaded = HISTORY.slice(0, 2);
  const scan = new FindScan("parse", new Map());
  assert.equal(scan.scan(rowsOf(loaded), Infinity), true);
  assert.deepEqual([...scan.matches], [0]);
  loaded.push(...HISTORY.slice(2));
  assert.equal(scan.scan(rowsOf(loaded), Infinity), true);
  assert.deepEqual([...scan.matches], [0, 2]);
});

test("A scan given a row budget stops there and carries on from it, so it can yield and be dropped", () => {
  const scan = new FindScan("a", new Map());
  assert.equal(scan.scan(rowsOf(HISTORY), 3), false);
  assert.deepEqual([...scan.matches], [0, 1, 2]);
  assert.equal(scan.scan(rowsOf(HISTORY), 3), true);
  assert.deepEqual([...scan.matches], [0, 1, 2, 3]);
});

/** Find's budget for one query over a million loaded rows, on the test machine. */
const MILLION_ROW_BUDGET_MS = 1500;

test(`matching 1M synthetic rows takes under ${MILLION_ROW_BUDGET_MS} ms`, () => {
  const ROWS = 1_000_000;
  const authors = Array.from({ length: 2000 }, (_, i) => ({ name: `Author ${i}`, email: `a${i}@example.com` }));
  const oids = Array.from({ length: ROWS }, (_, i) => (i * 2654435761 >>> 0).toString(16).padStart(8, "0") + "deadbeefcafebabe0123456789abcdef");
  const subjects = Array.from({ length: ROWS }, (_, i) => `Change ${i}: tidy the module and update its tests`);
  const rows: FindRows = withStringOids({
    rowCount: ROWS,
    oid: (r: number) => oids[r],
    subject: (r: number) => subjects[r],
    author: (r: number) => authors[r % authors.length],
  });
  const refs = new Map<string, FindBadge[]>([[oids[10], [{ kind: "local", name: "main" }]]]);
  const started = performance.now();
  const scan = new FindScan("change 99999", refs);
  assert.equal(scan.scan(rows, Infinity), true);
  const elapsed = performance.now() - started;
  // "Change 99999" and "Change 999990" to "Change 999999".
  assert.equal(scan.matches.length, 11);
  assert.ok(elapsed < MILLION_ROW_BUDGET_MS, `took ${elapsed.toFixed(0)} ms`);
  console.log(`1M rows matched in ${elapsed.toFixed(0)} ms`);
});

const MATCHES = Int32Array.from([3, 8, 20]);

test("Next steps to the first match below the selected row and wraps from the last to the first", () => {
  assert.equal(steppedMatch(MATCHES, 3, 1), 8);
  assert.equal(steppedMatch(MATCHES, 10, 1), 20);
  assert.equal(steppedMatch(MATCHES, 20, 1), 3);
  assert.equal(steppedMatch(MATCHES, 25, 1), 3);
});

test("Previous steps to the first match above the selected row and wraps from the first to the last", () => {
  assert.equal(steppedMatch(MATCHES, 20, -1), 8);
  assert.equal(steppedMatch(MATCHES, 10, -1), 8);
  assert.equal(steppedMatch(MATCHES, 3, -1), 20);
  assert.equal(steppedMatch(MATCHES, 0, -1), 20);
});

test("With no row selected, Next goes to the first match and Previous to the last", () => {
  assert.equal(steppedMatch(MATCHES, null, 1), 3);
  assert.equal(steppedMatch(MATCHES, null, -1), 20);
});

test("Stepping with no matches goes nowhere, and one match steps to itself", () => {
  assert.equal(steppedMatch(new Int32Array(0), 4, 1), null);
  assert.equal(steppedMatch(Int32Array.from([5]), 5, 1), 5);
  assert.equal(steppedMatch(Int32Array.from([5]), 5, -1), 5);
});

test("The counter says which match the selected row is, out of all of them", () => {
  assert.equal(findCounter(MATCHES, 8, false), "2 of 3");
  assert.equal(findCounter(MATCHES, 3, false), "1 of 3");
});

test("The counter gives just the total while the selected row isn't a match", () => {
  assert.equal(findCounter(MATCHES, 9, false), "3 matches");
  assert.equal(findCounter(MATCHES, null, false), "3 matches");
  assert.equal(findCounter(Int32Array.from([1]), null, false), "1 match");
  assert.equal(findCounter(Int32Array.from(Array.from({ length: 1234 }, (_, i) => i)), 1000, false), "1,001 of 1,234");
});

test("The counter says when nothing matches, and that it is still looking while a scan runs", () => {
  assert.equal(findCounter(new Int32Array(0), null, false), "No matches");
  assert.equal(findCounter(new Int32Array(0), null, true), "Searching…");
  assert.equal(findCounter(MATCHES, 8, true), "2 of 3 so far");
});

test("A row looks up whether it matches by its index", () => {
  assert.deepEqual([0, 3, 4, 8, 19, 20, 21].map((r) => isMatch(MATCHES, r)), [false, true, false, true, false, true, false]);
});

test("A matched text splits into its plain and found parts, keeping the text's own case", () => {
  assert.deepEqual(findParts("Parse the PARSER", "parse"), [
    { text: "Parse", hit: true },
    { text: " the ", hit: false },
    { text: "PARSE", hit: true },
    { text: "R", hit: false },
  ]);
});

test("A text without the query, or an empty query, is one plain part", () => {
  assert.deepEqual(findParts("Fix the build", "parse"), [{ text: "Fix the build", hit: false }]);
  assert.deepEqual(findParts("Fix the build", " "), [{ text: "Fix the build", hit: false }]);
});

test("Markup in a commit's text stays text in its parts", () => {
  assert.deepEqual(findParts("<img src=x onerror=alert(1)>", "img"), [
    { text: "<", hit: false },
    { text: "img", hit: true },
    { text: " src=x onerror=alert(1)>", hit: false },
  ]);
});

test("A text whose lowercase changes length is left whole rather than split in the wrong place", () => {
  assert.deepEqual(findParts("İstanbul fix", "fix"), [{ text: "İstanbul fix", hit: false }]);
});

const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test("Ctrl+F, or Cmd+F on a Mac, opens the find from anywhere in Topos", () => {
  assert.equal(findKey(key("f", { ctrlKey: true }), false), "open");
  assert.equal(findKey(key("F", { ctrlKey: true }), true), "open");
  assert.equal(findKey(key("f", { metaKey: true }), false), "open");
  assert.equal(findKey(key("f", { ctrlKey: true, shiftKey: true }), false), null);
  assert.equal(findKey(key("f", { ctrlKey: true, altKey: true }), false), null);
  assert.equal(findKey(key("f"), false), null);
});

test("F3 and Shift+F3 step through the matches from anywhere", () => {
  assert.equal(findKey(key("F3"), false), "next");
  assert.equal(findKey(key("F3", { shiftKey: true }), true), "previous");
  assert.equal(findKey(key("F3", { ctrlKey: true }), false), null);
});

test("Enter and Shift+Enter step through the matches only in the find field", () => {
  assert.equal(findKey(key("Enter"), true), "next");
  assert.equal(findKey(key("Enter", { shiftKey: true }), true), "previous");
  assert.equal(findKey(key("Enter"), false), null);
  assert.equal(findKey(key("Enter", { ctrlKey: true }), true), null);
});

test("Find over the graph store matches by SHA prefix and ref without building any row's oid", () => {
  const { rows, built } = countingStore();
  const refs = new Map<string, FindBadge[]>([["00000000000000000000000000000000000003e7", [{ kind: "tag", name: "zebra" }]]]);
  const byPrefix = new FindScan("0000000000000000000000000000000000000" + "1A", refs);
  assert.equal(byPrefix.scan(rows, 2000), true);
  assert.deepEqual([...byPrefix.matches], [0x1a0, 0x1a1, 0x1a2, 0x1a3, 0x1a4, 0x1a5, 0x1a6, 0x1a7, 0x1a8, 0x1a9, 0x1aa, 0x1ab, 0x1ac, 0x1ad, 0x1ae, 0x1af]);
  const byRef = new FindScan("zebra", refs);
  byRef.scan(rows, 2000);
  assert.deepEqual([...byRef.matches], [999]);
  assert.equal(built(), 0);
});
