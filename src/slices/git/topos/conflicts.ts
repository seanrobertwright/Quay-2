// The three-pane resolver's one marker parser (#352, #390). `parseConflicts` finds git's conflict
// hunks in a Result text and drives the hunks' take-left, take-right and take-both boxes, the
// "n unresolved" navigator and the check that no markers remain before Mark resolved. Rust never
// parses markers. The text is the file's own, untrusted content: it is only ever shown as text.

import { errorMessage, parseGitError } from "./gitVersion.ts";
import { bannerView, type OpState, type SideView } from "./operation.ts";

/** One conflict hunk, as character offsets into the text it was parsed from. */
export interface ConflictHunk {
  /** Where its opening marker line starts. */
  from: number;
  /** Just past its closing marker line, newline included. */
  to: number;
  /** The 0-based line of its opening marker. */
  line: number;
  /** The text between the markers, each with its final newline. */
  left: string;
  /** The common ancestor's text, when git wrote it (`merge.conflictStyle` diff3 or zdiff3). */
  base: string | null;
  right: string;
  /** What follows each marker: git's name for the side, such as `HEAD` or a branch. */
  leftLabel: string;
  rightLabel: string;
}

export interface ParsedConflicts {
  hunks: ConflictHunk[];
  /** Whether any line still is a conflict marker, inside a hunk or not. */
  markersRemain: boolean;
  /** The 0-based line of an opening marker no closing marker follows, or null. */
  unterminated: number | null;
}

type Marker = "<" | "|" | "=" | ">";

/**
 * The marker `line` is, or null: exactly `size` of one marker character, then the end of the line
 * or a space and a label. A run of a different length is content, as git treats it.
 */
function markerOf(line: string, size: number): { kind: Marker; label: string } | null {
  const kind = line[0];
  if (kind !== "<" && kind !== "|" && kind !== "=" && kind !== ">") return null;
  let n = 0;
  while (n < line.length && line[n] === kind) n++;
  if (n !== size) return null;
  const rest = line.slice(n);
  // `=======` takes no label.
  if (kind === "=") return rest === "" ? { kind, label: "" } : null;
  if (rest === "") return { kind, label: "" };
  return rest[0] === " " ? { kind, label: rest.slice(1) } : null;
}

/** `text`'s lines, each with where it starts and the offset just past its newline. */
function linesOf(text: string): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = [];
  let from = 0;
  while (from < text.length) {
    const nl = text.indexOf("\n", from);
    const end = nl === -1 ? text.length : nl;
    out.push({ text: text.slice(from, end), from, to: nl === -1 ? end : nl + 1 });
    from = nl === -1 ? text.length : nl + 1;
  }
  return out;
}

/**
 * The conflict hunks in `text`, whose markers are `markerSize` characters long. A hunk runs from
 * an opening marker through an optional base marker and the separator to a closing marker; inside
 * it, only the next marker in that order counts, so a marker-like line out of order is content of
 * the side it sits in. The exception is a second opening marker before the separator: git never
 * nests markers of one size, so it starts the hunk and the first is left over. An opening marker
 * never closed makes no hunk, and the first such is reported as `unterminated`.
 */
export function parseConflicts(text: string, markerSize: number): ParsedConflicts {
  const lines = linesOf(text);
  const hunks: ConflictHunk[] = [];
  let markersRemain = false;
  let unterminated: number | null = null;
  let i = 0;
  while (i < lines.length) {
    const open = markerOf(lines[i].text, markerSize);
    if (open !== null) markersRemain = true;
    if (open?.kind !== "<") {
      i++;
      continue;
    }
    // Find base (optional), separator and close, in that order.
    let base = -1;
    let sep = -1;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const m = markerOf(lines[j].text, markerSize);
      if (m === null) continue;
      // git never nests a marker of the same size, so an earlier opening marker was a stray.
      if (sep === -1 && m.kind === "<") break;
      if (sep === -1 && base === -1 && m.kind === "|") base = j;
      else if (sep === -1 && m.kind === "=") sep = j;
      else if (sep !== -1 && m.kind === ">") {
        close = j;
        break;
      }
    }
    if (sep === -1 || close === -1) {
      if (unterminated === null) unterminated = i;
      i++;
      continue;
    }
    const span = (a: number, b: number) => (a >= b ? "" : text.slice(lines[a].from, lines[b - 1].to));
    hunks.push({
      from: lines[i].from,
      to: lines[close].to,
      line: i,
      left: span(i + 1, base === -1 ? sep : base),
      base: base === -1 ? null : span(base + 1, sep),
      right: span(sep + 1, close),
      leftLabel: open.label,
      rightLabel: markerOf(lines[close].text, markerSize)?.label ?? "",
    });
    i = close + 1;
  }
  return { hunks, markersRemain, unterminated };
}

