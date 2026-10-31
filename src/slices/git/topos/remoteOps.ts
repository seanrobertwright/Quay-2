// Fetch, pull and push from Topos's toolbar and palette (#367, #395), and force push with lease,
// tag pushes and remote deletes (#396): what a running network operation shows, what each refusal
// offers next, what each confirm says, and the command Run in terminal types. Every remote and ref
// name in these strings is untrusted, so they are only ever rendered as text.

import { formatDateTime } from "../../../lib/dates.ts";
import type { GitError } from "./gitVersion.ts";
import type { GitRefs } from "./graphRefs.ts";
import { shortOid } from "./graphStore.ts";
import type { OpEvent } from "./speedup.ts";

/** `FetchFrom` from `src-tauri/src/slices/git/remote_ops.rs`. */
export type FetchFrom = { kind: "all" } | { kind: "remote"; name: string };

/** `PullStrategy` from `src-tauri/src/slices/git/remote_ops.rs`. */
export type PullStrategy = "merge" | "rebase" | "fastForward";

/** `SyncStatus` from `src-tauri/src/slices/git/remote_ops.rs`. */
export interface SyncStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  fetchedAtMs: number | null;
  /** The repo's remotes by name. */
  remotes: string[];
}

/** `RemoteOutcome` from `src-tauri/src/slices/git/remote_ops.rs`. */
export interface RemoteOutcome {
  head: string | null;
  refs: GitRefs;
  conflicts: boolean;
  sync: SyncStatus;
}

export type NetworkKind = "fetch" | "pull" | "push" | "pushTag" | "pushDelete";

/**
 * A force push's lease: the remote-tracking sha its confirm showed, and the remote branch it
 * overwrites, for Run in terminal. Only `expectedSha` reaches the backend.
 */
export interface Lease {
  expectedSha: string;
  remoteRef: string;
}

/** A network operation to run, as its command's arguments. */
export type NetworkRequest =
  | { kind: "fetch"; from: FetchFrom; prune: boolean }
  | { kind: "pull"; strategy: PullStrategy | null; remember: boolean }
  | { kind: "push"; branch: string; remote: string | null; setUpstream: boolean; lease?: Lease }
  | { kind: "pushTag"; remote: string; name: string }
  /** `ref` is a full `refs/heads/…` or `refs/tags/…` name. */
  | { kind: "pushDelete"; remote: string; ref: string };

/** A running network operation, as the toolbar and the output panel show it. */
export interface RunningOp {
  kind: NetworkKind;
  /** git's latest progress phase, or null before the first. */
  phase: string | null;
  percent: number | null;
  /** git has printed nothing for 30 s; the backend says so, and the op keeps running. */
  stalled: boolean;
  /** What git printed, the last [`MAX_OUTPUT_BYTES`] of it. Untrusted text, never HTML. */
  output: string;
}

/** The stall notice's words (#367). */
export const STALL_NOTICE = "Waiting on the remote. Git may need a credential prompt.";

/** The most of git's output the output panel keeps, as the backend's capture does. */
export const MAX_OUTPUT_BYTES = 64 * 1024;

const encoder = new TextEncoder();

/** `text` followed by `chunk`, with whole characters dropped from the front past [`MAX_OUTPUT_BYTES`]. */
export function appendCapped(text: string, chunk: string): string {
  const joined = text + chunk;
  let over = encoder.encode(joined).length - MAX_OUTPUT_BYTES;
  if (over <= 0) return joined;
  let cut = 0;
  for (const ch of joined) {
    if (over <= 0) break;
    over -= encoder.encode(ch).length;
    cut += ch.length;
  }
  return joined.slice(cut);
}

export function startOp(kind: NetworkKind): RunningOp {
  return { kind, phase: null, percent: null, stalled: false, output: "" };
}

/** `op` after one of its events. Any progress or output clears a stall notice. */
export function onOpEvent(op: RunningOp, event: OpEvent): RunningOp {
  switch (event.event) {
    case "progress":
      return { ...op, phase: event.phase, percent: event.percent ?? null, stalled: false };
    case "output":
      return { ...op, output: appendCapped(op.output, event.chunk), stalled: false };
    case "stalled":
      return { ...op, stalled: true };
    default:
      return op;
  }
}

const RUNNING_WORD: Record<NetworkKind, string> = {
  fetch: "Fetching",
  pull: "Pulling",
  push: "Pushing",
  pushTag: "Pushing the tag",
  pushDelete: "Deleting from the remote",
};

/** What each kind of operation is called in a refusal's header. */
const NOUN: Record<NetworkKind, string> = { fetch: "fetch", pull: "pull", push: "push", pushTag: "tag push", pushDelete: "remote delete" };

