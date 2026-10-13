export type RunKind = "claude" | "powershell" | "command";
export type PermissionMode = "skip" | "normal";
export type ClaudeStatus =
  | "starting"
  | "working"
  | "waiting"
  | "idle"
  | "exited"
  | "unknown";

export interface TerminalInfo {
  id: string;
  name: string;
  project_path: string;
  run_kind: RunKind;
  permission_mode: PermissionMode;
  live_mode: PermissionMode;
  claude_status: ClaudeStatus;
  auto_approved_count: number;
  exit_code?: number | null;
}

export interface SpawnTerminalRequest {
  id?: string;
  name?: string;
  project_path: string;
  run_kind: RunKind;
  permission_mode?: PermissionMode;
  command_text?: string;
  rows?: number;
  cols?: number;
}
