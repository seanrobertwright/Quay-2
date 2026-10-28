// Changes since the last commit (#223): the list's badge and the diff view it opens.

import type { ChangeStatus, PraxisKind } from "./types.ts";

/**
 * The ids of `kind`'s files deleted since the last commit that the list has no row for, in id
 * order, so they still get a row with the badge and their diff. `changes` is keyed by
 * `definitionKey`; `shown` holds the ids that already have a row.
 */
export function deletedSinceCommit(
  changes: ReadonlyMap<string, ChangeStatus>,
  kind: PraxisKind,
  shown: ReadonlySet<string>
): string[] {
  const prefix = `${kind}/`;
  return [...changes]
    .filter(([key, status]) => status === "deleted" && key.startsWith(prefix))
    .map(([key]) => key.slice(prefix.length))
    .filter((id) => !shown.has(id))
    .sort();
}

/** One line of a unified diff, with its `+`, `-` or space marker taken off. */
export interface DiffLine {
  kind: "header" | "hunk" | "added" | "removed" | "context";
  text: string;
}

/**
 * The lines of git's unified diff, as the diff view shows them. Everything before the first
 * hunk is a header, so inside a hunk a removed line that starts `--` is still a removal. A
 * `\ No newline at end of file` note shows as a header.
 */
export function diffLines(diff: string): DiffLine[] {
  const lines = diff.split("\n").map((l) => l.replace(/\r$/, ""));
  if (lines[lines.length - 1] === "") lines.pop();
  let inHunk = false;
  return lines.map((line): DiffLine => {
    if (line.startsWith("@@")) {
      inHunk = true;
      return { kind: "hunk", text: line };
    }
    // A new file's header starts again after a hunk, in a diff of more than one file.
    if (line.startsWith("diff --git ")) inHunk = false;
    if (!inHunk || line.startsWith("\\")) return { kind: "header", text: line };
    if (line.startsWith("+")) return { kind: "added", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "removed", text: line.slice(1) };
    return { kind: "context", text: line.slice(1) };
  });
}
