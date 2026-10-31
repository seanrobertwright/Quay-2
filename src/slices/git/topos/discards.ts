// Discarding and restoring unstaged changes (#366, #387): the session's Recently discarded list,
// and the words the inspector and the diff view use for a discard.

import type { Selection } from "./diffView.ts";
import { parseGitError } from "./gitVersion.ts";
import { lineCount } from "./lineSelection.ts";
import { failureView } from "./stagingKeys.ts";
import { splitStatus, type EntryKind, type WorktreeStatus } from "./stagingLists.ts";

/** `DiscardBackup` from `src-tauri/src/slices/git/discard.rs`: what one discard did to one file. */
export interface DiscardBackup {
  path: string;
  /** The blob of the bytes before the discard, or null when the file was absent. */
  blob: string | null;
  /** The blob id of the bytes the discard left, or null when it left no file. */
  after: string | null;
}

/** `DiscardTarget` from `src-tauri/src/slices/git/discard.rs`. */
export type DiscardTarget = { kind: "all"; includeUntracked: boolean } | { kind: "paths"; paths: string[] };

/** How long the Undo toast stays after a discard. */
export const UNDO_MS = 10_000;

/** The most discards the session keeps for one worktree; older ones drop off. */
export const MAX_DISCARDS = 200;

export type DiscardState = "discarded" | "restored" | "changed" | "copied";

/** One discard in the Recently discarded list. */
export interface DiscardEntry {
  id: number;
  /** What was discarded, as the list and the toast name it. */
  label: string;
  backups: DiscardBackup[];
  state: DiscardState;
  /** The files that changed since the discard, once a restore was refused for them. */
  changedPaths: string[];
  /** The new files a Copy to a new file wrote. */
  copiedTo: string[];
}

const NO_ENTRIES: readonly DiscardEntry[] = [];

export type DiscardUpdate = Partial<Pick<DiscardEntry, "state" | "changedPaths" | "copiedTo">>;

/**
 * The session's discards, per worktree, newest first. It outlives Topos closing and opening, so
 * one instance lives for the app's session; components read it through `subscribe`.
 */
export class DiscardLog {
  private byWorktree = new Map<string, DiscardEntry[]>();
  private nextId = 1;
  private listeners = new Set<() => void>();

  /** Records a discard, or nothing when it backed up no file. */
  add(worktree: string, label: string, backups: DiscardBackup[]): DiscardEntry | null {
    if (backups.length === 0) return null;
    const entry: DiscardEntry = { id: this.nextId++, label, backups, state: "discarded", changedPaths: [], copiedTo: [] };
    this.byWorktree.set(worktree, [entry, ...(this.byWorktree.get(worktree) ?? [])].slice(0, MAX_DISCARDS));
    this.notify();
    return entry;
  }

  /** The same array until the next change, so it can serve as a `useSyncExternalStore` snapshot. */
  entries(worktree: string): readonly DiscardEntry[] {
    return this.byWorktree.get(worktree) ?? NO_ENTRIES;
  }

  update(worktree: string, id: number, patch: DiscardUpdate): void {
    const list = this.byWorktree.get(worktree);
    if (list === undefined || !list.some((e) => e.id === id)) return;
    this.byWorktree.set(
      worktree,
      list.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
    this.notify();
  }

  /** Calls `listener` after every change, until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

/** The app session's log. */
export const discardLog = new DiscardLog();

/** What a discard from the diff view took, as the list and the toast name it. */
export function selectionLabel(path: string, selection: Selection): string {
  switch (selection.kind) {
    case "hunks":
      return selection.hunks.length === 1 ? `hunk ${selection.hunks[0] + 1} of ${path}` : `${selection.hunks.length} hunks of ${path}`;
    case "lines":
      return `${lineCount(selection.lines.length)} of ${path}`;
    default:
      return path;
  }
}

/** What a discard from the lists took; `kind` is the kind of the one path's row, if it has one. */
export function targetLabel(target: DiscardTarget, kind?: EntryKind): string {
  if (target.kind === "all") return target.includeUntracked ? "all unstaged changes and untracked files" : "all unstaged changes";
  if (target.paths.length !== 1) return `${target.paths.length.toLocaleString("en-US")} paths`;
  return kind === "untrackedFolder" ? `${target.paths[0]}/` : target.paths[0];
}

/** What the live region and the toast say once a discard of `label` backed up `files` files. */
export function discardedMessage(label: string, files: number): string {
  if (files === 0) return `Nothing to discard in ${label}.`;
  return `Discarded ${label}. Undo within ${UNDO_MS / 1000} seconds, or restore it from Recently discarded.`;
}

export interface DiscardConfirm {
  title: string;
  detail: string;
  confirmLabel: string;
}

const KEPT = "Quay backs up the current bytes first, so you can restore them from Recently discarded until Quay closes.";

/** The confirm dialog for discarding a whole file or an untracked folder. */
export function confirmDiscardFile(path: string, kind: EntryKind): DiscardConfirm {
  if (kind === "untracked" || kind === "untrackedFolder") {
    const name = kind === "untrackedFolder" ? `${path}/` : path;
    return {
      title: `Move ${name} to the Recycle Bin?`,
      detail: `${kind === "untrackedFolder" ? "Its untracked files go" : "The untracked file goes"} to the Recycle Bin; ignored files stay. ${KEPT}`,
      confirmLabel: "Move to Recycle Bin",
    };
  }
  return {
    title: `Discard changes to ${path}?`,
    detail: `Its unstaged changes are thrown away and the file goes back to the staged or committed version. Staged changes stay. ${KEPT}`,
    confirmLabel: "Discard file",
  };
}

/**
 * The confirm dialog for Discard all, whose checkbox adds untracked files and starts unticked. It
 * counts the tracked files with unstaged changes in `status`; past the cap it can't count the rest.
 */
export function confirmDiscardAll(status: WorktreeStatus): DiscardConfirm & { checkbox: { label: string; initial: boolean } } {
  const tracked = splitStatus(status.entries).unstaged.filter((c) => c.kind === "tracked").length;
  const files = `${tracked.toLocaleString("en-US")} tracked ${tracked === 1 ? "file" : "files"}`;
  const count = status.truncated ? `${files} in the list, and any past the list's cap` : files;
  return {
    title: "Discard all unstaged changes?",
    detail: `Every unstaged change to a tracked file goes back to the staged or committed version: ${count}. Staged changes stay. ${KEPT}`,
    confirmLabel: "Discard all",
    checkbox: { label: "Also move untracked files to the Recycle Bin", initial: false },
  };
}

/** How a restore ended when the backend refused it. */
export type RestoreOutcome = { kind: "changed"; paths: string[] } | { kind: "failed"; message: string };

export function restoreOutcome(e: unknown): RestoreOutcome {
  const error = parseGitError(e);
  if (error?.kind === "changedSinceDiscard") return { kind: "changed", paths: error.paths };
  return { kind: "failed", message: failureView(e).message };
}
