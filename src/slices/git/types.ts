export interface GitWorktree {
  path: string;
  head: string;
  branch: string;
  is_main: boolean;
  is_bare: boolean;
  is_locked: boolean;
}

export interface CreateWorktreeRequest {
  repo_path: string;
  branch: string;
  new_branch: boolean;
  base_branch?: string | null;
  custom_path?: string | null;
}
