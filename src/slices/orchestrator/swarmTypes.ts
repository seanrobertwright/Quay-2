import { StageLayout, RunKind } from "../terminal/types";

export interface SwarmAgentConfig {
  role: string;
  name: string;
  run_kind: RunKind;
  custom_flags?: string;
  /** The authored role prompt; the launch prompt carries it after the role line. */
  role_prompt?: string;
}

export interface SwarmPreset {
  id: string;
  title: string;
  description: string;
  layout: StageLayout;
  agents: SwarmAgentConfig[];
  badge?: string;
  tagColor?: string;
}

export const BUILTIN_SWARM_PRESETS: SwarmPreset[] = [
  {
    id: "polyglot-trio",
    title: "Polyglot Agent Trio",
    description: "Multi-agent vanguard: Claude Implementer, Antigravity Deep Planner, and Codex Code Reviewer collaborating with a verification shell.",
    layout: "grid",
    badge: "Claude + Antigravity + Codex",
    tagColor: "#f0883e",
    agents: [
      {
        role: "Primary Implementer",
        name: "claude-dev",
        run_kind: "claude",
      },
      {
        role: "Architecture & Planner",
        name: "agy-planner",
        run_kind: "antigravity",
      },
      {
        role: "Code Reviewer & Quality Gate",
        name: "codex-reviewer",
        run_kind: "codex",
      },
      {
        role: "Test & CI Shell",
        name: "test-runner",
        run_kind: "powershell",
      },
    ],
  },
  {
    id: "fullstack-pair",
    title: "Full-Stack Pair",
    description: "Dual Claude Code agents in side-by-side split dedicated to Backend and Frontend tasks.",
    layout: "split-horizontal",
    badge: "2 Agents",
    tagColor: "#58a6ff",
    agents: [
      {
        role: "Backend Specialist",
        name: "backend-agent",
        run_kind: "claude",
        custom_flags: "--model claude-sonnet-5-5",
      },
      {
        role: "Frontend Specialist",
        name: "frontend-agent",
        run_kind: "claude",
        custom_flags: "--model claude-sonnet-5-5",
      },
    ],
  },
  {
    id: "dev-and-watcher",
    title: "Dev & Watcher",
    description: "Claude Code paired with an active PowerShell terminal running build watchers or tests.",
    layout: "split-horizontal",
    badge: "1 Agent + Shell",
    tagColor: "#3fb950",
    agents: [
      {
        role: "Lead Developer",
        name: "lead-dev",
        run_kind: "claude",
      },
      {
        role: "Build & Test Watcher",
        name: "build-watcher",
        run_kind: "powershell",
      },
    ],
  },
  {
    id: "tdd-swarm",
    title: "TDD Swarm",
    description: "4-way 2x2 grid pairing Test Architect, Implementer, Test Runner, and Code Reviewer.",
    layout: "grid",
    badge: "3 Agents + Runner",
    tagColor: "#d29922",
    agents: [
      {
        role: "Test Architect",
        name: "test-architect",
        run_kind: "claude",
        custom_flags: "--model claude-sonnet-5-5",
      },
      {
        role: "Feature Implementer",
        name: "feature-impl",
        run_kind: "claude",
      },
      {
        role: "Test Runner Shell",
        name: "test-runner",
        run_kind: "powershell",
      },
      {
        role: "Reviewer & Quality Gate",
        name: "reviewer",
        run_kind: "claude",
      },
    ],
  },
  {
    id: "tri-agent-council",
    title: "Tri-Agent Council",
    description: "Three collaborative Claude agents (Planner, Builder, Verifier) sharing the orchestration bus.",
    layout: "grid",
    badge: "3 Claude Agents",
    tagColor: "#bc8cff",
    agents: [
      {
        role: "Council Planner",
        name: "planner-agent",
        run_kind: "claude",
      },
      {
        role: "Council Builder",
        name: "builder-agent",
        run_kind: "claude",
      },
      {
        role: "Council Verifier",
        name: "verifier-agent",
        run_kind: "claude",
      },
      {
        role: "Workspace Shell",
        name: "terminal-shell",
        run_kind: "powershell",
      },
    ],
  },
  {
    id: "frontier-federation",
    title: "Frontier Agent Federation",
    description: "Four distinct agent ecosystems collaborating via A2A: Claude Implementer, Kiro Multi-Model Architect, Copilot Specialist, and OpenCode Verifier.",
    layout: "grid",
    badge: "Claude + Kiro + Copilot + OpenCode",
    tagColor: "#a855f7",
    agents: [
      {
        role: "Primary Implementer",
        name: "claude-dev",
        run_kind: "claude",
      },
      {
        role: "Multi-Model Architect",
        name: "kiro-architect",
        run_kind: "kiro",
      },
      {
        role: "Copilot Specialist",
        name: "copilot-assistant",
        run_kind: "copilot",
      },
      {
        role: "OpenCode Verifier",
        name: "opencode-verifier",
        run_kind: "opencode",
      },
    ],
  },
];
