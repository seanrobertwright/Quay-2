/// <reference types="node" />
// Find's scale gate. It is not a `*.test.ts` file on purpose: `pnpm test` runs every test file in
// parallel, and a memory-bound million-row scan then runs 3 to 4 times slower than it does alone,
// which put its 1500 ms budget at the edge. `pnpm test` runs this file afterwards, by itself
// (`test:budget`), so the budget measures Find and not the other test files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FindScan, type FindBadge, type FindRows } from "./graphFind.ts";
import { withStringOids } from "./fixtures/oidRows.ts";

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
