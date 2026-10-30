// How Topos names a commit's agent (#381). The backend classifies each commit; nothing here reads
// trailers. An unknown stamp's value is untrusted text, shown in the tooltip only, as text.

import { isSamePath } from "../../../utils/paths.ts";
import { isAgentRunKind, type RunKind, type TerminalInfo } from "../../terminal/types.ts";
import type { AgentSource, GraphAgent } from "./graphPage.ts";

const SOURCE_NAMES: Record<AgentSource, string> = { stamp: "Quay stamp", coauthor: "co-author" };

/** A node's spoken label, which its tooltip opens with: "Commit by codex (Quay stamp)". */
export function nodeLabel(agent: GraphAgent | null, authorName: string): string {
  if (agent === null) return `Commit by ${authorName}`;
  return `Commit by ${agent.kind ?? "an unknown agent"} (${SOURCE_NAMES[agent.source]})`;
}

/** A node's tooltip lines: its label, then an unknown stamp's value. */
export function nodeTooltip(agent: GraphAgent | null, authorName: string): string[] {
  const label = nodeLabel(agent, authorName);
  return agent?.raw === undefined ? [label] : [label, `Quay-Agent: ${agent.raw}`];
}

/** The author column: the human author, with the agent after: "Sean Wright + codex". */
export function authorLine(authorName: string, agent: GraphAgent | null): string {
  if (agent === null) return authorName;
  return `${authorName} + ${agent.kind ?? "unknown agent"}`;
}

/** The kinds of the live agent terminals working in the worktree at `path`, in terminal order. */
export function liveAgentsAt(
  terminals: readonly Pick<TerminalInfo, "run_kind" | "project_path" | "claude_status" | "exit_code">[],
  path: string
): RunKind[] {
  return terminals
    .filter(
      (t) =>
        isAgentRunKind(t.run_kind) &&
        t.claude_status !== "exited" &&
        (t.exit_code === undefined || t.exit_code === null) &&
        isSamePath(t.project_path, path)
    )
    .map((t) => t.run_kind);
}

/** Agent icons a HEAD marker shows before folding the rest into "+N". */
const SHOWN_AGENTS = 3;

export function splitAgents(kinds: readonly RunKind[]): { shown: RunKind[]; more: number } {
  return { shown: kinds.slice(0, SHOWN_AGENTS), more: Math.max(0, kinds.length - SHOWN_AGENTS) };
}
