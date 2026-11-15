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
