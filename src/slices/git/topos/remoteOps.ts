// Fetch, pull and push from Topos's toolbar and palette (#367, #395): what a running network
// operation shows, what each refusal offers next, and the command Run in terminal types.

import { formatDateTime } from "../../../lib/dates.ts";
import type { GitError } from "./gitVersion.ts";
import type { GitRefs } from "./graphRefs.ts";
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
}

/** `RemoteOutcome` from `src-tauri/src/slices/git/remote_ops.rs`. */
export interface RemoteOutcome {
  head: string | null;
  refs: GitRefs;
  conflicts: boolean;
  sync: SyncStatus;
}

export type NetworkKind = "fetch" | "pull" | "push";

/** A network operation to run, as its command's arguments. */
export type NetworkRequest =
  | { kind: "fetch"; from: FetchFrom; prune: boolean }
  | { kind: "pull"; strategy: PullStrategy | null; remember: boolean }
  | { kind: "push"; branch: string; remote: string | null; setUpstream: boolean };

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

const RUNNING_WORD: Record<NetworkKind, string> = { fetch: "Fetching", pull: "Pulling", push: "Pushing" };

/** What the running operation's toolbar button reads. */
export function toolbarLabel(op: RunningOp): string {
  if (op.phase === null) return `${RUNNING_WORD[op.kind]}…`;
  return op.percent === null ? `${op.phase}…` : `${op.phase} ${op.percent}%`;
}

/** What a refusal offers next, as the output panel's buttons. */
export type NextAction = "pull" | "pushSetUpstream" | "runInTerminal" | "retry";

export interface FailureView {
  /** The panel's red header. Plain text: ref names in it are untrusted. */
  title: string;
  /** Lines under it shown verbatim as text, such as a hook's `remote:` lines. */
  lines: string[];
  actions: NextAction[];
  /** The label of "Push and set upstream", for `NoUpstream`. */
  setUpstreamLabel?: string;
}

const NOUN: Record<NetworkKind, string> = { fetch: "fetch", pull: "pull", push: "push" };

/** The output panel's header, lines and next actions for `error`, a refused `kind`. */
export function failureView(kind: NetworkKind, error: GitError): FailureView {
  switch (error.kind) {
    case "nonFastForward":
      return { title: `${error.ref} on the remote has commits this branch lacks. Pull them first.`, lines: [], actions: ["pull"] };
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
        title: `The remote wanted a credential git can't ask for here. Run the ${NOUN[kind]} in a terminal to sign in.`,
        lines: [],
        actions: ["runInTerminal"],
      };
    case "hostKeyUnknown":
      return {
        title: `ssh doesn't know the remote's host key. Run the ${NOUN[kind]} in a terminal to check and accept it.`,
        lines: [],
        actions: ["runInTerminal"],
      };
    case "network":
      return { title: "git couldn't reach the remote. Check the connection and retry.", lines: [], actions: ["retry"] };
    case "other":
      return { title: `The ${NOUN[kind]} failed`, lines: [], actions: ["retry"] };
    default:
      return { title: `The ${NOUN[kind]} failed`, lines: [], actions: [] };
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
      return ["git", "push", ...(request.setUpstream ? ["--set-upstream"] : []), "--", request.remote, request.branch];
  }
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