/** What the running operation's toolbar button reads. */
export function toolbarLabel(op: RunningOp): string {
  if (op.phase === null) return `${RUNNING_WORD[op.kind]}…`;
  return op.percent === null ? `${op.phase}…` : `${op.phase} ${op.percent}%`;
}

/** What a refusal offers next, as the output panel's buttons. */
export type NextAction = "pull" | "forcePushWithLease" | "fetch" | "pushSetUpstream" | "runInTerminal" | "retry";

export interface FailureView {
  /** The panel's red header. Plain text: ref names in it are untrusted. */
  title: string;
  /** Lines under it shown verbatim as text, such as a hook's `remote:` lines. */
  lines: string[];
  actions: NextAction[];
  /** The label of "Push and set upstream", for `NoUpstream`. */
  setUpstreamLabel?: string;
}

/**
 * The output panel's header, lines and next actions for `error`, a refused `kind`. Force push
 * (with lease) is offered here only, after a branch push is refused as non-fast-forward (#367):
 * never as a toolbar button or a key.
 */
export function failureView(kind: NetworkKind, error: GitError): FailureView {
  const noun = NOUN[kind];
  switch (error.kind) {
    case "nonFastForward":
      return kind === "push"
        ? { title: `${error.ref} on the remote has commits this branch lacks. Pull them first.`, lines: [], actions: ["pull", "forcePushWithLease"] }
        : { title: `${error.ref} on the remote has commits this branch lacks`, lines: [], actions: [] };
    case "leaseRefused":
      return {
        title: `${error.ref} on the remote moved since Topos last fetched, so the force push overwrote nothing. Fetch and look again.`,
        lines: [],
        actions: ["fetch"],
      };
    case "noUpstream": {
      const label =
        error.remotes.length === 1 ? `Push and set upstream to ${error.remotes[0]}/${error.branch}` : "Push and set upstream…";
      const title = `${error.branch} has no upstream branch`;
      return kind === "push"
        ? { title, lines: [], actions: error.remotes.length > 0 ? ["pushSetUpstream"] : [], setUpstreamLabel: label }
        : { title: `${title}. Push it and set one, or set one from its badge.`, lines: [], actions: [] };
    }
    case "remoteRejected":
      return { title: `The remote rejected ${error.ref}: ${error.reason}`, lines: error.remoteLines, actions: [] };
    case "authFailed":
      return {
        title: `The remote wanted a credential git can't ask for here. Run the ${noun} in a terminal to sign in.`,
        lines: [],
        actions: ["runInTerminal"],
      };
    case "hostKeyUnknown":
      return {
        title: `ssh doesn't know the remote's host key. Run the ${noun} in a terminal to check and accept it.`,
        lines: [],
        actions: ["runInTerminal"],
      };
    case "network":
      return { title: "git couldn't reach the remote. Check the connection and retry.", lines: [], actions: ["retry"] };
    case "other":
      return { title: `The ${noun} failed`, lines: [], actions: ["retry"] };
    default:
      return { title: `The ${noun} failed`, lines: [], actions: [] };
  }
}

const STRATEGY_FLAGS: Record<PullStrategy, string[]> = {
  merge: ["--no-rebase", "--ff"],
  rebase: ["--rebase"],
  fastForward: ["--ff-only"],
};

/**
 * The git command `request` runs, for Run in terminal, as the backend runs it without
 * `--progress` and `--porcelain`, which a terminal doesn't need. A push to its upstream is plain
 * `git push`, which git config routes as the backend's does.
 */
export function gitArgv(request: NetworkRequest): string[] {
  switch (request.kind) {
    case "fetch":
      return [
        "git",
        "fetch",
        ...(request.prune ? ["--prune"] : []),
        ...(request.from.kind === "all" ? ["--all"] : ["--", request.from.name]),
      ];
    case "pull":
      return ["git", "pull", ...(request.strategy === null ? [] : STRATEGY_FLAGS[request.strategy])];
    case "push":
      if (request.remote === null) return ["git", "push"];
      if (request.lease !== undefined) {
        const { expectedSha, remoteRef } = request.lease;
        return [
          "git",
          "push",
          `--force-with-lease=${remoteRef}:${expectedSha}`,
          "--force-if-includes",
          "--",
          request.remote,
          `refs/heads/${request.branch}:${remoteRef}`,
        ];
      }
      return ["git", "push", ...(request.setUpstream ? ["--set-upstream"] : []), "--", request.remote, request.branch];
    case "pushTag":
      return ["git", "push", "--no-follow-tags", "--", request.remote, `refs/tags/${request.name}:refs/tags/${request.name}`];
    case "pushDelete":
      return ["git", "push", "--delete", "--", request.remote, request.ref];
  }
}

