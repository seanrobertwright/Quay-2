import { useEffect, useRef } from "react";
import type { ChangeSide } from "../fileDiffRequest.ts";
import type { OpenFile } from "./useFileDiff.ts";

/** A file to open, with a count so the same one asked for twice opens twice. */
export interface FileRequest {
  /** Relative to the worktree root, with `/` separators. */
  path: string;
  side: ChangeSide;
  seq: number;
}

export interface FileRequestState {
  /** Whether Topos shows the worktree the file is in. */
  ready: boolean;
  request: FileRequest | null;
  /** The worktree's conflicted files, none until they are read. */
  conflicts: readonly string[];
  /** The file open in the conflict resolver, or null. */
  resolving: string | null;
  openDiff: (file: OpenFile) => void;
  openResolver: (path: string) => void;
}

/**
 * Opens a requested file once, when Topos can show it: a conflicted one in the resolver, any other in
 * the diff view. An open resolver may hold unsaved edits, so the file waits until it closes.
 */
export function useFileRequest({ ready, request, conflicts, resolving, openDiff, openResolver }: FileRequestState): void {
  const handled = useRef(0);
  useEffect(() => {
    if (!ready || request === null || request.seq === handled.current) return;
    const { path, side, seq } = request;
    if (side === "conflicted") {
      if (!conflicts.includes(path)) return;
      if (resolving !== null && resolving !== path) return;
      if (resolving === null) openResolver(path);
    } else {
      if (resolving !== null) return;
      openDiff({ path, side });
    }
    handled.current = seq;
  }, [ready, request, conflicts, resolving, openDiff, openResolver]);
}
