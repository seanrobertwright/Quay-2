// The operation banner's rules and words (#352, #389): what it says during a merge, rebase,
// cherry-pick or revert, which of Continue, Skip and Abort it offers, and what each confirms.
// Labels and subjects come from git and are untrusted text; the banner renders them as text.

import type { Operation } from "./composer.ts";
import { errorMessage, parseGitError } from "./gitVersion.ts";

/** `SideLabel` from `src-tauri/src/slices/git/operation.rs`. */
export interface SideLabel {
  role: string;
  name: string;
}

/** `ConflictKind` from `src-tauri/src/slices/git/operation.rs`. */
export type ConflictKind = "bothModified" | "bothAdded" | "deletedByThem" | "deletedByUs" | "addedByUs" | "addedByThem" | "bothDeleted";

/** `Conflict` from `src-tauri/src/slices/git/operation.rs`. */
export interface Conflict {
  path: string;
  xy: string;
  kind: ConflictKind;
}

/** `OpState` from `src-tauri/src/slices/git/operation.rs`. */
export interface OpState {
  kind: Operation;
  /** A rebase's step, from 1, and how many there are. */
  step?: number;
  total?: number;
  /** Stage 2, git's "ours"; null with no operation. */
  leftLabel: SideLabel | null;
  /** Stage 3, git's "theirs"; null with no operation. */
  rightLabel: SideLabel | null;
  /** The message Continue commits, or null when git takes it from elsewhere. */
  message: string | null;
  /** At most `STATUS_CAP` (`staging.rs`) conflicts; `conflictsTotal` counts them all. */
  conflicts: Conflict[];
  conflictsTotal: number;
}

/** One side as the banner shows it: `role · name`, with git's own word for it in the tooltip. */
export interface SideView {
  text: string;
  tooltip: string;
}

export type Underway = Exclude<Operation, "none">;

export type BannerView =
  | {
      kind: "operation";
      operation: Underway;
      title: string;
      left: SideView;
      right: SideView;
      /** Continue acts only once no unmerged entry remains, and not while a step runs. */
      canContinue: boolean;
      /** Why Continue is off: conflicts remain, or the message has no summary. Null when neither. */
      continueBlockedBy: string | null;
      /** git can skip the commit a rebase, cherry-pick or revert stopped on, never a merge. */
      canSkip: boolean;
    }
  /** Unmerged entries with no state file, such as after a conflicted `git stash pop`. */
  | { kind: "conflictsOnly"; title: string; detail: string };

/** Each operation's name in a sentence. */
const NOUN: Record<Underway, string> = { merge: "merge", rebase: "rebase", cherryPick: "cherry-pick", revert: "revert" };

/** `kind`'s noun, capitalised to start a sentence. */
function capitalNoun(kind: Underway): string {
  return NOUN[kind][0].toUpperCase() + NOUN[kind].slice(1);
}

/** What each side is, in words, before git's name for it. */
const SIDE_WORDS: Record<Underway, { left: string; right: string }> = {
  merge: { left: "Your branch as it was before the merge.", right: "The branch being merged in." },
  rebase: { left: "The commit the rebase replays onto.", right: "Your commit being replayed onto it." },
  cherryPick: { left: "Your branch.", right: "The commit being picked onto it." },
  revert: { left: "Your branch.", right: "The commit being reverted." },
};

function side(label: SideLabel | null, words: string, gitWord: string): SideView {
  const text = label === null ? "" : label.name === "" ? label.role : `${label.role} · ${label.name}`;
  return { text, tooltip: `${words} git calls this side “${gitWord}”.` };
}

/** `n` conflicted file or files. */
function conflictedFiles(n: number): string {
  return `${n.toLocaleString()} conflicted ${n === 1 ? "file" : "files"}`;
}

export interface BannerOptions {
  /** Whether a step is running. */
  running: boolean;
  /** The summary line of the message Continue commits, when `state.message` gives one to edit. */
  summary?: string;
}

/** What the banner shows for `state`, or null when there is nothing under way and nothing to resolve. */
export function bannerView(state: OpState, { running, summary }: BannerOptions): BannerView | null {
  const conflicts = state.conflictsTotal;
  if (state.kind === "none") {
    if (conflicts === 0) return null;
    return {
      kind: "conflictsOnly",
      title: `${conflictedFiles(conflicts)}, with no operation under way`,
      detail: `Resolve ${conflicts === 1 ? "the file" : "each file"} and stage it. There is nothing to continue, skip or abort.`,
    };
  }
  const words = SIDE_WORDS[state.kind];
  const blockedBy =
    conflicts > 0
      ? `Resolve and stage the ${conflictedFiles(conflicts)} to continue`
      : state.message !== null && (summary ?? "").trim() === ""
        ? "Write a summary to continue"
        : null;
  const step = state.step !== undefined && state.total !== undefined ? ` · step ${state.step} of ${state.total}` : "";
  return {
    kind: "operation",
    operation: state.kind,
    title: `${capitalNoun(state.kind)} in progress${step}`,
    left: side(state.leftLabel, words.left, "ours"),
    right: side(state.rightLabel, words.right, "theirs"),
    canContinue: blockedBy === null && !running,
    continueBlockedBy: blockedBy,
    canSkip: state.kind !== "merge",
  };
}

/** What a confirm dialog asks before Abort or Skip. */
export interface StepConfirm {
  title: string;
  detail: string;
  confirmLabel: string;
}

