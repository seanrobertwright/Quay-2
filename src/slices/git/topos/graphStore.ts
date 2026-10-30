// The frontend copy of one graph session's rows (#370): per-row numbers live in typed arrays that
// grow by doubling, never per page, so ingesting a page stays cheap at a million rows.

import type { GraphAuthor, GraphPage } from "./graphPage.ts";

const INITIAL_CAPACITY = 1024;

function grown<T extends Float64Array | Uint32Array>(array: T, needed: number, make: (n: number) => T): T {
  if (needed <= array.length) return array;
  let capacity = array.length;
  while (capacity < needed) capacity *= 2;
  const next = make(capacity);
  next.set(array);
  return next;
}

export class GraphStore {
  /** The session these rows belong to. */
  readonly sessionId: number;
  private count = 0;
  private nextPage = 0;
  private authorTimes = new Float64Array(INITIAL_CAPACITY);
  private authorIdsByRow = new Uint32Array(INITIAL_CAPACITY);
  private readonly oids: string[] = [];
  private readonly subjects: string[] = [];
  private readonly authors: GraphAuthor[] = [];

  constructor(sessionId: number) {
    this.sessionId = sessionId;
  }

  get rowCount(): number {
    return this.count;
  }

  /** Capacity of the typed arrays, which only ever doubles. */
  get capacity(): number {
    return this.authorTimes.length;
  }

  /**
   * Appends a page. Throws when the page belongs to another session, or doesn't follow the last one
   * exactly, since rows already shown never move.
   */
  ingest(page: GraphPage): void {
    if (page.sessionId !== this.sessionId) {
      throw new Error(`page of session ${page.sessionId} given to the store of session ${this.sessionId}`);
    }
    if (page.pageIndex !== this.nextPage || page.firstRow !== this.count) {
      throw new Error(
        `expected page ${this.nextPage} at row ${this.count}, got page ${page.pageIndex} at row ${page.firstRow}`
      );
    }
    for (const id of page.authorIds) {
      if (id >= this.authors.length + page.newAuthors.length) throw new Error(`page names unknown author ${id}`);
    }
    const end = this.count + page.rowCount;
    this.authorTimes = grown(this.authorTimes, end, (n) => new Float64Array(n));
    this.authorIdsByRow = grown(this.authorIdsByRow, end, (n) => new Uint32Array(n));
    this.authorTimes.set(page.authorTimeMs, this.count);
    this.authorIdsByRow.set(page.authorIds, this.count);
    for (let i = 0; i < page.rowCount; i++) {
      this.oids.push(page.oids[i]);
      this.subjects.push(page.subjects[i]);
    }
    for (const author of page.newAuthors) this.authors.push(author);
    this.count = end;
    this.nextPage++;
  }

  oid(row: number): string {
    return this.oids[row];
  }

  subject(row: number): string {
    return this.subjects[row];
  }

  author(row: number): GraphAuthor {
    return this.authors[this.authorIdsByRow[row]];
  }

  /** Epoch milliseconds. */
  authorTimeMs(row: number): number {
    return this.authorTimes[row];
  }
}
