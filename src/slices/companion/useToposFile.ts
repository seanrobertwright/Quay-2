import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSamePath } from "../../utils/paths.ts";
import { onFileDiffRequest, type FileDiffRequest } from "../git/fileDiffRequest.ts";
import type { ToposTarget } from "../git/topos/Topos.tsx";
import type { FileRequest } from "../git/topos/useFileRequest.ts";
import { toposTargetOf, type KnownProjects } from "./toposTarget.ts";
import type { ToposDock } from "./ToposDock.tsx";

interface ToposFileOptions extends KnownProjects {
  dock: ToposDock;
  /** The selected terminal. */
  terminalId: string | null;
  /** What Topos works on for the selected terminal. */
  own: ToposTarget | null;
}

/** What `useToposFile` returns. */
export interface ToposFile {
  /** What Topos works on: the requested file's worktree while its lens is open on it, else `own`. */
  target: ToposTarget | null;
  /** The file to open there, or null. */
  request: FileRequest | null;
  /** Has Topos work on `own` again. */
  release: () => void;
}

/**
 * Opens the Topos lens on the file that a link in the selected terminal's surface asks for (#721), in
 * whichever worktree the file is. The request ends when the lens closes.
 */
export function useToposFile({ dock, terminalId, own, projects, projectWorktrees }: ToposFileOptions): ToposFile {
  const [request, setRequest] = useState<(FileDiffRequest & FileRequest) | null>(null);
  if (request !== null && !dock.wide) setRequest(null);
  const seq = useRef(0);
  const { openWide } = dock.companion;
  useEffect(
    () =>
      onFileDiffRequest((asked) => {
        if (asked.terminalId !== terminalId) return false;
        seq.current += 1;
        setRequest({ ...asked, seq: seq.current });
        openWide();
        return true;
      }),
    [terminalId, openWide],
  );
  const worktree = request?.worktree ?? null;
  const target = useMemo(
    () => (worktree === null || isSamePath(worktree, own?.path) ? own : toposTargetOf(worktree, { projects, projectWorktrees })),
    [worktree, own, projects, projectWorktrees],
  );
  const release = useCallback(() => setRequest(null), []);
  return { target, request, release };
}
