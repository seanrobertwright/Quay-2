import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./gitVersion";
import { RequestIds } from "./refreshTable";
import type { DiffSide, FileDiff } from "./diffDoc";
import {
  discardedMessage,
  discardLog,
  restoreOutcome,
  selectionLabel,
  UNDO_MS,
  type DiscardBackup,
  type DiscardEntry,
  type DiscardTarget,
} from "./discards";
import { selectionDoneMessage, type Selection } from "./diffView";
import { doneMessage, failureView, type StageDirection, type StagingAction } from "./stagingKeys";
import { splitStatus, type FolderListing, type PathTarget, type WorktreeStatus } from "./stagingLists";

export type StatusState =
  | { state: "idle" }
  | { state: "done"; worktreePath: string; status: WorktreeStatus }
  | { state: "failed"; worktreePath: string; message: string };

/** The staging operation running now, so its button shows busy and the others wait. */
export interface BusyOp {
  action: StagingAction | "discard" | "restore" | "copy";
  target: PathTarget;
  /** For a stage or unstage from the diff view, what part of the file it acts on. */
  selection?: Selection;
}

/** `StageRequest` from `src-tauri/src/slices/git/diff.rs`. */
export interface StageRequest {
  path: string;
  side: DiffSide;
  diffToken: string;
  selection: Selection;
  loadLarge: boolean;
}

/** `StageResult` from `src-tauri/src/slices/git/diff.rs`. */
export interface StageResult {
  diff: FileDiff;
  status: WorktreeStatus;
}

/** `DiscardRequest` from `src-tauri/src/slices/git/discard.rs`: always the unstaged side. */
export interface DiscardRequest {
  path: string;
  diffToken: string;
  selection: Selection;
  loadLarge: boolean;
}

/** `DiscardSelectionResult` from `src-tauri/src/slices/git/discard.rs`. */
interface DiscardSelectionResult {
  backup: DiscardBackup;
  diff: FileDiff;
  status: WorktreeStatus;
}

/** `DiscardPathsResult` from `src-tauri/src/slices/git/discard.rs`. */
interface DiscardPathsResult {
  backups: DiscardBackup[];
  status: WorktreeStatus;
}

/** `CopyResult` from `src-tauri/src/slices/git/discard.rs`. */
interface CopyResult {
  paths: string[];
  status: WorktreeStatus;
}

/** How a stage or unstage from the diff view ended. */
export type SelectionOutcome =
  | { kind: "done"; diff: FileDiff }
  /** It failed; `stale` when the diff it was made on no longer matches the file. */
  | { kind: "failed"; stale: boolean }
  /** Another operation was running, or the worktree changed, so it never ran. */
  | { kind: "skipped" };

/** A failed staging operation, with Retry when the failure allows one. */
export interface StagingFailure {
  message: string;
  retry: (() => void) | null;
}

export interface Staging {
  status: StatusState;
  /** Reads the status again, as a refresh does (#379). Resolves once it is read or dropped. */
  reload: () => Promise<void>;
  busy: BusyOp | null;
  failure: StagingFailure | null;
  /** The newest sentence for the live region, with a count so a repeat is announced again. */
  announcement: { text: string; seq: number };
  announce: (text: string) => void;
  run: (action: StagingAction, target: PathTarget) => void;
  /**
   * Stages or unstages part of one file from the diff view (#383), as one of this worktree's
   * staging operations. The post-write status lands here; the new diff, which answers
   * `diffRequestId`, is the caller's.
   */
  stageSelection: (action: StageDirection, request: StageRequest, diffRequestId: number) => Promise<SelectionOutcome>;
  /** Discards `target` from the lists (#387), after the inspector's confirmation. */
  discard: (target: DiscardTarget, label: string) => void;
  /**
   * Discards part or all of one file from the diff view, as one of this worktree's staging
   * operations. The new diff, which answers `diffRequestId`, is the caller's.
   */
  discardSelection: (request: DiscardRequest, diffRequestId: number) => Promise<SelectionOutcome>;
  /** This worktree's discards this session, newest first. */
  discards: readonly DiscardEntry[];
  /** The discard the Undo toast offers, for `UNDO_MS` after it lands. */
  undo: DiscardEntry | null;
  dismissUndo: () => void;
  /** Puts back what `entry` took, unless its files changed since. */
  restore: (entry: DiscardEntry) => void;
  /** Writes what `entry` took to new files beside the originals. */
  copyDiscard: (entry: DiscardEntry) => void;
  /** The untracked folders the operator expanded, each with its capped `status -uall`. */
  folders: ReadonlyMap<string, FolderListing>;
  toggleFolder: (folder: string) => void;
}

