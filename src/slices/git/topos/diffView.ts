// What the diff view shows for one file's diff (#383): its body, its mode change, its image
// preview's sources, and the sentences its actions announce.

import type { DiffSide, FileDiff } from "./diffDoc.ts";
import { lineCount, type LineRef } from "./lineSelection.ts";
import type { StageDirection } from "./stagingKeys.ts";

/** `Selection` from `src-tauri/src/slices/git/diff.rs`. */
export type Selection =
  | { kind: "file" }
  | { kind: "hunks"; hunks: number[] }
  | { kind: "modeChange" }
  | { kind: "lines"; lines: LineRef[] };

/** `ByteSource` from `src-tauri/src/slices/git/diff.rs`. */
export type ByteSource = { kind: "blob"; oid: string } | { kind: "worktree" };

/**
 * What the body of the view is: the hunks, a note that only whole-file actions apply (binary, a
 * submodule), the too-large note with Load anyway, a mode change with no content change, or an
 * emptied side.
 */
export type DiffBody = "text" | "binary" | "submodule" | "tooLarge" | "modeOnly" | "unchanged";

export function diffBody(diff: FileDiff): DiffBody {
  if (diff.submodule) return "submodule";
  if (diff.binary) return "binary";
  if (diff.tooLarge) return "tooLarge";
  if (diff.hunks.length > 0) return "text";
  return diff.modeChange !== null ? "modeOnly" : "unchanged";
}

export function modeLabel(mode: { oldMode: string; newMode: string }): string {
  return `Mode ${mode.oldMode} → ${mode.newMode}`;
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** The MIME type of an image the view previews, by `path`'s extension, or null. */
export function imageMime(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext] : null;
}

/**
 * Where the preview's before and after bytes come from. The old side is always the blob the diff
 * named. The new side is the worktree's file on the unstaged side and the named blob otherwise.
 * A side the file is absent from has none.
 */
export function previewSources(diff: FileDiff, side: DiffSide): { before: ByteSource | null; after: ByteSource | null } {
  const before: ByteSource | null = diff.oldOid !== null ? { kind: "blob", oid: diff.oldOid } : null;
  let after: ByteSource | null;
  if (diff.change === "deleted") after = null;
  else if (side.kind === "unstaged") after = { kind: "worktree" };
  else after = diff.newOid !== null ? { kind: "blob", oid: diff.newOid } : null;
  return { before, after };
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the live region announces once a stage or unstage from the diff view has finished. */
export function selectionDoneMessage(action: StageDirection, path: string, selection: Selection): string {
  const verb = action === "stage" ? "Staged" : "Unstaged";
  switch (selection.kind) {
    case "file":
      return `${verb} ${path}`;
    case "modeChange":
      return `${verb} the mode change of ${path}`;
    case "hunks":
      return selection.hunks.length === 1
        ? `${verb} hunk ${selection.hunks[0] + 1} of ${path}`
        : `${verb} ${selection.hunks.length} hunks of ${path}`;
    case "lines":
      return `${verb} ${lineCount(selection.lines.length)} of ${path}`;
  }
}
