import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DiscardBackup } from "./discards";
import { resolverFailure, type ResolverFailure } from "./conflicts";
import { RequestIds } from "./refreshTable";
import type { WorktreeStatus } from "./stagingLists";
import type { Staging } from "./useStaging";

/** `NotEditable` from `src-tauri/src/slices/git/conflict.rs`. */
export type NotEditable =
  | "oneSideMissing"
  | "noWorktreeFile"
  | "submodule"
  | "symlink"
  | "binary"
  | "tooLarge"
  | "notUtf8"
  | "mixedLineEndings";

/** `ConflictFile` from `src-tauri/src/slices/git/conflict.rs`. */
export interface ConflictFile {
  path: string;
  token: string;
  editable: boolean;
  reason: NotEditable | null;
  left: string | null;
  right: string | null;
  result: string | null;
  eol: "lf" | "crlf";
  bom: boolean;
  markerSize: number;
}

/** `ConflictReset` from `src-tauri/src/slices/git/conflict.rs`. */
interface ConflictReset {
  file: ConflictFile;
  backup: DiscardBackup;
}

/** `TakeSideResult` from `src-tauri/src/slices/git/conflict.rs`. */
interface TakeSideResult {
  backup: DiscardBackup;
  status: WorktreeStatus;
}

export type ConflictSide = "left" | "right";

export type ConflictRead =
  | { state: "loading"; path: string }
  | { state: "done"; file: ConflictFile }
  | { state: "failed"; path: string; message: string };

export interface ConflictResolverState {
  read: ConflictRead | null;
  /** The Result as the operator has it, saved or not. Null until an editable file is read. */
  text: string | null;
  setText: (text: string) => void;
  /** Whether `text` differs from what the file held when it was last read or saved. */
  dirty: boolean;
  /** The newest write's failure, until the next write or read. */
  failure: ResolverFailure | null;
  /** Reads the file afresh, dropping unsaved edits. */
  reopen: () => void;
  /** Saves `text`; resolves to whether it landed. */
  save: () => Promise<boolean>;
  /** Puts the file back to git's markers, after the caller's confirm. */
  reset: () => void;
  /** Keeps one whole side and stages it, after the caller's confirm. */
  takeSide: (side: ConflictSide) => void;
  /** Stages the file through the inspector's own `git add` path, saving unsaved edits first. */
  markResolved: () => void;
}

/**
 * The resolver's file (#390): `path` in the selected worktree, opened with `git_conflict_open`,
 * with the Result the operator edits. Every write runs as the worktree's one staging operation and
 * hands back the token it was read with, so the backend refuses it with `ConflictStale` when git or
 * an agent changed the file meanwhile. Reset file and take-whole-side record their backups in
 * Recently discarded, as a discard does (#387). Mark resolved is the inspector's Stage.
 */
