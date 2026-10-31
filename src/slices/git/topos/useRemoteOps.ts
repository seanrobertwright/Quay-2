import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ConfirmRequest } from "./ConfirmDialog";
import { errorMessage, parseGitError } from "./gitVersion";
import { deleteTagPrompt } from "./refWrites";
import {
  deleteRemoteBranchPrompt,
  failureView,
  forcePushPrompt,
  gitArgv,
  needsTypedConfirm,
  onOpEvent,
  remoteBranchName,
  startOp,
  typedConfirmRefusal,
  typedForcePushPrompt,
  type FailureView,
  type LeasePlan,
  type NetworkKind,
  type NetworkRequest,
  type NextAction,
  type PullStrategy,
  type RemoteOutcome,
  type RunningOp,
  type SyncStatus,
} from "./remoteOps";
import type { OpEvent } from "./speedup";
import type { Toast } from "./toasts";
import type { GraphRefsReader } from "./useGraphRefs";
import type { Staging } from "./useStaging";

/** A refused network operation, open in the output panel. */
export interface RemoteFailure {
  kind: NetworkKind;
  request: NetworkRequest;
  view: FailureView;
  /** What git printed, the last 64 KiB, behind Details. Untrusted text. */
  output: string;
  /** The remotes "Push and set upstream" picks among, and the branch it pushes. */
  upstream?: { branch: string; remotes: string[] };
}

export interface RemoteOps {
  /** The selected worktree's branch, upstream and counts, or null before they are read. */
  sync: SyncStatus | null;
  /** The network operation running from this Topos, or null. */
  running: RunningOp | null;
  failure: RemoteFailure | null;
  closeFailure: () => void;
  fetch: () => void;
  pull: () => void;
  push: () => void;
  /** Cancels the running operation; it ends in a "Cancelled" toast. */
  cancel: () => void;
  /** Runs the running operation's command, or the failed one's, in a shell terminal instead. */
  runInTerminal: () => void;
  /** Runs one of the output panel's next actions. */
  act: (action: NextAction) => void;
  /** Pushes the one tag `name` to `remote`. */
  pushTag: (remote: string, name: string) => void;
  /** Asks, then deletes `branch` from `remote`. */
  deleteRemoteBranch: (remote: string, branch: string) => void;
  /**
   * Asks, then deletes the local tag `name` with `deleteLocal`, offering to delete it from the
   * remotes that have it too. `deleteLocal` resolves to whether the local delete succeeded.
   */
  deleteTag: (name: string, deleteLocal: (name: string) => Promise<boolean>) => void;
}

interface Options {
  worktreePath: string | null;
  repoPath: string | null;
  staging: Staging;
  refs: GraphRefsReader;
  /** Hands a new HEAD to the refresh table, as a commit does. */
  onLanded: (head: string) => void;
  toast: (toast: Omit<Toast, "id">) => void;
  openDialog: (request: ConfirmRequest) => void;
  /**
   * Opens a plain shell terminal in `cwd` and types `argv` into it, quoted for its shell, then
   * Enter. Resolves to false when it couldn't.
   */
  onRunInTerminal?: (cwd: string, argv: string[]) => Promise<boolean>;
}

const COMMAND: Record<NetworkKind, string> = {
  fetch: "git_fetch",
  pull: "git_pull",
  push: "git_push",
  pushTag: "git_push_tag",
  pushDelete: "git_push_delete",
};

/** How long the lookup of which remotes have a tag may take before the delete stays local. */
const TAG_LOOKUP_MS = 15_000;

/** The arguments `request`'s command takes, beside the worktree, the op id and the channel. */
function commandArgs(request: NetworkRequest): Record<string, unknown> {
  switch (request.kind) {
    case "fetch":
      return { from: request.from, prune: request.prune };
    case "pull":
      return { strategy: request.strategy, remember: request.remember };
    case "push":
      return {
        ref: request.branch,
        remote: request.remote,
        setUpstream: request.setUpstream,
        lease: request.lease === undefined ? null : { expectedSha: request.lease.expectedSha },
      };
    case "pushTag":
      return { remote: request.remote, name: request.name };
    case "pushDelete":
      return { remote: request.remote, ref: request.ref };
  }
}

