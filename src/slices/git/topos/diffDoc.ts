// The diff view's documents (#383): one file's diff as the text and line facts a read-only
// CodeMirror view shows, unified or split. Diff text is untrusted; it only ever becomes document
// text, never markup.

/** `DiffSide` from `src-tauri/src/slices/git/diff.rs`. */
export type DiffSide = { kind: "unstaged" } | { kind: "staged" } | { kind: "commit"; oid: string; parent: string | null };

/** `FileChange` from `src-tauri/src/slices/git/diff.rs`. */
export type FileChange = "modified" | "added" | "deleted" | "untracked" | "unchanged";

/** `LineKind` from `src-tauri/src/slices/git/diff.rs`. */
export type LineKind = "context" | "add" | "del" | "noNewline";

/** `Hunk` from `src-tauri/src/slices/git/diff.rs`. */
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading: string;
  /** Each line without its marker or `\n`; a CR before the `\n` stays. */
  lines: { kind: LineKind; text: string }[];
}

/** `FileDiff` from `src-tauri/src/slices/git/diff.rs`. */
export interface FileDiff {
  requestId: number;
  path: string;
  diffToken: string;
  change: FileChange;
  binary: boolean;
  submodule: boolean;
  tooLarge: boolean;
  bytes: number;
  lineCount: number;
  modeChange: { oldMode: string; newMode: string } | null;
  oldOid: string | null;
  newOid: string | null;
  hunks: Hunk[];
}

/** One line of a doc; `filler` pads a split side so its rows line up with the other's. */
export interface DocLine {
  kind: LineKind | "filler";
  oldNo: number | null;
  newNo: number | null;
  /** The index of the hunk the line belongs to. */
  hunk: number;
}

export interface DiffDoc {
  text: string;
  lines: DocLine[];
  /** The doc line, from 0, where each hunk starts. */
  hunkStarts: number[];
}

/** How a CR shows: a visible mark, so it neither splits a line nor disappears. */
const CR_MARK = "␍";

function shown(kind: LineKind, text: string): string {
  const visible = text.split("\r").join(CR_MARK);
  return kind === "noNewline" ? `\\${visible}` : visible;
}

/** Every line of every hunk, deletions and additions interleaved as git printed them. */
export function unifiedDoc(diff: FileDiff): DiffDoc {
  const texts: string[] = [];
  const lines: DocLine[] = [];
  const hunkStarts: number[] = [];
  diff.hunks.forEach((h, hunk) => {
    hunkStarts.push(lines.length);
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const l of h.lines) {
      texts.push(shown(l.kind, l.text));
      switch (l.kind) {
        case "context":
          lines.push({ kind: l.kind, oldNo: oldNo++, newNo: newNo++, hunk });
          break;
        case "del":
          lines.push({ kind: l.kind, oldNo: oldNo++, newNo: null, hunk });
          break;
        case "add":
          lines.push({ kind: l.kind, oldNo: null, newNo: newNo++, hunk });
          break;
        case "noNewline":
          lines.push({ kind: l.kind, oldNo: null, newNo: null, hunk });
      }
    }
  });
  return { text: texts.join("\n"), lines, hunkStarts };
}

interface Row {
  text: string;
  line: DocLine;
}

/**
 * The old side on the left and the new side on the right, row for row. Context shows on both; a
 * run of deletions sits beside the run of additions that follows it, and the shorter run is padded
 * with filler rows. A no-newline marker stays on the side of the line it follows.
 */
export function splitDoc(diff: FileDiff): { left: DiffDoc; right: DiffDoc; hunkStarts: number[] } {
  const left: Row[] = [];
  const right: Row[] = [];
  const hunkStarts: number[] = [];
  diff.hunks.forEach((h, hunk) => {
    hunkStarts.push(left.length);
    const filler = (): Row => ({ text: "", line: { kind: "filler", oldNo: null, newNo: null, hunk } });
    let dels: Row[] = [];
    let adds: Row[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
        left.push(dels[i] ?? filler());
        right.push(adds[i] ?? filler());
      }
      dels = [];
      adds = [];
    };
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    let last: LineKind | null = null;
    for (const l of h.lines) {
      const text = shown(l.kind, l.text);
      switch (l.kind) {
        case "context":
          flush();
          left.push({ text, line: { kind: l.kind, oldNo: oldNo++, newNo, hunk } });
          right.push({ text, line: { kind: l.kind, oldNo: oldNo - 1, newNo: newNo++, hunk } });
          break;
        case "del":
          // A deletion after additions starts a new pair of runs.
          if (adds.length > 0) flush();
          dels.push({ text, line: { kind: l.kind, oldNo: oldNo++, newNo: null, hunk } });
          break;
        case "add":
          adds.push({ text, line: { kind: l.kind, oldNo: null, newNo: newNo++, hunk } });
          break;
        case "noNewline": {
          const row = { text, line: { kind: l.kind, oldNo: null, newNo: null, hunk } };
          if (last === "del") dels.push(row);
          else if (last === "add") adds.push(row);
          else {
            flush();
            left.push(row);
            right.push({ ...row });
          }
        }
      }
      if (l.kind !== "noNewline") last = l.kind;
    }
    flush();
  });
  const doc = (rows: Row[]): DiffDoc => ({ text: rows.map((r) => r.text).join("\n"), lines: rows.map((r) => r.line), hunkStarts });
  return { left: doc(left), right: doc(right), hunkStarts };
}
