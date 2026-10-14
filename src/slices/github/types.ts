export interface GithubUser {
  login: string;
  name?: string | null;
}

export interface GithubLabel {
  name: string;
  color?: string;
  description?: string | null;
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
  statusCheckRollup?: any;
  mergeable?: string | null;
  url: string;
}

export interface GithubRepoInfo {
  owner: string;
  name: string;
  nwo: string;
  is_authenticated: boolean;
}
