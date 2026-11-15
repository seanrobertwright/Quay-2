export interface GithubUser {
  login: string;
  name?: string | null;
}

export interface GithubLabel {
  name: string;
  color?: string;
  description?: string | null;
}

/** An open issue that blocks another, from GitHub's native issue dependencies. */
export interface GithubIssueRef {
  number: number;
  title: string;
  state: string;
  url: string;
  /** `owner/name` of the blocker's repository. */
  repoNwo: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  state: string;
  author?: GithubUser | null;
  labels: GithubLabel[];
  assignees: GithubUser[];
  updatedAt: string;
  url: string;
  /** Open blockers only; closed blockers no longer block. */
  blockedBy: GithubIssueRef[];
  /** GitHub's count of open blockers; can exceed `blockedBy.length`. */
  openBlockerCount: number;
}

export interface GithubIssueDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  author?: GithubUser | null;
  labels: GithubLabel[];
  assignees: GithubUser[];
  updatedAt: string;
  url: string;
  /** Open blockers only; closed blockers no longer block. */
  blockedBy: GithubIssueRef[];
  /** GitHub's count of open blockers; can exceed `blockedBy.length`. */
  openBlockerCount: number;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  labels: GithubLabel[];
  author?: GithubUser | null;
  /** The head commit's check rollup, e.g. `{ state: "SUCCESS" }`. */
  statusCheckRollup?: { state: string } | null;
  mergeable?: string | null;
  url: string;
  /** The tickets in the pull request's own repository that its `Closes #N` names. */
  closingIssues: number[];
}

export interface GithubRepoInfo {
  owner: string;
  name: string;
  nwo: string;
  is_authenticated: boolean;
}

/** How a pull request's head commit checks stand, counted by outcome. */
export interface PullRequestCheckCounts {
  /** Failed, timed out, cancelled, or waiting on an action. */
  failing: number;
  /** Queued or running. */
  pending: number;
  /** Skipped, neutral or stale. */
  skipped: number;
  passing: number;
}

/** GitHub's `PullRequestState`. */
export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

/** GitHub's `MergeableState`. */
export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

/** GitHub's `MergeStateStatus`. */
export type MergeStateStatus = "BEHIND" | "BLOCKED" | "CLEAN" | "DIRTY" | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE";

/** GitHub's `PullRequestReviewDecision`. */
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

/**
 * What the companion's pull request view reads about one pull request: its header, and what the
 * readiness card needs to say whether it can merge. Mirrors `PullRequestReadiness` in the backend.
 */
export interface PullRequestReadiness {
  /** `owner/name` of the pull request's repository. */
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  /** The head commit's SHA, which Restore branch points the branch back at. */
  headRefOid: string;
  /** Whether the head branch is still on GitHub. */
  headBranchExists: boolean;
  /** Whether the head branch is in a fork. */
  isCrossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus;
  /** Null when no review is asked for. */
  reviewDecision: ReviewDecision | null;
  checks: PullRequestCheckCounts;
  /** Conversation comments and review threads; `unresolved` counts review threads only. */
  comments: { total: number; unresolved: number };
  commits: number;
}

/** A merge method GitHub's merge API takes. */
export type MergeMethod = "merge" | "squash" | "rebase";

/** How one check turned out, as GitHub's pull request page groups them. */
export type CheckOutcome = "failing" | "pending" | "skipped" | "passing";

/** One check on a pull request's head commit. Mirrors `PullRequestCheck` in the backend. */
export interface PullRequestCheck {
  /** The check run's id, which its log is read by; null for a commit status. */
  checkRunId: number | null;
  name: string;
  /** The Actions workflow that ran it, when one did. */
  workflow: string | null;
  outcome: CheckOutcome;
  /** The check run's title or the status's description. */
  description: string | null;
  url: string | null;
}

/** The end of a check's log. */
export interface CheckLog {
  text: string;
  /** Whether lines before `text` were left out. */
  truncated: boolean;
}

/** A reply in a review thread. */
export interface TimelineReply {
  id: string;
  author: string;
  createdAt: string;
  body: string;
}

/** One item in a pull request's comment timeline. Mirrors `TimelineItem` in the backend. */
export interface TimelineItem {
  id: string;
  /** A conversation comment, a review's summary, or a review thread on a file. */
  kind: "comment" | "review" | "thread";
  author: string;
  /** GitHub's ISO 8601 UTC timestamp. */
  createdAt: string;
  body: string;
  url: string | null;
  /** A review's verdict: APPROVED, CHANGES_REQUESTED, COMMENTED or DISMISSED. */
  reviewState: string | null;
  /** A thread's file. */
  path: string | null;
  /** Whether a thread is resolved; null for other items. */
  resolved: boolean | null;
  /** A thread's replies after its first comment, oldest first. */
  replies: TimelineReply[];
}

/** A pull request's comment timeline, oldest first, and the signed-in login. */
export interface PullRequestTimeline {
  viewer: string;
  items: TimelineItem[];
  /** Whether GitHub holds more comments, reviews or threads than were read. */
  truncated: boolean;
}

/** One file a pull request changes. */
export interface PullRequestFile {
  path: string;
  /** The path before a rename. */
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  /** The unified diff hunks; null for a binary file or one too large for GitHub to show. */
  patch: string | null;
}

/** One commit on a pull request. */
export interface PullRequestCommit {
  sha: string;
  headline: string;
  author: string;
  /** GitHub's ISO 8601 UTC timestamp. */
  authoredAt: string;
  url: string | null;
}

/** Where an issue stands. */
export type IssueState = "OPEN" | "CLOSED";

/** Why an issue was closed, or REOPENED once it is open again; null when GitHub gives none. */
export type IssueStateReason = "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | "REOPENED";

/** GitHub's check rollup state for a commit. */
export type CheckRollupState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

/** Another issue the Ticket view names: a blocker or the parent. */
export interface IssueViewRef {
  /** `owner/name` of the issue's repository. */
  repo: string;
  number: number;
  title: string;
  state: IssueState;
  url: string;
}

/** A pull request that will close the issue, from GitHub's Development section. */
export interface IssuePullRequest {
  repo: string;
  number: number;
  title: string;
  state: PullRequestState;
  url: string;
  /** The head commit's check rollup; null with no checks. */
  checkState: CheckRollupState | null;
}

/** One conversation comment on an issue. */
export interface IssueComment {
  id: string;
  author: string;
  /** GitHub's ISO 8601 UTC timestamp. */
  createdAt: string;
  body: string;
  url: string;
}

/** What the companion's issue view reads about one issue. Mirrors `IssueStatus` in the backend. */
export interface IssueStatus {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  /** The issue type's name, or null when it has none. */
  issueType: string | null;
  /** Who opened it. */
  author: string;
  createdAt: string;
  /** The signed-in login. */
  viewer: string;
  assignees: string[];
  labels: GithubLabel[];
  milestone: { title: string; url: string } | null;
  parent: IssueViewRef | null;
  /** The issues that block this one, open and closed. */
  blockedBy: IssueViewRef[];
  /** GitHub's count of open blockers; can exceed the open ones in `blockedBy`. */
  openBlockerCount: number;
  /** The pull requests that will close it, open, merged and closed. */
  pullRequests: IssuePullRequest[];
  /** The most recent conversation comments, oldest first. */
  comments: IssueComment[];
  /** GitHub's count of conversation comments; can exceed `comments.length`. */
  commentCount: number;
}

/** What the issue view's Edit pickers offer in the issue's repository. */
export interface IssueChoices {
  assignees: string[];
  labels: GithubLabel[];
  /** The repository's issue types; empty where it has none. */
  types: string[];
}