const NO_DISCARDS: readonly DiscardEntry[] = [];

const COMMANDS: Record<StagingAction, string> = {
  stage: "git_stage_paths",
  unstage: "git_unstage_paths",
  ignore: "git_ignore_folder",
};

/**
 * The selected worktree's status and its staging operations (#382). Status is read when the
 * worktree changes, each time `readCount` does (each show), and on `reload`, which the refresh
 * table calls. Every read and write carries a request id from one `RequestIds`, and only the
 * newest answer counts, so a write's post-write status and a watcher's refresh never overwrite a
 * newer one. There are no optimistic updates: the lists change only when git's answer lands. One
 * operation runs at a time here, and the backend's per-worktree slot refuses a second regardless.
 */
export function useStaging(worktreePath: string | null, readCount: number): Staging {
  const [status, setStatus] = useState<StatusState>({ state: "idle" });
  const [busy, setBusy] = useState<BusyOp | null>(null);
  const [failure, setFailure] = useState<StagingFailure | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  const [folders, setFolders] = useState<ReadonlyMap<string, FolderListing>>(new Map());
  const [undo, setUndo] = useState<{ worktree: string; entry: DiscardEntry } | null>(null);
  const ids = useRef(new RequestIds());
  const running = useRef(false);
  const path = useRef(worktreePath);
  path.current = worktreePath;
  // Each folder's own request ids, so a folder's older listing can't overwrite a newer one.
  const folderIds = useRef(new Map<string, RequestIds>());
  const expanded = useRef<ReadonlySet<string>>(new Set());

  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, seq: a.seq + 1 })), []);

  const readFolder = useCallback((worktree: string, folder: string) => {
    let folderIdsFor = folderIds.current.get(folder);
    if (folderIdsFor === undefined) {
      folderIdsFor = new RequestIds();
      folderIds.current.set(folder, folderIdsFor);
    }
    const id = folderIdsFor.next();
    const ownIds = folderIdsFor;
    const settle = (listing: FolderListing) => {
      if (!ownIds.isLatest(id) || path.current !== worktree || !expanded.current.has(folder)) return;
      setFolders((prev) => new Map(prev).set(folder, listing));
    };
    invoke<WorktreeStatus>("git_status", { worktreePath: worktree, requestId: id, folder }).then(
      (s) => settle({ state: "done", changes: splitStatus(s.entries).unstaged, truncated: s.truncated }),
      (e: unknown) => settle({ state: "failed", message: errorMessage(e) })
    );
  }, []);

  /** Takes a status answer if it is still the newest, and re-reads the expanded folders it keeps. */
  const accept = useCallback(
    (worktree: string, id: number, next: WorktreeStatus): boolean => {
      if (!ids.current.isLatest(id) || path.current !== worktree) return false;
      setStatus({ state: "done", worktreePath: worktree, status: next });
      const stillThere = new Set(
        next.entries.filter((e) => e.kind === "untrackedFolder" && expanded.current.has(e.path)).map((e) => e.path)
      );
      expanded.current = stillThere;
      setFolders((prev) => new Map([...prev].filter(([folder]) => stillThere.has(folder))));
      for (const folder of stillThere) readFolder(worktree, folder);
      return true;
    },
    [readFolder]
  );

  const read = useCallback(
    (worktree: string | null): Promise<void> => {
      const id = ids.current.next();
      if (worktree === null) {
        setStatus({ state: "idle" });
        return Promise.resolve();
      }
      return invoke<WorktreeStatus>("git_status", { worktreePath: worktree, requestId: id }).then(
        (next) => void accept(worktree, id, next),
        (e: unknown) => {
          if (ids.current.isLatest(id) && path.current === worktree) {
            setStatus({ state: "failed", worktreePath: worktree, message: errorMessage(e) });
          }
        }
      );
    },
    [accept]
  );

  // A new worktree starts with nothing expanded and nothing failed.
  useEffect(() => {
    expanded.current = new Set();
    folderIds.current = new Map();
    setFolders(new Map());
    setFailure(null);
    setUndo(null);
  }, [worktreePath]);

  // The toast goes after `UNDO_MS`; a newer discard restarts the wait.
  useEffect(() => {
    if (undo === null) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const discards = useSyncExternalStore(
    (listener) => discardLog.subscribe(listener),
    () => (worktreePath === null ? NO_DISCARDS : discardLog.entries(worktreePath))
  );

  useEffect(() => {
    void read(worktreePath);
  }, [worktreePath, readCount, read]);

  const reload = useCallback(() => read(path.current), [read]);

  const run = useCallback(
    (action: StagingAction, target: PathTarget) => {
      const worktree = path.current;
      if (worktree === null || running.current) return;
      running.current = true;
      setBusy({ action, target });
      setFailure(null);
      const id = ids.current.next();
      const args =
        action === "ignore"
          ? { worktreePath: worktree, requestId: id, folder: target.kind === "paths" ? target.paths[0] : "" }
          : { worktreePath: worktree, requestId: id, target };
      invoke<WorktreeStatus>(COMMANDS[action], args)
        .then(
          (next) => {
            accept(worktree, id, next);
            announce(doneMessage(action, target));
          },
          (e: unknown) => {
            const view = failureView(e);
            if (path.current === worktree) {
              setFailure({ message: view.message, retry: view.retry ? () => run(action, target) : null });
            }
            announce(view.message);
          }
        )
        .finally(() => {
          running.current = false;
          setBusy(null);
        });
    },
    [accept, announce]
  );

  const stageSelection = useCallback(
    (action: StageDirection, request: StageRequest, diffRequestId: number): Promise<SelectionOutcome> => {
      const worktree = path.current;
      if (worktree === null || running.current) return Promise.resolve({ kind: "skipped" });
      running.current = true;
      const target: PathTarget = { kind: "paths", paths: [request.path] };
      setBusy({ action, target, selection: request.selection });
      setFailure(null);
      const id = ids.current.next();
      const retry = () => void stageSelection(action, request, diffRequestId);
      return invoke<StageResult>("git_stage_selection", {
        worktreePath: worktree,
        requestId: id,
        diffRequestId,
        request,
      })
        .then(
          (out): SelectionOutcome => {
            accept(worktree, id, out.status);
            announce(selectionDoneMessage(action, request.path, request.selection));
            return { kind: "done", diff: out.diff };
          },
          (e: unknown): SelectionOutcome => {
            const view = failureView(e);
            if (path.current === worktree) setFailure({ message: view.message, retry: view.retry ? retry : null });
            announce(view.message);
            return { kind: "failed", stale: view.stale };
          }
        )
        .finally(() => {
          running.current = false;
          setBusy(null);
        });
    },
    [accept, announce]
  );

  /** Records a discard that backed up `backups`, offers its Undo, and says so. */
  const recordDiscard = useCallback(
    (worktree: string, label: string, backups: DiscardBackup[]) => {
      const entry = discardLog.add(worktree, label, backups);
      if (entry !== null && path.current === worktree) setUndo({ worktree, entry });
      announce(discardedMessage(label, backups.length));
    },
    [announce]
  );

  const discard = useCallback(
    (target: DiscardTarget, label: string) => {
      const worktree = path.current;
      if (worktree === null || running.current) return;
      running.current = true;
      setBusy({ action: "discard", target: target.kind === "all" ? { kind: "all" } : target });
      setFailure(null);
      const id = ids.current.next();
      invoke<DiscardPathsResult>("git_discard_paths", { worktreePath: worktree, requestId: id, target })
        .then(
          (out) => {
            accept(worktree, id, out.status);
            recordDiscard(worktree, label, out.backups);
          },
          (e: unknown) => {
            const view = failureView(e);
            if (path.current === worktree) setFailure({ message: view.message, retry: view.retry ? () => discard(target, label) : null });
            announce(view.message);
          }
        )
        .finally(() => {
          running.current = false;
          setBusy(null);
        });
    },
    [accept, announce, recordDiscard]
  );

  const discardSelection = useCallback(
    (request: DiscardRequest, diffRequestId: number): Promise<SelectionOutcome> => {
      const worktree = path.current;
      if (worktree === null || running.current) return Promise.resolve({ kind: "skipped" });
      running.current = true;
      setBusy({ action: "discard", target: { kind: "paths", paths: [request.path] }, selection: request.selection });
      setFailure(null);
      const id = ids.current.next();
      const label = selectionLabel(request.path, request.selection);
      return invoke<DiscardSelectionResult>("git_discard_selection", { worktreePath: worktree, requestId: id, diffRequestId, request })
        .then(
          (out): SelectionOutcome => {
            accept(worktree, id, out.status);
            recordDiscard(worktree, label, [out.backup]);
            return { kind: "done", diff: out.diff };
          },
          (e: unknown): SelectionOutcome => {
            const view = failureView(e);
            if (path.current === worktree) setFailure({ message: view.message, retry: null });
            announce(view.message);
            return { kind: "failed", stale: view.stale };
          }
        )
        .finally(() => {
          running.current = false;
          setBusy(null);
        });
    },
    [accept, announce, recordDiscard]
  );

  const restore = useCallback(
    (entry: DiscardEntry) => {
      const worktree = path.current;
      if (worktree === null || running.current) return;
      running.current = true;
      setBusy({ action: "restore", target: { kind: "paths", paths: entry.backups.map((b) => b.path) } });
      setFailure(null);
      setUndo(null);
      const id = ids.current.next();
      invoke<WorktreeStatus>("git_restore_discarded", { worktreePath: worktree, requestId: id, backups: entry.backups })
        .then(
          (next) => {
            accept(worktree, id, next);
            discardLog.update(worktree, entry.id, { state: "restored" });
            announce(`Restored ${entry.label}`);
          },
          (e: unknown) => {
            const out = restoreOutcome(e);
            if (out.kind === "changed") {
              discardLog.update(worktree, entry.id, { state: "changed", changedPaths: out.paths });
              announce(`${out.paths.join(", ")} changed since the discard, so nothing was restored. Copy it to a new file from Recently discarded.`);
            } else {
              if (path.current === worktree) setFailure({ message: out.message, retry: null });
              announce(out.message);
            }
          }
        )
        .finally(() => {
          running.current = false;
          setBusy(null);
        });
    },
    [accept, announce]
  );

  const copyDiscard = useCallback(
    (entry: DiscardEntry) => {
      const worktree = path.current;
      if (worktree === null || running.current) return;
      running.current = true;
      setBusy({ action: "copy", target: { kind: "paths", paths: entry.backups.map((b) => b.path) } });
      setFailure(null);
      const id = ids.current.next();
      invoke<CopyResult>("git_copy_discarded", { worktreePath: worktree, requestId: id, backups: entry.backups })
        .then(
          (out) => {
            accept(worktree, id, out.status);
            discardLog.update(worktree, entry.id, { state: "copied", copiedTo: out.paths });
            announce(`Copied ${entry.label} to ${out.paths.join(", ")}`);
          },
          (e: unknown) => {
            const view = failureView(e);
            if (path.current === worktree) setFailure({ message: view.message, retry: null });
            announce(view.message);
          }
        )
        .finally(() => {
          running.current = false;
          setBusy(null);
        });
    },
    [accept, announce]
  );

  const dismissUndo = useCallback(() => setUndo(null), []);

  const toggleFolder = useCallback(
    (folder: string) => {
      const worktree = path.current;
      if (worktree === null) return;
      const next = new Set(expanded.current);
      if (next.has(folder)) {
        next.delete(folder);
        expanded.current = next;
        setFolders((prev) => {
          const out = new Map(prev);
          out.delete(folder);
          return out;
        });
        announce(`Collapsed ${folder}/`);
        return;
      }
      next.add(folder);
      expanded.current = next;
      setFolders((prev) => new Map(prev).set(folder, { state: "loading" }));
      announce(`Expanded ${folder}/`);
      readFolder(worktree, folder);
    },
    [announce, readFolder]
  );

  // Status read for another worktree is never handed out, not even for the render before a new read.
  const shown = status.state !== "idle" && status.worktreePath !== worktreePath ? ({ state: "idle" } as const) : status;
  const shownUndo = undo !== null && undo.worktree === worktreePath ? undo.entry : null;
  return {
    status: shown,
    reload,
    busy,
    failure,
    announcement,
    announce,
    run,
    stageSelection,
    discard,
    discardSelection,
    discards,
    undo: shownUndo,
    dismissUndo,
    restore,
    copyDiscard,
    folders,
    toggleFolder,
  };
}
