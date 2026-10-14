export interface Project {
  path: string;
  name: string;
  terminal_ids: string[];
  last_viewed_terminal?: string | null;
  env_vars?: Record<string, string>;
  default_flags?: string | null;
}
