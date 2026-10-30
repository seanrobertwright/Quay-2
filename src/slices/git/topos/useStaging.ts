import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./gitVersion";
import { RequestIds } from "./refreshTable";
import type { DiffSide, FileDiff } from "./diffDoc";
import { selectionDoneMessage, type Selection } from "./diffView";
import { doneMessage, failureView, type StagingAction } from "./stagingKeys";
import { splitStatus, type FolderListing, type PathTarget, type WorktreeStatus } from "./stagingLists";

export type StatusState =
  | { state: "idle" }
  | { state: "done"; worktreePath: string; status: WorktreeStatus }
  | { state: "failed"; worktreePath: string; message: string };

/** The staging operation running now, so its button shows busy and the others wait. */
export interface BusyOp {
  action: StagingAction;
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
  stageSelection: (action: "stage" | "unstage", request: StageRequest, diffRequestId: number) => Promise<SelectionOutcome>;
  /** The untracked folders the operator expanded, each with its capped `status -uall`. */
  folders: ReadonlyMap<string, FolderListing>;
  toggleFolder: (folder: string) => void;
}

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
  }, [worktreePath]);

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
    (action: "stage" | "unstage", request: StageRequest, diffRequestId: number): Promise<SelectionOutcome> => {
      const worktree = path.current;
      if (worktree === null || running.current) return Promise.resolve({ kind: "skipped" });
      running.current = true;
      const target: PathTarget = { kind: "paths", paths: [request.path] };
      setBusy({ action, target, selection: request.selection });
      setFailure(null);
      const id = ids.current.next();
      const retry = () => void stageSelection(action, request, diffRequestId);
      return invoke<{ diff: FileDiff; status: WorktreeStatus }>("git_stage_selection", {
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
  return { status: shown, reload, busy, failure, announcement, announce, run, stageSelection, folders, toggleFolder };
}
