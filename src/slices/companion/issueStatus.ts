import type { CheckRollupState, IssueComment, IssuePullRequest, IssueStatus, IssueViewRef } from "../github/types.ts";
import { parseUtcTimestamp } from "../../lib/dates.ts";

/** The colour family the status card's headline takes. */
export type StatusTone = "ready" | "blocked" | "progress" | "closed";

/** The status card's one button, which follows the ticket's state. */
export type StatusAction =
  | { kind: "implement" }
  | { kind: "show-blocker"; blocker: IssueViewRef }
  | { kind: "open-pull-request"; pullRequest: IssuePullRequest }
  | { kind: "reopen" };

/** A reason to close a ticket with, as GitHub offers them. */
export type CloseReason = "COMPLETED" | "NOT_PLANNED" | "DUPLICATE";

/** The close split button's reasons, in the order its menu lists them. */
export const CLOSE_REASONS: readonly CloseReason[] = ["COMPLETED", "NOT_PLANNED", "DUPLICATE"];

/** The close split button's words: Close as its reason, or Close with comment once text is typed. */
export function closeButtonLabel(reason: CloseReason, typed: boolean): string {
  return typed ? "Close with comment" : `Close as ${CLOSE_REASON_TEXT[reason]}`;
}

/** How the issue view names each close reason. */
export const CLOSE_REASON_TEXT: Readonly<Record<CloseReason, string>> = {
  COMPLETED: "completed",
  NOT_PLANNED: "not planned",
  DUPLICATE: "duplicate",
};

/** How a pull request's head commit checks stand, in words, from GitHub's check rollup state. */
export function checkStateText(checkState: CheckRollupState | null): string {
  switch (checkState) {
    case "SUCCESS":
      return "checks passing";
    case "FAILURE":
    case "ERROR":
      return "checks failing";
    case null:
      return "no checks";
    default:
      return "checks running";
  }
}

/** The status card's headline, its one line of reason, and its button. */
export interface StatusCard {
  tone: StatusTone;
  headline: string;
  reason: string;
  action: StatusAction;
}

/**
 * What the status card says about `issue`, by its state: a closed ticket says why and offers
 * Reopen; an open one is Blocked while a blocker is open, else shows its open pull request with
 * the pull request's check state, else is Ready to start with Implement.
 */
export function statusCard(issue: IssueStatus): StatusCard {
  if (issue.state === "CLOSED") {
    const reason = issue.stateReason && issue.stateReason !== "REOPENED" ? CLOSE_REASON_TEXT[issue.stateReason] : null;
    const merged = issue.pullRequests.find((pr) => pr.state === "MERGED");
    return {
      tone: "closed",
      headline: reason ? `Closed as ${reason}` : "Closed",
      reason: merged && issue.stateReason === "COMPLETED" ? `By ${merged.title} (#${merged.number})` : "",
      action: { kind: "reopen" },
    };
  }
  const blocker = issue.blockedBy.find((b) => b.state === "OPEN");
  if (blocker) {
    const n = Math.max(issue.openBlockerCount, 1);
    return {
      tone: "blocked",
      headline: `Blocked by ${n} open ${n === 1 ? "ticket" : "tickets"}`,
      reason: `${blocker.title} (#${blocker.number})`,
      action: { kind: "show-blocker", blocker },
    };
  }
  const pullRequest = issue.pullRequests.find((pr) => pr.state === "OPEN");
  if (pullRequest) {
    return {
      tone: "progress",
      headline: `Pull request open · ${checkStateText(pullRequest.checkState)}`,
      reason: `${pullRequest.title} (#${pullRequest.number})`,
      action: { kind: "open-pull-request", pullRequest },
    };
  }
  const assigned = issue.assignees.length ? `assigned to ${issue.assignees.join(", ")}` : "unassigned";
  return { tone: "ready", headline: "Ready to start", reason: `No open blockers · ${assigned}`, action: { kind: "implement" } };
}

/**
 * The comments the viewer has not answered: others' comments since the viewer's own last comment,
 * or since the viewer opened the ticket when they have not commented. None while the viewer has
 * taken no part in it.
 */
export function newComments(issue: IssueStatus): IssueComment[] {
  const at = (when: string) => parseUtcTimestamp(when) ?? 0;
  const mine = issue.comments.filter((c) => c.author === issue.viewer).map((c) => at(c.createdAt));
  if (issue.author === issue.viewer) mine.push(at(issue.createdAt));
  if (issue.viewer === "" || mine.length === 0) return [];
  const since = Math.max(...mine);
  return issue.comments.filter((c) => c.author !== issue.viewer && at(c.createdAt) > since);
}

/** A status card cell, which opens its detail under the card. */
export type IssueCellId = "blocked-by" | "comments" | "pull-request" | "details";

/** The cell the issue view opens on arrival: Blocked by while a blocker is open, else Comments while one is new, else none. */
export function issueArrivalCell(issue: IssueStatus): IssueCellId | null {
  if (issue.blockedBy.some((b) => b.state === "OPEN")) return "blocked-by";
  if (newComments(issue).length > 0) return "comments";
  return null;
}

/** The colour a cell's value takes: an open blocker, something waiting on the operator, or neither. */
export type IssueCellTone = "alert" | "attention" | "neutral";

/** One of the status card's cells: its name and what it holds. */
export interface IssueCell {
  id: IssueCellId;
  label: string;
  value: string;
  tone: IssueCellTone;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The pull request the Pull request cell names: the open one, else the first. */
export function shownPullRequest(issue: IssueStatus): IssuePullRequest | null {
  return issue.pullRequests.find((pr) => pr.state === "OPEN") ?? issue.pullRequests[0] ?? null;
}

/** The status card's cells, in the order the card shows them. */
export function issueCells(issue: IssueStatus): IssueCell[] {
  const openBlockers = issue.blockedBy.some((b) => b.state === "OPEN") ? Math.max(issue.openBlockerCount, 1) : 0;
  const fresh = newComments(issue).length;
  const pr = shownPullRequest(issue);
  const prOpen = pr?.state === "OPEN";
  return [
    {
      id: "blocked-by",
      label: "Blocked by",
      value: openBlockers ? `${openBlockers} open` : "None open",
      tone: openBlockers ? "alert" : "neutral",
    },
    {
      id: "comments",
      label: "Comments",
      value: fresh ? `${issue.commentCount} · ${fresh} new` : String(issue.commentCount),
      tone: fresh ? "attention" : "neutral",
    },
    {
      id: "pull-request",
      label: "Pull request",
      value: pr ? `#${pr.number} · ${prOpen ? checkStateText(pr.checkState) : pr.state.toLowerCase()}` : "None",
      tone: prOpen ? "attention" : "neutral",
    },
    {
      id: "details",
      label: "Details",
      value: `${issue.assignees.length ? issue.assignees.join(", ") : "Unassigned"} · ${plural(issue.labels.length, "label")}`,
      tone: "neutral",
    },
  ];
}
