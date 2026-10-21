import { RunKind } from "../terminal/types";
import {
  CheckOutcome,
  GateVerdict,
  StageId,
  StageStatus,
  WorkOrderStatus,
} from "./types";

/** "$1.23"; amounts under a cent but above zero read "<$0.01". */
export function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 10);
}

export const AGENT_OPTIONS: RunKind[] = [
  "claude",
  "codex",
  "gemini",
  "copilot",
  "opencode",
  "kiro",
  "antigravity",
  "pi",
  "pig",
  "grok",
  "aider",
];

export function agentName(kind: RunKind | string): string {
  switch (kind) {
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity";
    case "kiro":
      return "Kiro CLI";
    case "codex":
      return "OpenAI Codex";
    case "copilot":
      return "GitHub Copilot";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi Agent";
    case "pig":
      return "PiG";
    case "gemini":
      return "Gemini CLI";
    case "grok":
      return "Grok CLI";
    case "aider":
      return "Aider";
    default:
      return kind;
  }
}

export const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  QUEUED: "Queued",
  SCAFFOLDING: "Scaffolding",
  IN_PROGRESS: "In progress",
  GATING: "Gate running",
  ON_HOLD: "On hold",
  AWAITING_ACCEPTANCE: "Awaiting merge",
  COMPLETED: "Merged",
  INTERRUPTED: "Interrupted",
  FAILED: "Failed",
  ABORTED: "Aborted",
};

export function statusBadgeClass(s: WorkOrderStatus): string {
  switch (s) {
    case "IN_PROGRESS":
    case "SCAFFOLDING":
    case "GATING":
      return "bg-[#58a6ff]/15 text-[#58a6ff] border-[#58a6ff]/40";
    case "ON_HOLD":
    case "INTERRUPTED":
      return "bg-[#d29922]/15 text-[#d29922] border-[#d29922]/40";
    case "AWAITING_ACCEPTANCE":
      return "bg-[#bc8cff]/15 text-[#bc8cff] border-[#bc8cff]/40";
    case "COMPLETED":
      return "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/40";
    case "FAILED":
    case "ABORTED":
      return "bg-[#f85149]/15 text-[#ff7b72] border-[#f85149]/40";
    default:
      return "bg-[#8b949e]/15 text-[#c9d1d9] border-[#8b949e]/40";
  }
}

export function stageBarClass(s: StageStatus): string {
  switch (s) {
    case "PASSED":
      return "bg-[#3fb950]";
    case "RUNNING":
      return "bg-[#58a6ff] animate-pulse";
    case "ON_HOLD":
      return "bg-[#d29922]";
    case "FAILED":
      return "bg-[#f85149]";
    default:
      return "bg-[#30363d]";
  }
}

export function stageTextClass(s: StageStatus): string {
  switch (s) {
    case "PASSED":
      return "text-[#3fb950]";
    case "RUNNING":
      return "text-[#58a6ff]";
    case "ON_HOLD":
      return "text-[#d29922]";
    case "FAILED":
      return "text-[#ff7b72]";
    default:
      return "text-[#8b949e]";
  }
}

export function outcomeClass(o: CheckOutcome | GateVerdict): string {
  switch (o) {
    case "PASS":
      return "text-[#3fb950]";
    case "FAIL":
      return "text-[#ff7b72]";
    case "TIMEOUT":
    case "ERROR":
    case "INCONCLUSIVE":
      return "text-[#d29922]";
    default:
      return "text-[#8b949e]";
  }
}

export const STAGE_META: Record<StageId, { title: string; summary: string }> = {
  admission: {
    title: "Admission",
    summary: "Out-of-scope and protected-path checks, dependencies",
  },
  scaffold: {
    title: "Worktree & vault",
    summary: "git worktree, holdbacks vaulted, setup commands",
  },
  implementation: {
    title: "Author agent",
    summary: "The agent works inside the worktree",
  },
  gate: {
    title: "Gate",
    summary: "Commit, changed paths, audit, Tier 1, Tier 2",
  },
  correction: {
    title: "Corrections",
    summary: "Failed gates go back to the author",
  },
  acceptance: {
    title: "Human merge",
    summary: "Squash-merge into the base branch",
  },
};

/** Splits a comma- or newline-separated field into trimmed, non-empty entries. */
export function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