/** `refs/heads/topic` or `refs/tags/v1` as the branch `topic` or the tag `v1`. */
function refWords(ref: string): string {
  if (ref.startsWith("refs/heads/")) return `the branch ${ref.slice("refs/heads/".length)}`;
  if (ref.startsWith("refs/tags/")) return `the tag ${ref.slice("refs/tags/".length)}`;
  return ref;
}

/** The success toast of `request`. */
function doneText(request: NetworkRequest, outcome: RemoteOutcome): string {
  const upstream = outcome.sync.upstream;
  switch (request.kind) {
    case "fetch":
      return request.from.kind === "all" ? "Fetched every remote" : `Fetched ${request.from.name}`;
    case "pull":
      return upstream === null ? "Pulled" : `Pulled from ${upstream}`;
    case "push":
      if (request.lease !== undefined) return `Force pushed ${request.branch} with a lease`;
      return upstream === null ? `Pushed ${request.branch}` : `Pushed ${request.branch} to ${upstream}`;
    case "pushTag":
      return `Pushed the tag ${request.name} to ${request.remote}`;
    case "pushDelete":
      return `Deleted ${refWords(request.ref)} from ${request.remote}`;
  }
}

const STRATEGY_CHOICES: { value: PullStrategy; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "rebase", label: "Rebase" },
  { value: "fastForward", label: "Fast-forward only" },
];

/**
 * Fetch, pull and push for Topos's toolbar and palette (#367, #395). Each streams its progress to
 * the toolbar, says when git has gone quiet, takes the HEAD and refs it returns at once, and
 * reports success in a toast and a refusal in the output panel. The backend's per-repo lock is
 * what keeps one network operation per repo; this only keeps the toolbar from starting a second.
 */
