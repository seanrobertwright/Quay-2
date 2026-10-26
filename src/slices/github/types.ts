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
}

export interface GithubRepoInfo {
  owner: string;
  name: string;
  nwo: string;
  is_authenticated: boolean;
}
