import React from "react";
import { AlertTriangle } from "lucide-react";
import { RunKind } from "../terminal/types";
import { AgentIcon } from "../terminal/AgentIcons";

export interface SkipBannerProps {
  runKind?: RunKind | string;
  agentName?: string;
}

export const SkipBanner: React.FC<SkipBannerProps> = ({ runKind, agentName }) => {
  const getBannerDetails = () => {
    switch (runKind) {
      case "antigravity":
        return {
          title: "Antigravity CLI",
          description: "Antigravity runs every tool and command without asking for confirmation.",
        };
      case "codex":
        return {
          title: "Codex CLI",
          description: "Codex runs with approval prompts and sandbox constraints bypassed.",
        };
      case "pi":
        return {
          title: "Pi Coding Agent",
          description: "Pi runs in automatic approval mode without asking for confirmation.",
        };
      case "gemini":
        return {
          title: "Gemini CLI",
          description: "Gemini runs commands without asking for confirmation.",
        };
      case "grok":
        return {
          title: "Grok CLI",
          description: "Grok runs commands and code without asking for confirmation.",
        };
      case "aider":
        return {
          title: "Aider Pair Programmer",
          description: "Aider runs in --yes-always auto-accept mode without asking.",
        };
      case "kiro":
        return {
          title: "Kiro CLI",
          description: "Kiro trusts all tools and executes commands without asking.",
        };
      case "copilot":
        return {
          title: "GitHub Copilot",
          description: "Copilot executes tools and shell commands without asking.",
        };
      case "opencode":
        return {
          title: "OpenCode CLI",
          description: "OpenCode auto-approves all tool permissions without asking.",
        };
      case "pig":
        return {
          title: "PiG (Pi in Go)",
          description: "PiG never asks before a tool call, so it runs shell tools and edits on its own.",
        };
      case "claude":
      default:
        return {
          title: agentName || "Claude Code",
          description: "Claude runs every tool and bash command without asking.",
        };
    }
  };

  const { title, description } = getBannerDetails();

  return (
    <div className="h-8 bg-[#ff7b72]/15 border-b border-[#ff7b72]/40 px-4 flex items-center justify-between text-xs text-[#ff7b72] font-medium shrink-0 select-none">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 text-[#ff7b72]" />
        {runKind && <AgentIcon kind={runKind as RunKind} className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">
          <strong className="font-semibold uppercase tracking-wide">Dangerously Skipping Permissions:</strong>{" "}
          <span className="text-[#f85149] font-bold">[{title}]</span> {description}
        </span>
      </div>
      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#ff7b72]/20 border border-[#ff7b72]/40 text-[#ff7b72] shrink-0 ml-2">
        BYPASS ACTIVE
      </span>
    </div>
  );
};