export function useRemoteOps({ worktreePath, repoPath, staging, refs, onLanded, toast, openDialog, onRunInTerminal }: Options): RemoteOps {
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [running, setRunning] = useState<RunningOp | null>(null);
  const [failure, setFailure] = useState<RemoteFailure | null>(null);
  // The running op's id and request, for Cancel and Run in terminal.
  const current = useRef<{ opId: string; request: NetworkRequest; worktree: string } | null>(null);
  const { exclusive, reload } = staging;
  const { accept } = refs;

  // The counts are read again whenever the refs are, so a commit or a terminal's fetch shows too.
  // Only the newest read may land, so a slow one can't overwrite a newer.
  const syncRead = useRef(0);
  const refsState = refs.refs;
  useEffect(() => {
    const id = ++syncRead.current;
    if (worktreePath === null) {
      setSync(null);
      return;
    }
    invoke<SyncStatus>("git_sync_status", { worktreePath }).then(
      (status) => {
        if (id === syncRead.current) setSync(status);
      },
      () => {
        if (id === syncRead.current) setSync(null);
      }
    );
  }, [worktreePath, refsState]);
  useEffect(() => setFailure(null), [worktreePath]);

  // Resolves to whether the operation succeeded, so a step can follow it.
  const run = useCallback(
    function runRequest(request: NetworkRequest): Promise<boolean> {
      if (worktreePath === null) return Promise.resolve(false);
      if (current.current !== null) {
        toast({ tone: "failed", text: "Wait for the running fetch, pull or push, or cancel it" });
        return Promise.resolve(false);
      }
      setFailure(null);
      const call = (worktree: string) => {
        const opId = crypto.randomUUID();
        current.current = { opId, request, worktree };
        let op = startOp(request.kind);
        setRunning(op);
        const onEvent = new Channel<OpEvent>();
        onEvent.onmessage = (event) => {
          op = onOpEvent(op, event);
          if (current.current?.opId === opId) setRunning(op);
        };
        return invoke<RemoteOutcome>(COMMAND[request.kind], { worktreePath: worktree, opId, onEvent, ...commandArgs(request) })
          .then(
            (outcome) => {
              if (repoPath !== null) accept(repoPath, outcome.refs);
              if (outcome.head !== null) onLanded(outcome.head);
              if (worktree === worktreePath) setSync(outcome.sync);
              if (request.kind === "pull") void reload();
              toast(
                outcome.conflicts
                  ? { tone: "failed", text: "The pull stopped on conflicts. Resolve them from the banner." }
                  : { tone: "done", text: doneText(request, outcome) }
              );
              return !outcome.conflicts;
            },
            (e: unknown) => {
              const error = parseGitError(e);
              if (error?.kind === "cancelled") {
                toast({ tone: "done", text: `Cancelled the ${request.kind}` });
              } else if (error?.kind === "divergentPullNeedsStrategy") {
                openDialog({
                  title: "Pull diverged branches",
                  detail:
                    "This branch and its upstream each have commits the other lacks, and git config doesn't say how to pull them. Pick how, for this pull.",
                  confirmLabel: "Pull",
                  choice: { label: "Strategy", options: STRATEGY_CHOICES },
                  checkbox: { label: "Remember for this repo", initial: false },
                  onSubmit: ({ choice, checked }) => {
                    const strategy = STRATEGY_CHOICES.find((c) => c.value === choice)?.value;
                    if (strategy === undefined) return Promise.resolve("Pick a strategy");
                    // The dialog closes at once; the pull runs on the toolbar like any other.
                    queueMicrotask(() => void runRequest({ kind: "pull", strategy, remember: checked }));
                    return Promise.resolve(null);
                  },
                });
              } else {
                const view = error === null ? { title: `The ${request.kind} failed`, lines: [errorMessage(e)], actions: [] } : failureView(request.kind, error);
                const upstream = error?.kind === "noUpstream" ? { branch: error.branch, remotes: error.remotes } : undefined;
                setFailure({ kind: request.kind, request, view, output: op.output, upstream });
              }
              return false;
            }
          )
          .finally(() => {
            if (current.current?.opId === opId) current.current = null;
            setRunning((r) => (r === op || current.current === null ? null : r));
          });
      };
      if (request.kind === "pull") {
        // A pull writes the worktree, so it takes the worktree's staging slot too.
        const ran = exclusive({ action: "pull", target: { kind: "all" } }, call);
        if (ran !== null) return ran;
        toast({ tone: "failed", text: "Wait for the git operation running in this worktree" });
        return Promise.resolve(false);
      }
      return call(worktreePath);
    },
    [worktreePath, repoPath, exclusive, reload, accept, onLanded, toast, openDialog]
  );

  const fetch = useCallback(() => void run({ kind: "fetch", from: { kind: "all" }, prune: true }), [run]);
  const pull = useCallback(() => void run({ kind: "pull", strategy: null, remember: false }), [run]);
  const push = useCallback(() => {
    if (sync?.branch == null) {
      toast({ tone: "failed", text: "Check out a branch to push it" });
      return;
    }
    void run({ kind: "push", branch: sync.branch, remote: null, setUpstream: false });
  }, [run, sync, toast]);

  /**
   * Force push (with lease)…, from a push refused as non-fast-forward: the confirm names what it
   * overwrites as of the last fetch, main, master and the remote's default branch need their name
   * typed too, and the push leases on the remote-tracking sha the confirm showed.
   */
  const forcePush = useCallback(() => {
    const request = failure?.request;
    if (request?.kind !== "push" || request.lease !== undefined || worktreePath === null) return;
    const { branch } = request;
    invoke<LeasePlan>("git_push_lease_plan", { worktreePath, ref: branch, remote: request.remote }).then(
      (plan) => {
        const lease = { kind: "push", branch, remote: plan.remote, setUpstream: false, lease: { expectedSha: plan.expectedSha, remoteRef: plan.remoteRef } } as const;
        const typed = () => {
          const words = typedForcePushPrompt(plan);
          const name = remoteBranchName(plan.remoteRef);
          openDialog({
            ...words,
            onSubmit: ({ text }) => {
              const refused = typedConfirmRefusal(text, name);
              if (refused !== null) return Promise.resolve(refused);
              queueMicrotask(() => void run(lease));
              return Promise.resolve(null);
            },
          });
        };
        openDialog({
          ...forcePushPrompt(branch, plan),
          onConfirm: () => (needsTypedConfirm(plan) ? typed() : void run(lease)),
        });
      },
      (e: unknown) => toast({ tone: "failed", text: `Can't force push ${branch}: ${errorMessage(e)}` })
    );
  }, [failure, worktreePath, openDialog, run, toast]);

  const pushTag = useCallback((remote: string, name: string) => void run({ kind: "pushTag", remote, name }), [run]);

  const deleteRemoteBranch = useCallback(
    (remote: string, branch: string) =>
      openDialog({ ...deleteRemoteBranchPrompt(remote, branch), onConfirm: () => void run({ kind: "pushDelete", remote, ref: `refs/heads/${branch}` }) }),
    [openDialog, run]
  );

  // The remotes that have a tag, from the backend's ls-remote, or null when that failed or took
  // longer than TAG_LOOKUP_MS, which cancels it.
  const tagRemotes = useCallback(
    (name: string): Promise<string[] | null> => {
      if (worktreePath === null || (sync?.remotes.length ?? 0) === 0) return Promise.resolve([]);
      const opId = crypto.randomUUID();
      const onEvent = new Channel<OpEvent>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          void invoke("git_op_cancel", { opId }).catch(console.error);
          resolve(null);
        }, TAG_LOOKUP_MS);
      });
      const looked = invoke<string[]>("git_tag_remotes", { worktreePath, name, opId, onEvent }).catch(() => null);
      return Promise.race([looked, timedOut]).finally(() => clearTimeout(timer));
    },
    [worktreePath, sync]
  );

  const deleteTag = useCallback(
    (name: string, deleteLocal: (name: string) => Promise<boolean>) => {
      void tagRemotes(name).then((onRemotes) => {
        openDialog({
          ...deleteTagPrompt(name, onRemotes),
          onConfirm: (alsoRemote) => {
            void deleteLocal(name).then(async (deleted) => {
              if (!deleted || !alsoRemote || onRemotes === null) return;
              for (const remote of onRemotes) {
                if (!(await run({ kind: "pushDelete", remote, ref: `refs/tags/${name}` }))) return;
              }
            });
          },
        });
      });
    },
    [tagRemotes, openDialog, run]
  );

  const cancel = useCallback(() => {
    const op = current.current;
    if (op !== null) void invoke("git_op_cancel", { opId: op.opId }).catch(console.error);
  }, []);

  const runInTerminal = useCallback(() => {
    const op = current.current;
    const request = op?.request ?? failure?.request;
    const worktree = op?.worktree ?? worktreePath;
    if (request === undefined || worktree === null) return;
    if (onRunInTerminal === undefined) {
      toast({ tone: "failed", text: "Quay can't open a terminal here" });
      return;
    }
    // The hung op would race the terminal's, so it stops first.
    if (op !== null) void invoke("git_op_cancel", { opId: op.opId }).catch(console.error);
    setFailure(null);
    onRunInTerminal(worktree, gitArgv(request)).then(
      (typed) =>
        toast(
          typed
            ? { tone: "done", text: "Finish in the terminal; Topos refreshes when git is done" }
            : { tone: "failed", text: "That command can't be typed into a terminal safely" }
        ),
      (e: unknown) => toast({ tone: "failed", text: `Couldn't open a terminal: ${String(e)}` })
    );
  }, [failure, worktreePath, onRunInTerminal, toast]);

  const act = useCallback(
    (action: NextAction) => {
      switch (action) {
        case "pull":
          return pull();
        case "fetch":
          return fetch();
        case "forcePushWithLease":
          return forcePush();
        case "retry":
          if (failure !== null) void run(failure.request);
          return;
        case "runInTerminal":
          return runInTerminal();
        case "pushSetUpstream": {
          const upstream = failure?.upstream;
          if (upstream === undefined) return;
          const { branch, remotes } = upstream;
          if (remotes.length === 1) {
            void run({ kind: "push", branch, remote: remotes[0], setUpstream: true });
            return;
          }
          openDialog({
            title: "Push and set upstream",
            detail: `Pushes ${branch} to a branch of the same name on the remote you pick, and tracks it.`,
            confirmLabel: "Push",
            choice: { label: "Remote", options: remotes.map((r) => ({ value: r, label: r })) },
            onSubmit: ({ choice }) => {
              if (!remotes.includes(choice)) return Promise.resolve("Pick a remote");
              queueMicrotask(() => void run({ kind: "push", branch, remote: choice, setUpstream: true }));
              return Promise.resolve(null);
            },
          });
        }
      }
    },
    [failure, pull, fetch, forcePush, run, runInTerminal, openDialog]
  );

  const closeFailure = useCallback(() => setFailure(null), []);

  return { sync, running, failure, closeFailure, fetch, pull, push, cancel, runInTerminal, act, pushTag, deleteRemoteBranch, deleteTag };
}
