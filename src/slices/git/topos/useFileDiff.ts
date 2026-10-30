import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileDiff } from "./diffDoc";
import type { Selection } from "./diffView";
import { errorMessage } from "./gitVersion";
import { RequestIds } from "./refreshTable";
import type { Side } from "./stagingLists";
import type { Staging } from "./useStaging";

/** The file whose diff is open, and the list it was opened from. */
export interface OpenFile {
  path: string;
  side: Side;
}

export type DiffState =
  | { state: "loading" }
  | { state: "done"; diff: FileDiff }
  | { state: "failed"; message: string };

export interface FileDiffReader {
  diff: DiffState;
  /** Reads the diff again, as a refresh does (#379). Resolves once it is read or dropped. */
  reload: () => Promise<void>;
  /** Whether the operator asked for a `tooLarge` diff's hunks with Load anyway. */
  loadedLarge: boolean;
  loadLarge: () => void;
  /** Stages from the unstaged side, or unstages from the staged side, part of the file. */
  act: (selection: Selection) => void;
}

/** The context lines every diff is read with. */
const CONTEXT = 3;

/**
 * The open file's diff (#383). It is read when the file opens, on `reload` (the refresh table's
 * `worktree` and `index` bits), and after each stage or unstage, whose answer carries the new
 * diff. Every read carries a request id from one `RequestIds`, so an older answer never lands over
 * a newer one. A `StaleDiff` reloads the diff; nothing is replayed.
 */
export function useFileDiff(worktreePath: string | null, file: OpenFile | null, staging: Staging): FileDiffReader {
  const [diff, setDiff] = useState<DiffState>({ state: "loading" });
  const [loadedLarge, setLoadedLarge] = useState(false);
  const ids = useRef(new RequestIds());
  // The handlers below outlive renders, so they read the newest of these through a ref.
  const latest = useRef({ worktreePath, file, loadedLarge });
  latest.current = { worktreePath, file, loadedLarge };
  const { stageSelection } = staging;

  const isCurrent = (worktree: string, open: OpenFile) =>
    latest.current.worktreePath === worktree &&
    latest.current.file?.path === open.path &&
    latest.current.file.side === open.side;

  const read = useCallback((): Promise<void> => {
    const { worktreePath: worktree, file: open, loadedLarge: large } = latest.current;
    const id = ids.current.next();
    if (worktree === null || open === null) return Promise.resolve();
    return invoke<FileDiff>("git_file_diff", {
      worktreePath: worktree,
      requestId: id,
      path: open.path,
      side: { kind: open.side },
      context: CONTEXT,
      loadLarge: large,
    }).then(
      (next) => {
        if (ids.current.isLatest(id) && isCurrent(worktree, open)) setDiff({ state: "done", diff: next });
      },
      (e: unknown) => {
        if (ids.current.isLatest(id) && isCurrent(worktree, open)) setDiff({ state: "failed", message: errorMessage(e) });
      }
    );
  }, []);

  // A newly opened file starts loading, with its hunks capped again.
  const key = file === null || worktreePath === null ? null : `${worktreePath}\n${file.side}\n${file.path}`;
  useEffect(() => {
    setDiff({ state: "loading" });
    setLoadedLarge(false);
    latest.current.loadedLarge = false;
    void read();
  }, [key, read]);

  const loadLarge = useCallback(() => {
    setLoadedLarge(true);
    latest.current.loadedLarge = true;
    void read();
  }, [read]);

  const act = useCallback(
    (selection: Selection) => {
      const { worktreePath: worktree, file: open, loadedLarge: large } = latest.current;
      if (worktree === null || open === null || diff.state !== "done") return;
      const id = ids.current.next();
      const action = open.side === "unstaged" ? "stage" : "unstage";
      void stageSelection(
        action,
        { path: open.path, side: { kind: open.side }, diffToken: diff.diff.diffToken, selection, loadLarge: large },
        id
      ).then((out) => {
        if (out.kind === "done") {
          if (ids.current.isLatest(id) && isCurrent(worktree, open)) setDiff({ state: "done", diff: out.diff });
        } else if (out.kind === "failed" && out.stale) {
          // The file moved under the diff: show what it holds now, and drop what was picked.
          void read();
        }
      });
    },
    [diff, read, stageSelection]
  );

  return { diff, reload: read, loadedLarge, loadLarge, act };
}
