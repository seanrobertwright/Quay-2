import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { appendOutput, composeMessage, splitMessage, type MessageFields } from "./composer";
import { errorMessage } from "./gitVersion";
import { bannerView, stepDoneMessage, stepFailure, type BannerView, type OpState, type OpStep, type StepFailure } from "./operation";
import { RequestIds } from "./refreshTable";
import type { OpEvent } from "./speedup";
import type { Staging } from "./useStaging";

export type OpStateRead =
  | { state: "loading" }
  | { state: "done"; worktreePath: string; op: OpState }
  | { state: "failed"; message: string };

/** `OpOutcome` from `src-tauri/src/slices/git/operation.rs`. */
interface OpOutcome {
  head: string | null;
  state: OpState;
}

const COMMANDS: Record<OpStep, string> = { continue: "git_op_continue", skip: "git_op_skip", abort: "git_op_abort" };

export interface Operation {
  read: OpStateRead;
  /** The selected worktree's operation, once read. */
  op: OpState | null;
  /** What the banner shows, or null for no banner. */
  view: BannerView | null;
  /** The message Continue commits, prefilled from the file git takes it from. */
  fields: MessageFields;
  setFields: (fields: MessageFields) => void;
  /** The step running, or null. */
  running: OpStep | null;
  /** What the newest step streamed, at most 64 KiB, as plain text. */
  output: string;
  failure: StepFailure | null;
  /** Runs `step` on the operation under way. Abort and Skip are confirmed by the caller first. */
  run: (step: OpStep) => void;
  /** Stops the running step's hooks. */
  cancel: () => void;
}

/**
 * The operation under way in the selected worktree, for its banner (#352, #389). It is read again
 * whenever the status is, which the refresh table does on the `operation`, `index`, `worktree` and
 * `head` bits. Continue, Skip and Abort each run as the worktree's one staging operation, like a
 * commit (#388), streaming their output; a step that lands hands HEAD to `onLanded` for the
 * refresh table.
 */
export function useOperation(worktreePath: string | null, staging: Staging, onLanded: (head: string) => void): Operation {
  const [read, setRead] = useState<OpStateRead>({ state: "loading" });
  const [fields, setFields] = useState<MessageFields>(() => splitMessage(""));
  const [running, setRunning] = useState<{ step: OpStep; opId: string } | null>(null);
  const [output, setOutput] = useState("");
  const [failure, setFailure] = useState<StepFailure | null>(null);
  const path = useRef(worktreePath);
  path.current = worktreePath;
  const ids = useRef(new RequestIds());
  // The step whose message was prefilled, so an edit isn't overwritten until the next step.
  const prefilled = useRef<string | null>(null);

  useEffect(() => {
    setFailure(null);
    setOutput("");
    prefilled.current = null;
  }, [worktreePath]);

  const statusSeen = staging.status;
  useEffect(() => {
    const id = ids.current.next();
    if (worktreePath === null) return;
    invoke<OpState>("git_operation_state", { worktreePath }).then(
      (op) => {
        if (ids.current.isLatest(id) && path.current === worktreePath) setRead({ state: "done", worktreePath, op });
      },
      (e: unknown) => {
        if (ids.current.isLatest(id) && path.current === worktreePath) setRead({ state: "failed", message: errorMessage(e) });
      }
    );
  }, [worktreePath, statusSeen]);

  const op = read.state === "done" && read.worktreePath === worktreePath ? read.op : null;

  // Each step of an operation prefills its own message once.
  useEffect(() => {
    if (op === null || op.kind === "none" || op.message === null || worktreePath === null) return;
    const key = [worktreePath, op.kind, op.step ?? "", op.rightLabel?.name ?? ""].join("\0");
    if (prefilled.current === key) return;
    prefilled.current = key;
    setFields(splitMessage(op.message));
  }, [op, worktreePath]);

  const view = op === null ? null : bannerView(op, { running: running !== null, summary: fields.summary });
  const { announce, exclusive, reload } = staging;

  const run = useCallback(
    (step: OpStep) => {
      if (op === null || op.kind === "none" || running !== null) return;
      if (step === "continue" && (view?.kind !== "operation" || !view.canContinue)) return;
      const before = op;
      const opId = crypto.randomUUID();
      const channel = new Channel<OpEvent>();
      channel.onmessage = (event) => {
        if (event.event === "output") setOutput((o) => appendOutput(o, event.chunk));
      };
      const args: Record<string, unknown> = { operation: before.kind, opId, onEvent: channel };
      if (step === "continue") args.message = before.message === null ? null : composeMessage(fields);
      const ran = exclusive({ action: "operation", target: { kind: "all" } }, (worktree) => {
        setRunning({ step, opId });
        setOutput("");
        setFailure(null);
        return invoke<OpOutcome>(COMMANDS[step], { worktreePath: worktree, ...args }).then(
          (outcome) => {
            if (path.current === worktree) {
              // The outcome is newer than any read in flight.
              setRead({ state: "done", worktreePath: worktree, op: outcome.state });
              ids.current.next();
            }
            announce(stepDoneMessage(step, before, outcome.state));
            if (outcome.head !== null) onLanded(outcome.head);
            void reload();
          },
          (e: unknown) => {
            const shown = stepFailure(step, e);
            if (path.current === worktree) {
              setFailure(shown);
              if (shown.output !== null) setOutput(shown.output);
            }
            announce(shown.message);
            void reload();
          }
        );
      });
      if (ran === null) {
        announce(stepFailure(step, { kind: "stagingBusy" }).message);
        return;
      }
      void ran.finally(() => setRunning(null));
    },
    [op, running, view, fields, exclusive, announce, onLanded, reload]
  );

  const cancel = useCallback(() => {
    if (running === null) return;
    invoke("git_op_cancel", { opId: running.opId }).catch(console.error);
  }, [running]);

  return { read, op, view, fields, setFields, running: running?.step ?? null, output, failure, run, cancel };
}
