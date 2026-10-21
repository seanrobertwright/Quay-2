export const RUN_KINDS = [
  "claude",
  "antigravity",
  "codex",
  "pi",
  "gemini",
  "grok",
  "aider",
  "kiro",
  "copilot",
  "opencode",
  "powershell",
  "command",
  "archon",
] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export function isAgentRunKind(kind?: RunKind | string | null): boolean {
  return (
    kind === "claude" ||
    kind === "antigravity" ||
    kind === "codex" ||
    kind === "pi" ||
    kind === "gemini" ||
    kind === "grok" ||
    kind === "aider" ||
    kind === "kiro" ||
    kind === "copilot" ||
    kind === "opencode" ||
    kind === "archon"
  );
}
/**
 * The run kinds whose CLI takes a launch prompt on its command line. Mirrors
 * `RunKind::launch_prompt_form` in the backend, which decides what is actually sent.
 */
export const LAUNCH_PROMPT_RUN_KINDS = [
  "claude",
  "codex",
  "pi",
  "gemini",
  "kiro",
  "copilot",
  "opencode",
] as const satisfies readonly RunKind[];
export type LaunchPromptRunKind = (typeof LAUNCH_PROMPT_RUN_KINDS)[number];

/** Whether the CLI takes a launch prompt on its command line. */
export function takesLaunchPrompt(kind?: RunKind | string | null): boolean {
  return (LAUNCH_PROMPT_RUN_KINDS as readonly unknown[]).includes(kind);
}
export type PermissionMode = "skip" | "normal";
export type ClaudeStatus =
  | "starting"
  | "working"
  | "waiting"
  | "idle"
  | "exited"
  | "unknown";
// Kept on one line: the saved-swarm store's `stage_layouts_match_the_launcher` test reads it.
export const STAGE_LAYOUTS = ["single", "split-horizontal", "split-vertical", "grid"] as const;
export type StageLayout = (typeof STAGE_LAYOUTS)[number];

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
  task_title?: string | null;
  current_tool?: string | null;
  tool_detail?: string | null;
  custom_name?: boolean;
  /** Extra CLI flags the terminal was launched with; reused on relaunch. */
  custom_flags?: string | null;
  command_text?: string | null;
  created_at?: number;
}

/**
 * The model a terminal was launched with, read from its `--model X`, `--model=X` or `-m X`
 * flag, or null when it runs the agent's default model.
 */
export function launchModel(flags?: string | null): string | null {
  if (!flags) return null;
  const tokens = flags.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--model=")) return t.slice("--model=".length) || null;
    if ((t === "--model" || t === "-m") && i + 1 < tokens.length) return tokens[i + 1];
  }
  return null;
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
  env_vars?: Record<string, string>;
  custom_flags?: string;
  /** The launch prompt, passed to the CLI as one argument; a relaunch never resends it. */
  initial_prompt?: string | null;
}

export interface PtyOutputPayload {
  terminal_id: string;
  data: string;
  seq: number;
}

export interface TerminalOutputPayload {
  terminal_id: string;
  data: string;
  last_seq: number;
}
