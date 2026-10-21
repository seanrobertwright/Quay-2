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
  "pig",
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
    kind === "pig" ||
    kind === "archon"
  );
}
/**
 * Each CLI's level on the A2A bus. Mirrors `RunKind::bus_level` in the backend, which
 * decides how Quay treats a message; a run kind in none of these lists is not a peer.
 * Each list stays on one line: the backend's `bus_levels_match_the_frontend` test reads it.
 */
export const FULL_PEER_RUN_KINDS = ["claude", "codex", "opencode", "pig"] as const satisfies readonly RunKind[];
export const RESPONDER_RUN_KINDS = ["antigravity"] as const satisfies readonly RunKind[];
export const LISTENER_RUN_KINDS = ["pi", "gemini", "grok", "aider", "kiro", "copilot"] as const satisfies readonly RunKind[];
export type BusLevel = "full peer" | "responder" | "listener";

/**
 * The run kinds whose turn end Quay sees. Mirrors `RunKind::reports_turn_end` in the backend.
 * Kept on one line: the backend's `turn_end_run_kinds_match_the_frontend` test reads it.
 */
export const TURN_END_RUN_KINDS = ["claude", "antigravity", "codex", "opencode", "pig"] as const satisfies readonly RunKind[];

/**
 * The run kinds whose CLI never asks before a tool call, so they get no Skip and Ask toggle
 * and always run as Skip. Mirrors `RunKind::never_asks_before_tools` in the backend.
 * Kept on one line: the backend's `never_asks_run_kinds_match_the_frontend` test reads it.
 */
export const NEVER_ASKS_RUN_KINDS = ["pi", "pig"] as const satisfies readonly RunKind[];

/** Whether the CLI never asks before a tool call. */
export function neverAsksBeforeTools(kind?: RunKind | string | null): boolean {
  return (NEVER_ASKS_RUN_KINDS as readonly unknown[]).includes(kind);
}

/**
 * The run kinds that report through a plugin or extension that may stay silent: Claude
 * Code's event-bridge plugin and Quay's PiG extension. Mirrors
 * `RunKind::reports_through_plugin` in the backend.
 * Kept on one line: the backend's `plugin_run_kinds_match_the_frontend` test reads it.
 */
export const PLUGIN_RUN_KINDS = ["claude", "pig"] as const satisfies readonly RunKind[];

/**
 * Whether the terminal is a Claude or PiG terminal that counts as a listener only because
 * Quay hasn't heard from its event-bridge plugin or PiG extension. Mirrors
 * `TerminalInfo::plugin_silent`.
 */
export function isPluginSilent(t: Pick<TerminalInfo, "run_kind" | "claude_status">): boolean {
  return (PLUGIN_RUN_KINDS as readonly RunKind[]).includes(t.run_kind) && t.claude_status === "unknown";
}

/**
 * Whether a message reaching the terminal shows it Working: only when Quay will also see that
 * turn end. Mirrors `TerminalInfo::shows_working_on_delivery`.
 */
export function showsWorkingOnDelivery(t: Pick<TerminalInfo, "run_kind" | "claude_status">): boolean {
  return (TURN_END_RUN_KINDS as readonly RunKind[]).includes(t.run_kind) && t.claude_status !== "unknown";
}

/**
 * The terminal's level on the A2A bus now, or null when it is not a peer. Mirrors
 * `TerminalInfo::bus_level`: an Unknown Claude terminal is a listener.
 */
export function busLevel(t: Pick<TerminalInfo, "run_kind" | "claude_status">): BusLevel | null {
  if (isPluginSilent(t)) return "listener";
  const has = (kinds: readonly RunKind[]) => kinds.includes(t.run_kind);
  if (has(FULL_PEER_RUN_KINDS)) return "full peer";
  if (has(RESPONDER_RUN_KINDS)) return "responder";
  if (has(LISTENER_RUN_KINDS)) return "listener";
  return null;
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
  "pig",
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
  /** Whether the pane shows the plugin hint: this launch went 30 seconds without a plugin event. */
  plugin_hint?: boolean;
}

/** A terminal's status after the backend's plugin rules moved it, sent as `terminal-status`. */
export interface TerminalStatusPayload {
  terminal_id: string;
  claude_status: ClaudeStatus;
  plugin_hint: boolean;
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