/** The name on `label`, or `fallback` when git gave none. */
function nameOf(label: SideLabel | null, fallback: string): string {
  return label === null || label.name === "" ? fallback : label.name;
}

/** What Abort confirms for `state`, naming what is lost, or null with nothing under way. */
export function confirmAbort(state: OpState): StepConfirm | null {
  const head = nameOf(state.leftLabel, "HEAD");
  const commit = nameOf(state.rightLabel, "this commit");
  switch (state.kind) {
    case "none":
      return null;
    case "merge":
      return {
        title: `Abort the merge of ${nameOf(state.rightLabel, "this branch")}?`,
        detail: `${head} goes back to where it was before the merge. Every conflict resolution and every change staged since the merge started is lost.`,
        confirmLabel: "Abort merge",
      };
    case "rebase": {
      const replayed = state.step === undefined ? null : state.step - 1;
      const done =
        replayed === null
          ? "The commits already replayed"
          : `The ${replayed.toLocaleString()} ${replayed === 1 ? "commit" : "commits"} already replayed`;
      return {
        title: `Abort the rebase onto ${head}?`,
        detail: `Your branch goes back to where it was before the rebase. ${done} and every resolution in this step are lost.`,
        confirmLabel: "Abort rebase",
      };
    }
    case "cherryPick":
    case "revert": {
      const noun = NOUN[state.kind];
      return {
        title: `Abort the ${noun} of “${commit}”?`,
        detail: `${head} goes back to where it was before the ${noun}. Your resolutions, and any commits this ${noun} already made, are lost.`,
        confirmLabel: `Abort ${noun}`,
      };
    }
  }
}

/** What Skip confirms for `state`, naming the commit it drops, or null when git can't skip. */
export function confirmSkip(state: OpState): StepConfirm | null {
  const title = `Skip “${nameOf(state.rightLabel, "this commit")}”?`;
  const confirmLabel = "Skip commit";
  switch (state.kind) {
    case "none":
    case "merge":
      return null;
    case "rebase":
      return {
        title,
        detail: "The rebase goes on without this commit. Its changes, and your resolutions of them, are lost from the rebased branch.",
        confirmLabel,
      };
    case "cherryPick":
      return { title, detail: "The cherry-pick goes on without picking this commit. Your resolutions of it are lost.", confirmLabel };
    case "revert":
      return { title, detail: "The revert goes on without reverting this commit. Your resolutions of it are lost.", confirmLabel };
  }
}

/** What the banner asks of the operation: `git_op_continue`, `git_op_skip` or `git_op_abort`. */
export type OpStep = "continue" | "skip" | "abort";

const STEP_WORD: Record<OpStep, string> = { continue: "Continue", skip: "Skip", abort: "Abort" };
const STEP_DONE: Record<OpStep, string> = { continue: "continued", skip: "skipped", abort: "aborted" };

/** How a failed step shows: a sentence, and for a failed hook the output the panel keeps open. */
export interface StepFailure {
  message: string;
  output: string | null;
}

/** How `e`, a rejected step, shows in the banner. */
export function stepFailure(step: OpStep, e: unknown): StepFailure {
  const error = parseGitError(e);
  const word = STEP_WORD[step];
  switch (error?.kind) {
    case "hookFailed":
      return { message: `The ${error.hook} hook failed, so ${word} committed nothing. Your message is kept.`, output: error.output };
    case "cancelled":
      return { message: `${word} cancelled. The hook was stopped, and the operation is still under way.`, output: null };
    case "conflictsRemain":
      return { message: `Resolve and stage the ${conflictedFiles(error.count)} first.`, output: null };
    case "noOperation":
      return { message: `That operation is no longer under way, so nothing was ${STEP_DONE[step]}.`, output: null };
    case "stagingBusy":
      return { message: `Wait for the running staging operation to finish, then ${step}.`, output: null };
    case "indexLocked":
      return { message: `Another git process holds index.lock. ${word} again once it's done.`, output: null };
    default:
      return { message: `Couldn't ${step}: ${errorMessage(e).trim()}`, output: null };
  }
}

/** What a step on `before` announces once it lands with the operation standing as `after`. */
export function stepDoneMessage(step: OpStep, before: OpState, after: OpState): string {
  if (before.kind === "none") return "Nothing was under way";
  const noun = NOUN[before.kind];
  const Noun = capitalNoun(before.kind);
  const skipped = step === "skip" ? "Skipped the commit; " : "";
  if (after.kind === "none") {
    if (step === "abort") return `${Noun} aborted`;
    if (step === "skip") return `${skipped}the ${noun} is done`;
    return before.kind === "merge" ? "Merge concluded" : `${Noun} finished`;
  }
  const at = after.step !== undefined && after.total !== undefined ? ` at step ${after.step} of ${after.total}` : "";
  const conflicts = after.conflictsTotal > 0 ? ` with ${conflictedFiles(after.conflictsTotal)}` : "";
  return `${skipped}${skipped ? noun : Noun} stopped${at}${conflicts}`;
}

/** Each conflict kind in words, for the Conflicts list. */
export const CONFLICT_WORDS: Record<ConflictKind, string> = {
  bothModified: "changed on both sides",
  bothAdded: "added on both sides",
  deletedByThem: "deleted on the right",
  deletedByUs: "deleted on the left",
  addedByUs: "added on the left only",
  addedByThem: "added on the right only",
  bothDeleted: "deleted on both sides",
};
