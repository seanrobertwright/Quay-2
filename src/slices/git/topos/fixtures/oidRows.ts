// Test support: rows for the oid scans in Find and deep search, either plain strings or a real
// graph store that counts every oid it builds.

import type { OidRows } from "../graphFind.ts";
import { decodeGraphPage } from "../graphPage.ts";
import { GraphStore } from "../graphStore.ts";
import { encodeTestPage } from "./encodeTestPage.ts";

/** `rows` with the prefix and set tests answered by reading each row's oid string. */
export function withStringOids<R extends { readonly rowCount: number; oid(row: number): string }>(rows: R): R & OidRows {
  return Object.assign(rows, {
    hasOidPrefix: (row: number, prefix: string) => rows.oid(row).startsWith(prefix),
    oidMatcher: (oids: Iterable<string>) => {
      const wanted = new Set(oids);
      return (row: number) => wanted.has(rows.oid(row));
    },
  });
}

/**
 * A graph store of `rowCount` rows, each named by its row number in hex (row 0x1a2 is 00…01a2),
 * and how many times a scan has asked it to build a row's oid.
 */
export function countingStore(rowCount = 1000): { rows: GraphStore; built: () => number } {
  const store = new GraphStore(1);
  store.ingest(decodeGraphPage(encodeTestPage({ sessionId: 1, pageIndex: 0, firstRow: 0, rowCount })));
  let built = 0;
  const rows = new Proxy(store, {
    get(target, key) {
      if (key === "oid") built++;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { rows, built: () => built };
}
