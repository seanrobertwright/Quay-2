// Why a terminal whose CLI has not shaken hands with Quay's MCP server can't show surfaces (#733), and
// what to do about it.
import { cliName } from "../surface/cliName.ts";
import type { RunKind } from "../terminal/types.ts";
import type { AntigravityConnection, ConnectState } from "./connectTypes.ts";

export interface CannotShow {
  reason: string;
  /** What to do, where a link to the Connect row is not it. */
  remedy?: string;
  /** Whether the Connect row is where to put it right. */
  connect?: boolean;
}

const USE_ANOTHER = "Claude Code, Codex, OpenCode, PiG and Antigravity can show them.";

/** What is wrong with Antigravity's entry, in each state but the one where nothing is. */
const ENTRY_PROBLEM: Record<Exclude<ConnectState, "connected">, string> = {
  missing: "Antigravity is not connected to Quay, so it can't show surfaces.",
  unreadable: "Antigravity is not connected to Quay, because its configuration file can't be used.",
  old_relay: "Antigravity starts an old relay, not this Quay's, so it can't show surfaces.",
  changed: "Antigravity's entry for Quay is not the one Quay writes, so it may not show surfaces.",
};

/**
 * Why a terminal of `kind` can't show surfaces, or null for a kind that is no agent CLI with a prompt
 * of its own: a shell, a command or an Archon workflow. `antigravity` is where Antigravity's entry
 * stands, or null when that is not known.
 */
export function cannotShow(kind: RunKind, antigravity: AntigravityConnection | null): CannotShow | null {
  switch (kind) {
    case "powershell":
    case "command":
    case "archon":
      return null;
    case "aider":
      return { reason: "Aider has no tool channel, so it can't show surfaces.", remedy: USE_ANOTHER };
    case "copilot":
    case "pi":
    case "gemini":
    case "grok":
    case "kiro":
      return { reason: `${cliName(kind)} can't show surfaces in this release.`, remedy: USE_ANOTHER };
    case "antigravity":
      if (antigravity && antigravity.state !== "connected") return { reason: ENTRY_PROBLEM[antigravity.state], connect: true };
  }
  return {
    reason: `Quay has not seen ${cliName(kind)} connect, so it can't show surfaces.`,
    remedy: "If it stays so, relaunch the terminal.",
  };
}