export function useConflictResolver(worktreePath: string | null, path: string | null, staging: Staging): ConflictResolverState {
  const [read, setRead] = useState<ConflictRead | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failure, setFailure] = useState<ResolverFailure | null>(null);
  const ids = useRef(new RequestIds());
  const target = useRef({ worktreePath, path });
  target.current = { worktreePath, path };
  const { exclusive, announce, recordDiscard, reload, run } = staging;

  /** Whether `worktree` and `file` are still what the resolver shows. */
  const current = (worktree: string, file: string) => target.current.worktreePath === worktree && target.current.path === file;

  const show = useCallback((file: ConflictFile) => {
    setRead({ state: "done", file });
    setText(file.result);
  }, []);

  const open = useCallback(
    (worktree: string | null, file: string | null) => {
      const id = ids.current.next();
      setFailure(null);
      if (worktree === null || file === null) {
        setRead(null);
        setText(null);
        return;
      }
      setRead({ state: "loading", path: file });
      setText(null);
      invoke<ConflictFile>("git_conflict_open", { worktreePath: worktree, path: file }).then(
        (opened) => {
          if (ids.current.isLatest(id) && current(worktree, file)) show(opened);
        },
        (e: unknown) => {
          if (ids.current.isLatest(id) && current(worktree, file)) setRead({ state: "failed", path: file, message: resolverFailure(e, file).message });
        }
      );
    },
    [show]
  );

  useEffect(() => open(worktreePath, path), [worktreePath, path, open]);

  const file = read?.state === "done" ? read.file : null;
  const dirty = file !== null && file.editable && text !== null && text !== file.result;
  const reopen = useCallback(() => open(target.current.worktreePath, target.current.path), [open]);

  /** Shows a failed write on `name`, if it is still open, and says so. */
  const fail = useCallback(
    (worktree: string, name: string, e: unknown) => {
      const shown = resolverFailure(e, name);
      if (current(worktree, name)) setFailure(shown);
      announce(shown.message);
    },
    [announce]
  );

  const save = useCallback((): Promise<boolean> => {
    if (file === null || !file.editable || text === null) return Promise.resolve(false);
    const { path: name, token } = file;
    const saved = text;
    const ran = exclusive({ action: "resolve", target: { kind: "paths", paths: [name] } }, (worktree) => {
      setFailure(null);
      return invoke<ConflictFile>("git_conflict_save", { worktreePath: worktree, path: name, token, text: saved }).then(
        (next) => {
          if (current(worktree, name)) {
            ids.current.next();
            setRead({ state: "done", file: next });
            // Edits made while the save ran stay; the saved text is the new baseline.
            setText((now) => (now === saved ? next.result : now));
          }
          announce(`Saved ${name}`);
          void reload();
          return true;
        },
        (e: unknown) => {
          fail(worktree, name, e);
          return false;
        }
      );
    });
    if (ran === null) {
      announce("Another staging operation is still running on this worktree.");
      return Promise.resolve(false);
    }
    return ran;
  }, [file, text, exclusive, announce, reload, fail]);

  const reset = useCallback(() => {
    if (file === null) return;
    const { path: name, token } = file;
    const ran = exclusive({ action: "resolve", target: { kind: "paths", paths: [name] } }, (worktree) => {
      setFailure(null);
      return invoke<ConflictReset>("git_conflict_reset", { worktreePath: worktree, path: name, token }).then(
        (out) => {
          if (current(worktree, name)) {
            ids.current.next();
            show(out.file);
          }
          recordDiscard(worktree, `Reset ${name}`, [out.backup]);
          void reload();
        },
        (e: unknown) => fail(worktree, name, e)
      );
    });
    if (ran === null) announce("Another staging operation is still running on this worktree.");
  }, [file, exclusive, show, recordDiscard, reload, fail, announce]);

  const takeSide = useCallback(
    (side: ConflictSide) => {
      if (file === null) return;
      const { path: name, token } = file;
      const ran = exclusive({ action: "resolve", target: { kind: "paths", paths: [name] } }, (worktree) => {
        setFailure(null);
        // The status comes back with the reload below, which carries the inspector's own request id.
        return invoke<TakeSideResult>("git_conflict_take_side", { worktreePath: worktree, requestId: 0, path: name, token, side }).then(
          (out) => {
            recordDiscard(worktree, `Kept the ${side} side of ${name}`, [out.backup]);
            void reload();
          },
          (e: unknown) => fail(worktree, name, e)
        );
      });
      if (ran === null) announce("Another staging operation is still running on this worktree.");
    },
    [file, exclusive, recordDiscard, reload, fail, announce]
  );

  const markResolved = useCallback(() => {
    if (file === null) return;
    const name = file.path;
    const stage = () => run("stage", { kind: "paths", paths: [name] });
    if (!dirty) {
      stage();
      return;
    }
    void save().then((saved) => {
      if (saved) stage();
    });
  }, [file, dirty, save, run]);

  return { read, text, setText, dirty, failure, reopen, save, reset, takeSide, markResolved };
}