/** Which side, or both, a hunk's box keeps. */
export type HunkChoice = "left" | "right" | "both";

/** The text `choice` keeps of `hunk`: one side, or both with left first. */
export function keptText(hunk: ConflictHunk, choice: HunkChoice): string {
  return choice === "left" ? hunk.left : choice === "right" ? hunk.right : hunk.left + hunk.right;
}

/** `text` with `hunk`, parsed from it, replaced by the side `choice` keeps; both is left, then right. */
export function takeHunk(text: string, hunk: ConflictHunk, choice: HunkChoice): string {
  return text.slice(0, hunk.from) + keptText(hunk, choice) + text.slice(hunk.to);
}

/** The navigator's words for what is left to resolve. */
export function unresolvedLabel(parsed: ParsedConflicts): string {
  if (parsed.hunks.length > 0) return `${parsed.hunks.length.toLocaleString()} unresolved`;
  if (parsed.unterminated !== null) return `Unterminated conflict at line ${parsed.unterminated + 1}`;
  return "No conflicts left";
}

/** What a confirm dialog asks before a resolver action. */
export interface ResolverConfirm {
  title: string;
  detail: string;
  confirmLabel: string;
  /** Drops or overwrites work, so the confirm button takes the danger style (#421). */
  destructive?: boolean;
}

/** What Mark resolved confirms while `parsed`, the Result, still holds markers, or null when it doesn't. */
export function confirmMarkResolved(path: string, parsed: ParsedConflicts): ResolverConfirm | null {
  if (!parsed.markersRemain) return null;
  const n = parsed.hunks.length;
  const what = n > 0 ? `still has ${n.toLocaleString()} ${n === 1 ? "conflict" : "conflicts"}` : "still has conflict markers";
  return {
    title: `Mark ${path} resolved?`,
    detail: `${path} ${what}. Marking it resolved stages the markers as they are, and they would be committed.`,
    confirmLabel: "Mark resolved anyway",
  };
}

/** What Reset file confirms; `unsaved` when the Result holds edits not saved yet. */
export function confirmReset(path: string, unsaved: boolean): ResolverConfirm {
  const lost = unsaved ? " Your unsaved edits are lost." : "";
  return {
    title: `Reset ${path}?`,
    detail: `This puts ${path} back to git's conflict markers (git checkout -m), dropping any resolution saved to it.${lost} The saved file is backed up first, and Recently discarded can restore it.`,
    confirmLabel: "Reset file",
    destructive: true,
  };
}

/** What leaving the resolver with `title` confirms while `path`'s Result holds unsaved edits. */
export function confirmDropEdits(title: string, path: string): ResolverConfirm {
  return {
    title,
    detail: `${path} has edits that aren't saved. Leaving drops them; the file keeps what was last saved.`,
    confirmLabel: "Drop my edits",
    destructive: true,
  };
}

/** What taking one whole side confirms, naming the side by its role and real ref. */
export function confirmTakeSide(path: string, name: string): ResolverConfirm {
  return {
    title: `Keep ${name} for all of ${path}?`,
    detail: `This replaces ${path} with ${name}'s version, dropping the other side and any edits to the Result, and stages it as resolved. The file is backed up first, and Recently discarded can restore it.`,
    confirmLabel: `Keep ${name}`,
    destructive: true,
  };
}

/** What the resolver says when another staging operation holds the worktree. */
export const STAGING_BUSY_MESSAGE = "Another staging operation is still running on this worktree.";

/** A failed resolver write, as the resolver shows it. */
export interface ResolverFailure {
  message: string;
  /** Whether git or an agent changed the file since it was opened, so it must be reopened. */
  stale: boolean;
}

export function resolverFailure(e: unknown, path: string): ResolverFailure {
  switch (parseGitError(e)?.kind) {
    case "conflictStale":
      return {
        message: `${path} changed since it was opened, by git or an agent, so nothing was written. Reopen it to see what it holds now.`,
        stale: true,
      };
    case "stagingBusy":
      return { message: STAGING_BUSY_MESSAGE, stale: false };
    case "indexLocked":
      return { message: "Another git process is holding index.lock. Quay never deletes it; retry once that process is done.", stale: false };
  }
  return { message: errorMessage(e), stale: false };
}

/**
 * The labels over the two sides: role and real ref as the banner names them, with git's "ours" and
 * "theirs" only in the tooltips. A conflict with no operation under way has no roles to name.
 */
export function paneLabels(op: OpState): { left: SideView; right: SideView } {
  const view = bannerView(op, { running: false });
  if (view?.kind === "operation") return { left: view.left, right: view.right };
  return {
    left: { text: "Left side", tooltip: "The version already on this branch. git calls this side “ours”." },
    right: { text: "Right side", tooltip: "The version coming in. git calls this side “theirs”." },
  };
}