/** `LeasePlan` from `src-tauri/src/slices/git/remote_ops.rs`. */
export interface LeasePlan {
  remote: string;
  /** Such as `refs/heads/main`. */
  remoteRef: string;
  /** Such as `origin/main`. */
  tracking: string;
  expectedSha: string;
  /** Remote commits the branch lacks, which the push overwrites, as of the last fetch. */
  overwrites: number;
  /** The remote's default branch from `refs/remotes/<remote>/HEAD`, or null. */
  defaultBranch: string | null;
}

/** The words of a confirm dialog with no field. */
export interface Prompt {
  title: string;
  detail: string;
  confirmLabel: string;
}

/** The branch name of the remote branch `remoteRef`: `main` for `refs/heads/main`. */
export function remoteBranchName(remoteRef: string): string {
  return remoteRef.startsWith("refs/heads/") ? remoteRef.slice("refs/heads/".length) : remoteRef;
}

/** The first confirm of a force push of `branch`: where it goes and what it overwrites. */
export function forcePushPrompt(branch: string, plan: LeasePlan): Prompt {
  const n = plan.overwrites;
  const commits = n === 0 ? "no commits" : n === 1 ? "1 commit" : `${n} commits`;
  return {
    title: `Force push ${branch} to ${plan.tracking}`,
    detail: `Overwrites ${commits} on ${plan.tracking} that ${branch} lacks, as of the last fetch (at ${shortOid(plan.expectedSha)}). If the remote moved since, git refuses and overwrites nothing.`,
    confirmLabel: "Force push",
  };
}

/** The branches a force push to always needs a typed confirmation for, beside the remote's default. */
const TYPED_BRANCHES = ["main", "master"];

/** Whether a force push to `plan`'s remote branch needs its name typed: main, master or the default. */
export function needsTypedConfirm(plan: LeasePlan): boolean {
  const branch = remoteBranchName(plan.remoteRef);
  return TYPED_BRANCHES.includes(branch) || branch === plan.defaultBranch;
}

/** The second, typed confirm of a force push to main, master or the remote's default branch. */
export function typedForcePushPrompt(plan: LeasePlan): Prompt & { field: { label: string; initial: string } } {
  const branch = remoteBranchName(plan.remoteRef);
  const isDefault = branch === plan.defaultBranch;
  return {
    title: isDefault ? `Force push to ${branch}, ${plan.remote}'s default branch` : `Force push to ${branch}`,
    detail: `Others build on ${branch}. Type its name to overwrite it on ${plan.remote}.`,
    confirmLabel: "Force push",
    field: { label: `Type ${branch} to confirm`, initial: "" },
  };
}

/** Why `typed` doesn't confirm a force push to `branch`, or null when it is the name exactly. */
export function typedConfirmRefusal(typed: string, branch: string): string | null {
  return typed === branch ? null : `Type ${branch} exactly to force push`;
}

/**
 * The remote and branch of the remote-tracking branch `name`, such as `origin/topic`, by the
 * longest of `remotes` it starts with, or null when none does or it is the remote's `HEAD`.
 */
export function remoteBranchOf(name: string, remotes: readonly string[]): { remote: string; branch: string } | null {
  let best: string | null = null;
  for (const r of remotes) {
    if (name.startsWith(`${r}/`) && (best === null || r.length > best.length)) best = r;
  }
  if (best === null) return null;
  const branch = name.slice(best.length + 1);
  return branch === "" || branch === "HEAD" ? null : { remote: best, branch };
}

/** The confirm of deleting `branch` from `remote`. */
export function deleteRemoteBranchPrompt(remote: string, branch: string): Prompt {
  return {
    title: `Delete ${branch} from ${remote}`,
    detail: `Deletes the branch ${branch} on the remote ${remote}. Others may be using it. There is no undo.`,
    confirmLabel: `Delete from ${remote}`,
  };
}

/** The toolbar's counts and their tooltip. */
export interface SyncView {
  /** Such as "↑2 ↓3", or null when there is no upstream to count against. */
  label: string | null;
  title: string;
}

export function syncView(sync: SyncStatus): SyncView {
  if (sync.branch === null) return { label: null, title: "HEAD is detached" };
  if (sync.upstream === null) return { label: null, title: `${sync.branch} tracks no upstream` };
  const asOf = sync.fetchedAtMs === null ? "no fetch yet" : formatDateTime(sync.fetchedAtMs);
  const apart =
    sync.ahead === 0 && sync.behind === 0
      ? `Up to date with ${sync.upstream}`
      : `${sync.ahead} ahead and ${sync.behind} behind ${sync.upstream}`;
  return { label: `↑${sync.ahead} ↓${sync.behind}`, title: `${apart}, as of ${asOf}` };
}
