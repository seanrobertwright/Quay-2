// The Topos commit composer's rules and words (#366, #388): the summary counter, how a message
// splits into summary and description, what the composer offers in each state of the worktree,
// the per-worktree draft, and the sentences it shows and announces.

import { errorMessage, parseGitError } from "./gitVersion.ts";
import type { KeyPress } from "./stagingKeys.ts";

/** Past this many characters the summary counter turns amber. A hint only. */
export const SUMMARY_SOFT_LIMIT = 50;
/** Past this many characters it turns red. Still a hint: the commit isn't blocked. */
export const SUMMARY_HARD_LIMIT = 72;

export interface SummaryHint {
  count: number;
  /** `long` shows amber and `tooLong` red; `text` says the same without the color. */
  level: "ok" | "long" | "tooLong";
  text: string;
  /** The counter's accessible description. */
  spoken: string;
}

/** The summary counter for `summary`, counting characters rather than UTF-16 units. */
export function summaryHint(summary: string): SummaryHint {
  const count = [...summary].length;
  if (count > SUMMARY_HARD_LIMIT) {
    return {
      count,
      level: "tooLong",
      text: `${count} · over ${SUMMARY_HARD_LIMIT}`,
      spoken: `${count} characters, over the ${SUMMARY_HARD_LIMIT} most tools show`,
    };
  }
  if (count > SUMMARY_SOFT_LIMIT) {
    return {
      count,
      level: "long",
      text: `${count} · over ${SUMMARY_SOFT_LIMIT}`,
      spoken: `${count} characters, over the ${SUMMARY_SOFT_LIMIT} a summary usually keeps to`,
    };
  }
  return { count, level: "ok", text: `${count}`, spoken: `${count} characters` };
}

/** The composer's two fields. */
export interface MessageFields {
  summary: string;
  description: string;
}

/** The message to commit: the summary, then the description after one blank line when it has one. */
export function composeMessage({ summary, description }: MessageFields): string {
  const body = description.trimEnd();
  return body.trim() === "" ? `${summary}\n` : `${summary}\n\n${body}\n`;
}

/** `message` split into the composer's fields: its first line, and the rest without the blank lines between. */
export function splitMessage(message: string): MessageFields {
  const text = message.replace(/\r\n/g, "\n");
  const newline = text.indexOf("\n");
  if (newline === -1) return { summary: text, description: "" };
  return { summary: text.slice(0, newline), description: text.slice(newline + 1).replace(/^\n+/, "").trimEnd() };
}

/** `Operation` from `src-tauri/src/slices/git/commit.rs`. */
export type Operation = "none" | "merge" | "rebase" | "cherryPick" | "revert";

/** `CommitContext` from `src-tauri/src/slices/git/commit.rs`. */
export interface CommitContext {
  operation: Operation;
  /** In a merge, `MERGE_MSG` without its comment lines. */
  mergeMessage: string | null;
  /** The branch HEAD is on, or null when HEAD is detached. */
  branch: string | null;
  /** HEAD's commit, or null on an unborn branch. */
  head: { oid: string; message: string; onUpstream: boolean } | null;
}

/** A line the composer shows above its button, which never blocks the commit. */
export interface ComposerNote {
  kind: "detached" | "pushed";
  text: string;
}

export type ComposerButton = "Commit" | "Commit merge" | "Amend commit";

export type ComposerView =
  | {
      kind: "composer";
      button: ComposerButton;
      canCommit: boolean;
      /** Why Commit is off, or null when it is on. */
      blockedBy: string | null;
      amendAvailable: boolean;
      notes: ComposerNote[];
    }
  /** During a rebase, cherry-pick or revert the banner's Continue commits, not the composer. */
  | { kind: "pointer"; operation: "rebase" | "cherryPick" | "revert"; text: string };

export interface ComposerInput {
  context: CommitContext;
  /** How many changes are staged. */
  staged: number;
  amend: boolean;
  summary: string;
}

const OPERATION_NAME = { rebase: "rebase", cherryPick: "cherry-pick", revert: "revert" } as const;

