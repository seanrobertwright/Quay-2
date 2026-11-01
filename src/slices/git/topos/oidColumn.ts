// The graph store's oids (#410): one per row, held as bytes in one typed array rather than as a
// string per row, and turned back into hex only when a caller asks for one.

const HEX_DIGITS = "0123456789abcdef";

/** Each ASCII code's hex digit value, or -1. Only lowercase digits count: git writes oids so. */
const DIGIT_VALUES = (() => {
  const values = new Int8Array(128).fill(-1);
  for (let i = 0; i < HEX_DIGITS.length; i++) values[HEX_DIGITS.charCodeAt(i)] = i;
  return values;
})();

function digitValue(code: number): number {
  return code < 128 ? DIGIT_VALUES[code] : -1;
}

/** Bytes in a SHA-1 oid and in a SHA-256 one. */
const SHA1_BYTES = 20;
const SHA256_BYTES = 32;

/**
 * One oid per row: 20 bytes a row for SHA-1 and 32 for SHA-256, where a string per row costs
 * about three times that. A repository uses one hash, so the first oid fixes the width and an oid
 * of the other width is refused. Every read but `hex` compares bytes with the caller's hex in
 * place, so a scan over the rows builds no string per row.
 */
export class OidColumn {
  /** Bytes per oid, 0 until the first oid sets it. */
  private width = 0;
  private bytes = new Uint8Array(0);
  /** Rows the bytes have room for once the width is known. */
  private rows = 0;
  /** The bytes of the oid `indexOf` looks for, so a lookup allocates nothing per row. */
  private readonly needle = new Uint8Array(SHA256_BYTES);
  /** Char codes for `hex`, one oid's worth. */
  private chars: number[] = [];

  /** Rows there is room for. */
  get capacity(): number {
    return this.rows;
  }

  /** Bytes held, slack included. */
  get byteLength(): number {
    return this.bytes.byteLength;
  }

  /** Makes room for exactly `rows` rows, keeping the first `keep`. Less room trims the slack. */
  resize(rows: number, keep: number): void {
    this.rows = rows;
    if (this.width === 0) return;
    const next = new Uint8Array(rows * this.width);
    next.set(this.bytes.subarray(0, Math.min(keep, rows) * this.width));
    this.bytes = next;
  }

  private setWidth(width: number): void {
    this.width = width;
    this.chars = new Array<number>(width * 2);
    this.bytes = new Uint8Array(this.rows * width);
  }

  /**
   * Throws unless every one of `oids` is 40 or 64 lowercase hex digits, all as wide as the oids
   * already held, or as the first of them when none are. Changes nothing, so a caller can check a
   * whole page before it stores any of it.
   */
  check(oids: readonly string[]): void {
    if (oids.length === 0) return;
    const digits = this.width === 0 ? oids[0].length : this.width * 2;
    if (this.width === 0 && digits !== SHA1_BYTES * 2 && digits !== SHA256_BYTES * 2) {
      throw new Error(`"${oids[0]}" is not an oid: an oid is 40 or 64 hex digits`);
    }
    for (const oid of oids) {
      if (oid.length !== digits) throw new Error(`"${oid}" is not a ${digits}-digit oid like the rows before it`);
      for (let i = 0; i < digits; i++) {
        if (digitValue(oid.charCodeAt(i)) < 0) throw new Error(`"${oid}" is not an oid: it isn't lowercase hex`);
      }
    }
  }

  /** Stores `oid` at `row`. Throws when `check` would refuse it. */
  set(row: number, oid: string): void {
    if (this.width === 0) {
      this.check([oid]);
      this.setWidth(oid.length / 2);
    }
    if (!this.parse(oid, this.bytes, row * this.width)) this.check([oid]);
  }

  /** Writes `oid`'s bytes into `out` at `at`; false when it isn't hex of this column's width. */
  private parse(oid: string, out: Uint8Array, at: number): boolean {
    if (oid.length !== this.width * 2) return false;
    for (let i = 0; i < this.width; i++) {
      const high = digitValue(oid.charCodeAt(2 * i));
      const low = digitValue(oid.charCodeAt(2 * i + 1));
      if (high < 0 || low < 0) return false;
      out[at + i] = (high << 4) | low;
    }
    return true;
  }

  /** The oid at `row` as lowercase hex, built on each call. */
  hex(row: number): string {
    const chars = this.chars;
    const b = this.bytes;
    for (let i = 0, at = row * this.width; i < this.width; i++, at++) {
      chars[2 * i] = HEX_DIGITS.charCodeAt(b[at] >> 4);
      chars[2 * i + 1] = HEX_DIGITS.charCodeAt(b[at] & 15);
    }
    return String.fromCharCode(...chars);
  }

  /** Whether the oid at `row` begins with the lowercase hex `prefix`; "" begins every oid. */
  startsWith(row: number, prefix: string): boolean {
    if (prefix.length > this.width * 2) return false;
    const b = this.bytes;
    const at = row * this.width;
    for (let i = 0; i < prefix.length; i++) {
      const byte = b[at + (i >> 1)];
      if (digitValue(prefix.charCodeAt(i)) !== (i & 1 ? byte & 15 : byte >> 4)) return false;
    }
    return true;
  }

  /** Whether the oid at `row` is `oid`. */
  equals(row: number, oid: string): boolean {
    return this.width > 0 && oid.length === this.width * 2 && this.startsWith(row, oid);
  }

  /** The first of rows 0 up to `rows` whose oid is `oid`, or -1. */
  indexOf(oid: string, rows: number): number {
    const w = this.width;
    const needle = this.needle;
    if (w === 0 || !this.parse(oid, needle, 0)) return -1;
    const b = this.bytes;
    next: for (let row = 0, at = 0; row < rows; row++, at += w) {
      for (let i = 0; i < w; i++) if (b[at + i] !== needle[i]) continue next;
      return row;
    }
    return -1;
  }

  /** The first four bytes of the oid at `row` as a number, which `leadOf` gives for hex. */
  lead(row: number): number {
    const b = this.bytes;
    const at = row * this.width;
    return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  }

  /** Copies row `from` of `source` to row `to` here. Throws when the two hold oids of other widths. */
  copyRow(source: OidColumn, from: number, to: number): void {
    if (source.width === 0) return;
    if (this.width === 0) this.setWidth(source.width);
    if (source.width !== this.width) {
      throw new Error(`a refresh's ${this.width * 2}-digit oids can't join rows of ${source.width * 2}-digit ones`);
    }
    const w = this.width;
    this.bytes.set(source.bytes.subarray(from * w, (from + 1) * w), to * w);
  }
}

/** The first four bytes of the hex `oid` as `OidColumn.lead` gives them, or null when it isn't hex. */
export function leadOf(oid: string): number | null {
  if (oid.length < 8) return null;
  let lead = 0;
  for (let i = 0; i < 8; i++) {
    const v = digitValue(oid.charCodeAt(i));
    if (v < 0) return null;
    lead = lead * 16 + v;
  }
  return lead;
}
