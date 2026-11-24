import type { RunKind } from "../terminal/types.ts";

const CLI_NAMES: Record<RunKind, string> = {
  claude: "Claude Code",
  antigravity: "Antigravity",
  codex: "Codex",
  pi: "Pi",
  gemini: "Gemini",
  grok: "Grok",
  aider: "Aider",
  kiro: "Kiro",
  copilot: "Copilot",
  opencode: "OpenCode",
  pig: "PiG",
  powershell: "PowerShell",
  command: "Command",
  archon: "Archon",
};

/** What a surface's frame calls the CLI of a run kind. */
export const cliName = (kind: RunKind): string => CLI_NAMES[kind];
