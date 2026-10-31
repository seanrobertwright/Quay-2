import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  appendOutput,
  commitDrafts,
  commitFailure,
  committedMessage,
  composeMessage,
  composerView,
  splitMessage,
  type CommitContext,
  type CommitFailure,
  type ComposerView,
  type MessageFields,
} from "./composer";
import { errorMessage } from "./gitVersion";
import { RequestIds } from "./refreshTable";
import { splitStatus } from "./stagingLists";
import type { OpEvent } from "./speedup";
import type { Staging } from "./useStaging";

export type ContextState =
  | { state: "loading" }
  | { state: "done"; worktreePath: string; context: CommitContext }
  | { state: "failed"; message: string };

export interface Commit {
  context: ContextState;
  /** What the composer offers, or null until the context is read. */
  view: ComposerView | null;
  fields: MessageFields;
  setFields: (fields: MessageFields) => void;
  amend: boolean;
  /** Ticking Amend loads HEAD's message; unticking it puts the draft back. */
  setAmend: (amend: boolean) => void;
  signoff: boolean;
  setSignoff: (signoff: boolean) => void;
  /** Whether a commit, and so its hooks, is running. */
  running: boolean;
  /** The hook output streamed by the newest commit, at most 64 KiB, as plain text. */
  output: string;
  failure: CommitFailure | null;
  commit: () => void;
  /** Stops the running commit's hooks. */
  cancel: () => void;
}

/**
 * The commit composer's state for the selected worktree (#366, #388). The message is the
 * worktree's draft for the session; a failed commit keeps it and a landed one clears it. Sign off
 * starts off for each worktree and is never remembered. A commit runs as the worktree's one
 * staging operation, streams its hooks' output, and on success hands the new HEAD to
 * `onCommitted` for the refresh table.
 */
export function useCommit(worktreePath: string | null, staging: Staging, onCommitted: (newHeadOid: string) => void): Commit {
  const [context, setContext] = useState<ContextState>({ state: "loading" });
  const [fields, setFieldsState] = useState<MessageFields>(() => (worktreePath === null ? splitMessage("") : commitDrafts.get(worktreePath)));
  const [amend, setAmendState] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [running, setRunning] = useState<{ opId: string } | null>(null);
  const [output, setOutput] = useState("");
  const [failure, setFailure] = useState<CommitFailure | null>(null);
  const path = useRef(worktreePath);
  path.current = worktreePath;
  const ids = useRef(new RequestIds());
  // The draft before Amend loaded HEAD's message, put back when Amend is unticked.
  const beforeAmend = useRef<MessageFields | null>(null);
  // The merge whose MERGE_MSG was prefilled, so the prefill happens once per merge.
  const prefilled = useRef<string | null>(null);

  const setFields = useCallback((next: MessageFields) => {
    setFieldsState(next);
    if (path.current !== null) commitDrafts.set(path.current, next);
  }, []);

  // Shows `worktree`'s draft with Amend and Sign off off, as when it is selected or has committed.
  const reset = useCallback((worktree: string | null) => {
    setFieldsState(worktree === null ? splitMessage("") : commitDrafts.get(worktree));
    setAmendState(false);
    setSignoff(false);
    beforeAmend.current = null;
  }, []);

  // Each worktree has its own draft; Amend and Sign off start off.
  useEffect(() => {
    reset(worktreePath);
    setFailure(null);
    setOutput("");
    prefilled.current = null;
  }, [worktreePath, reset]);

  // The context is read again whenever the status is, since a stage, a commit or the watcher can
  // each change the operation, the branch or HEAD.
  const statusSeen = staging.status;
  useEffect(() => {
    const id = ids.current.next();
    if (worktreePath === null) return;
    invoke<CommitContext>("git_commit_context", { worktreePath }).then(
      (next) => {
        if (ids.current.isLatest(id) && path.current === worktreePath) setContext({ state: "done", worktreePath, context: next });
      },
      (e: unknown) => {
        if (ids.current.isLatest(id) && path.current === worktreePath) setContext({ state: "failed", message: errorMessage(e) });
      }
    );
  }, [worktreePath, statusSeen]);

  // In a merge an empty composer is prefilled from MERGE_MSG, once for each merge.
  const shown = context.state === "done" && context.worktreePath === worktreePath ? context.context : null;
  useEffect(() => {
    if (shown === null || worktreePath === null || shown.operation !== "merge" || shown.mergeMessage === null) return;
    const key = `${worktreePath}\0${shown.head?.oid ?? ""}`;
    if (prefilled.current === key) return;
    prefilled.current = key;
    const draft = commitDrafts.get(worktreePath);
    if (draft.summary.trim() === "" && draft.description.trim() === "") setFields(splitMessage(shown.mergeMessage));
  }, [shown, worktreePath, setFields]);

  const setAmend = useCallback(
    (next: boolean) => {
      setAmendState(next);
      if (next) {
        beforeAmend.current = fields;
        if (shown?.head) setFields(splitMessage(shown.head.message));
      } else if (beforeAmend.current !== null) {
        setFields(beforeAmend.current);
        beforeAmend.current = null;
      }
    },
    [fields, shown, setFields]
  );

  const staged = staging.status.state === "done" ? splitStatus(staging.status.status.entries).staged.length : 0;
  const view = shown === null ? null : composerView({ context: shown, staged, amend, summary: fields.summary });
  const { announce, exclusive, reload } = staging;

  const commit = useCallback(() => {
    if (view === null || view.kind !== "composer" || !view.canCommit || running !== null || shown === null) return;
    const request = { message: composeMessage(fields), amend: amend && view.amendAvailable, signoff };
    const opId = crypto.randomUUID();
    const channel = new Channel<OpEvent>();
    channel.onmessage = (event) => {
      if (event.event === "output") setOutput((o) => appendOutput(o, event.chunk));
    };
    const button = view.button;
    const branch = shown.branch;
    const ran = exclusive({ action: "commit", target: { kind: "all" } }, (worktree) => {
      setRunning({ opId });
      setOutput("");
      setFailure(null);
      return invoke<string>("git_commit", { worktreePath: worktree, request, opId, onEvent: channel }).then(
        (newHeadOid) => {
          commitDrafts.clear(worktree);
          if (path.current === worktree) reset(worktree);
          announce(committedMessage(newHeadOid, { button, branch }));
          onCommitted(newHeadOid);
          void reload();
        },
        (e: unknown) => {
          const shownFailure = commitFailure(e);
          if (path.current === worktree) {
            setFailure(shownFailure);
            // The output the backend kept is the newest 64 KiB, so it replaces what streamed.
            if (shownFailure.output !== null) setOutput(shownFailure.output);
          }
          announce(shownFailure.message);
        }
      );
    });
    if (ran === null) {
      announce(commitFailure({ kind: "stagingBusy" }).message);
      return;
    }
    void ran.finally(() => setRunning(null));
  }, [view, running, shown, fields, amend, signoff, exclusive, announce, onCommitted, reload, reset]);

  const cancel = useCallback(() => {
    if (running === null) return;
    invoke("git_op_cancel", { opId: running.opId }).catch(console.error);
  }, [running]);

  return {
    context,
    view,
    fields,
    setFields,
    amend: amend && view?.kind === "composer" && view.amendAvailable,
    setAmend,
    signoff,
    setSignoff,
    running: running !== null,
    output,
    failure,
    commit,
    cancel,
  };
}
