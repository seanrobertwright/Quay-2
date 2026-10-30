// Decodes a `Rows` page of a Topos graph session (#369). The layout is documented, and encoded, in
// `src-tauri/src/slices/git/graph/page.rs`; `fixtures/graph-page-v1.bin` is a page Rust encoded.

/** "TGPG" read as a little-endian u32. */
export const PAGE_MAGIC = 0x47504754;
export const PAGE_FORMAT_VERSION = 1;
const MIN_HEADER_BYTES = 48;

/** An author in a session's author table. */
export interface GraphAuthor {
  name: string;
  email: string;
}

export interface GraphPage {
  sessionId: number;
  /** From 0 within the session. */
  pageIndex: number;
  /** The session-wide index of the page's first row. */
  firstRow: number;
  rowCount: number;
  /** Epoch milliseconds, one per row. */
  authorTimeMs: Float64Array;
  /** Indexes into the session's author table, one per row. */
  authorIds: Uint32Array;
  oids: string[];
  subjects: string[];
  /** Authors this page adds to the session's table, in id order. */
  newAuthors: GraphAuthor[];
}

export class GraphPageError extends Error {}

function isStringArray(value: unknown, length: number): value is string[] {
  return Array.isArray(value) && value.length === length && value.every((v) => typeof v === "string");
}

function isAuthorArray(value: unknown): value is GraphAuthor[] {
  return (
    Array.isArray(value) &&
    value.every(
      (a) => typeof a === "object" && a !== null && typeof a.name === "string" && typeof a.email === "string"
    )
  );
}

/**
 * Decodes one page. Throws a `GraphPageError` for an unknown magic or format version, or for a page
 * whose sections don't fit the buffer. The typed arrays are views on `buffer`, not copies.
 */
export function decodeGraphPage(buffer: ArrayBuffer): GraphPage {
  if (buffer.byteLength < MIN_HEADER_BYTES) throw new GraphPageError(`a graph page is at least ${MIN_HEADER_BYTES} bytes`);
  const view = new DataView(buffer);
  const u32 = (at: number) => view.getUint32(at, true);
  const magic = u32(0);
  if (magic !== PAGE_MAGIC) throw new GraphPageError(`not a graph page (magic 0x${magic.toString(16)})`);
  const version = view.getUint16(4, true);
  if (version !== PAGE_FORMAT_VERSION) {
    throw new GraphPageError(`graph page format ${version} is not supported (expected ${PAGE_FORMAT_VERSION})`);
  }
  const headerBytes = view.getUint16(6, true);
  if (headerBytes < MIN_HEADER_BYTES) throw new GraphPageError(`a graph page header is at least ${MIN_HEADER_BYTES} bytes`);
  const rowCount = u32(20);
  if (u32(24) !== 0 || u32(28) !== 0) throw new GraphPageError("format 1 pages carry no edges");

  const section = (at: number, bytesPerRow: number, align: number) => {
    const offset = u32(at);
    if (offset < headerBytes || offset % align !== 0 || offset + rowCount * bytesPerRow > buffer.byteLength) {
      throw new GraphPageError("a graph page section lies outside the page");
    }
    return offset;
  };
  const authorTimeMs = new Float64Array(buffer, section(32, 8, 8), rowCount);
  const authorIds = new Uint32Array(buffer, section(36, 4, 4), rowCount);
  const jsonAt = u32(40);
  const jsonLength = u32(44);
  if (jsonAt < headerBytes || jsonAt + jsonLength > buffer.byteLength) {
    throw new GraphPageError("the graph page's JSON lies outside the page");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buffer, jsonAt, jsonLength)));
  } catch (e) {
    throw new GraphPageError(`the graph page's JSON doesn't parse: ${String(e)}`);
  }
  const { oids, subjects, newAuthors } = (json ?? {}) as Record<string, unknown>;
  if (!isStringArray(oids, rowCount) || !isStringArray(subjects, rowCount) || !isAuthorArray(newAuthors)) {
    throw new GraphPageError("the graph page's JSON doesn't match its rows");
  }
  return {
    sessionId: u32(8),
    pageIndex: u32(12),
    firstRow: u32(16),
    rowCount,
    authorTimeMs,
    authorIds,
    oids,
    subjects,
    newAuthors,
  };
}