/** What the composer offers for `input` (#366): the button, whether it acts, and its notes. */
export function composerView({ context, staged, amend, summary }: ComposerInput): ComposerView {
  const { operation } = context;
  if (operation === "rebase" || operation === "cherryPick" || operation === "revert") {
    return {
      kind: "pointer",
      operation,
      text: `A ${OPERATION_NAME[operation]} is under way. Continue it with Continue in the operation banner, which commits for each step.`,
    };
  }
  const merge = operation === "merge";
  // git refuses to amend in the middle of a merge.
  const amendAvailable = context.head !== null && !merge;
  const amending = amend && amendAvailable;
  const blockedBy =
    summary.trim() === ""
      ? "Write a summary to commit"
      : staged === 0 && !amending && !merge
        ? "Stage a change to commit, or tick Amend"
        : null;
  const notes: ComposerNote[] = [];
  if (context.branch === null && context.head !== null) {
    notes.push({ kind: "detached", text: "HEAD is detached, so this commit will be on no branch. Create a branch on it to keep it." });
  }
  if (amending && context.head?.onUpstream) {
    notes.push({
      kind: "pushed",
      text: "HEAD is already on its upstream, so amending rewrites a commit others may have. Pushing it will need a force push.",
    });
  }
  return {
    kind: "composer",
    button: merge ? "Commit merge" : amending ? "Amend commit" : "Commit",
    canCommit: blockedBy === null,
    blockedBy,
    amendAvailable,
    notes,
  };
}

/** How a failed commit shows: a sentence, and for a failed hook the output the panel keeps open. */
export interface CommitFailure {
  message: string;
  output: string | null;
}

/** How `e`, a rejected `git_commit`, shows in the composer. The message is always kept. */
export function commitFailure(e: unknown): CommitFailure {
  const error = parseGitError(e);
  switch (error?.kind) {
    case "hookFailed":
      return { message: `The ${error.hook} hook failed, so nothing was committed. Your message is kept.`, output: error.output };
    case "cancelled":
      return { message: "Commit cancelled. The hook was stopped and nothing was committed.", output: null };
    case "stagingBusy":
      return { message: "Wait for the running staging operation to finish, then commit.", output: null };
    case "indexLocked":
      return { message: "Another git process holds index.lock. Commit again once it's done.", output: null };
    default:
      return { message: `Couldn't commit: ${errorMessage(e).trim()}`, output: null };
  }
}

/** What a commit that landed as `newHeadOid` announces. */
export function committedMessage(newHeadOid: string, { button, branch }: { button: ComposerButton; branch: string | null }): string {
  const short = newHeadOid.slice(0, 7);
  const where = branch === null ? "a detached HEAD" : branch;
  switch (button) {
    case "Amend commit":
      return branch === null ? `Amended the detached HEAD's commit, now ${short}` : `Amended ${branch}'s last commit, now ${short}`;
    case "Commit merge":
      return `Committed merge ${short} on ${where}`;
    case "Commit":
      return `Committed ${short} on ${where}`;
  }
}

const EMPTY_DRAFT: MessageFields = { summary: "", description: "" };

/**
 * The composer's unsent message per worktree, for the app's session. A failed commit leaves it,
 * and a commit that lands clears it. Sign off is not part of it, so it is never remembered.
 */
export class CommitDrafts {
  private readonly drafts = new Map<string, MessageFields>();

  get(worktree: string): MessageFields {
    return this.drafts.get(worktree) ?? EMPTY_DRAFT;
  }

  set(worktree: string, fields: MessageFields): void {
    this.drafts.set(worktree, fields);
  }

  clear(worktree: string): void {
    this.drafts.delete(worktree);
  }
}

/** The drafts for this session. */
export const commitDrafts = new CommitDrafts();

/** Whether `e` is `Ctrl+Enter`, which commits from the summary or the description. */
export function isCommitKey(e: KeyPress): boolean {
  return e.key === "Enter" && e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
}

/** The most hook output the panel keeps, as the backend caps it. */
export const MAX_OUTPUT_CHARS = 64 * 1024;

/** `output` with `chunk` added, keeping the newest {@link MAX_OUTPUT_CHARS}. */
export function appendOutput(output: string, chunk: string): string {
  const next = output + chunk;
  return next.length > MAX_OUTPUT_CHARS ? next.slice(next.length - MAX_OUTPUT_CHARS) : next;
}
