import { useCallback, useEffect, useRef } from "react";
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
  /** Tells the operator something, here that a file waits for the open resolver to close. */
  announce: (text: string) => void;
}

/**
 * Opens a requested file once, when Topos can show it: a conflicted one in the resolver, any other in
 * the diff view. An open resolver may hold unsaved edits, so the file waits until it closes, and
 * the operator is told so once for each request.
 *
 * Returns `fileWaits()`: true while a requested file waits for the open resolver to close.
 */
export function useFileRequest({ ready, request, conflicts, resolving, openDiff, openResolver, announce }: FileRequestState): () => boolean {
  const handled = useRef(0);
  const toldSeq = useRef(0);
  const waiting = useRef(false);
  useEffect(() => {
    if (!ready || request === null || request.seq === handled.current) return;
    const { path, side, seq } = request;
    waiting.current = false;
    const tellWaiting = () => {
      waiting.current = true;
      if (toldSeq.current === seq) return;
      toldSeq.current = seq;
      announce(`Close the conflict resolver on ${resolving} to open ${path}.`);
    };
    if (side === "conflicted") {
      if (!conflicts.includes(path)) return;
      if (resolving !== null && resolving !== path) return tellWaiting();
      if (resolving === null) openResolver(path);
    } else {
      if (resolving !== null) return tellWaiting();
      openDiff({ path, side });
    }
    handled.current = seq;
  }, [ready, request, conflicts, resolving, openDiff, openResolver, announce]);
  return useCallback(() => waiting.current, []);
}
