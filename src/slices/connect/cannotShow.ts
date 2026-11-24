// Why a terminal whose CLI has not shaken hands with Quay's MCP server can't show surfaces (#733), and
// what to do about it.
import { cliName } from "../surface/cliName.ts";
import type { RunKind } from "../terminal/types.ts";
import type { AntigravityConnection, ConnectState } from "./connectTypes.ts";

/** A reason, with the remedy: words that say what to do, or the link to the Connect row. */
export type CannotShow =
  | { reason: string; remedy: "words"; words: string }
  | { reason: string; remedy: "connect row" };

/** How surfaces stand with a run kind. "no agent" is a kind that is no agent CLI with a prompt of its own. */
type Support = "can show" | "no tool channel" | "not in this release" | "no agent";

/** In the order `USE_ANOTHER` names them. */
const SUPPORT: Record<RunKind, Support> = {
  claude: "can show",
  codex: "can show",
  opencode: "can show",
  pig: "can show",
  antigravity: "can show",
  aider: "no tool channel",
  copilot: "not in this release",
  pi: "not in this release",
  gemini: "not in this release",
  grok: "not in this release",
  kiro: "not in this release",
  powershell: "no agent",
  command: "no agent",
  archon: "no agent",
};

const CAN_SHOW = (Object.keys(SUPPORT) as RunKind[]).filter((kind) => SUPPORT[kind] === "can show").map(cliName);
const USE_ANOTHER = `${CAN_SHOW.slice(0, -1).join(", ")} and ${CAN_SHOW.slice(-1)} can show them.`;

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
  const support = SUPPORT[kind];
  switch (support) {
    case "no agent":
      return null;
    case "no tool channel":
      return { reason: `${cliName(kind)} has no tool channel, so it can't show surfaces.`, remedy: "words", words: USE_ANOTHER };
    case "not in this release":
      return { reason: `${cliName(kind)} can't show surfaces in this release.`, remedy: "words", words: USE_ANOTHER };
    case "can show":
      if (kind === "antigravity" && antigravity && antigravity.state !== "connected") {
        return { reason: ENTRY_PROBLEM[antigravity.state], remedy: "connect row" };
      }
      return {
        reason: `Quay has not seen ${cliName(kind)} connect, so it can't show surfaces.`,
        remedy: "words",
        words: "If it stays so, relaunch the terminal.",
      };
    default:
      return support satisfies never;
  }
}
