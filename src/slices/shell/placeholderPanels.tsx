import { Coins, FileDiff, GitGraph, History, Network, Settings, ShieldCheck, Zap } from "lucide-react";
import { GithubIcon } from "../github/GithubIcon.tsx";
import { ArchonIcon } from "../archon/ArchonIcon.tsx";
import { PraxisIcon } from "../praxis-builder/PraxisIcon.tsx";
import { VsCodeIcon } from "../workspace/VsCodeIcon.tsx";
import type { ModuleId } from "./modules.ts";
import type { PanelLauncher } from "./ModulePanel.tsx";

/** The tools the placeholder panels open, each as it opens today. */
export interface PlaceholderHandlers {
  openGithub: () => void;
  openTopos: () => void;
  openDiffs: () => void;
  openPrePrAudit: () => void;
  openMissionControl: () => void;
  openSessionHistory: () => void;
  openSwarm: () => void;
  openArchon: () => void;
  openFactory: () => void;
  openPraxisBuilder: () => void;
  openWorkspaceSettings: () => void;
  openInVsCode: () => void;
  openTokenSpend: () => void;
  /** Whether a project is open, which Workspace Settings and Open in VS Code act on. */
  hasProject: boolean;
}

/**
 * What each module other than Projects lists until its own panel lands: the tools the rail's
 * toolbar and the stage header opened, grouped by the module the shell redesign spec gives them.
 */
export function placeholderLaunchers(h: PlaceholderHandlers): Record<Exclude<ModuleId, "projects">, PanelLauncher[]> {
  return {
    "source-control": [
      { id: "github", label: "GitHub Issues & PRs", shortcut: "Ctrl+Shift+B i", icon: <GithubIcon className="w-4 h-4 text-white" />, onClick: h.openGithub },
      { id: "topos", label: "Topos", shortcut: "Ctrl+Shift+B c", icon: <GitGraph className="w-4 h-4 text-[#58a6ff]" />, onClick: h.openTopos },
      { id: "diffs", label: "Diffs", shortcut: "Ctrl+Shift+B d", icon: <FileDiff className="w-4 h-4 text-[#3fb950]" />, onClick: h.openDiffs },
      { id: "audit", label: "Pre-PR Audit Gate", shortcut: "Ctrl+Shift+B a", icon: <ShieldCheck className="w-4 h-4 text-[#f85149]" />, onClick: h.openPrePrAudit },
    ],
    agents: [
      { id: "a2a", label: "Mission Control", shortcut: "Ctrl+Shift+B m", icon: <Network className="w-4 h-4 text-[#c9d1d9]" />, onClick: h.openMissionControl },
      { id: "sessions", label: "Session History", shortcut: "Ctrl+Shift+B h", icon: <History className="w-4 h-4 text-[#58a6ff]" />, onClick: h.openSessionHistory },
      { id: "swarm", label: "Swarm", shortcut: "Ctrl+Shift+B s", icon: <Zap className="w-4 h-4 text-[#d29922] fill-current" />, onClick: h.openSwarm },
    ],
    workflows: [
      { id: "archon", label: "Archon & SDD Graph", shortcut: "Ctrl+Shift+B r", icon: <ArchonIcon className="w-4 h-4" />, onClick: h.openArchon },
      { id: "machina", label: "Machina", shortcut: "Ctrl+Shift+B f", icon: <PraxisIcon className="w-4 h-4" />, onClick: h.openFactory },
      { id: "praxis", label: "Praxis Builder", shortcut: "Ctrl+Shift+B p", icon: <PraxisIcon className="w-4 h-4" />, onClick: h.openPraxisBuilder },
    ],
    project: [
      { id: "settings", label: "Workspace Settings", icon: <Settings className="w-4 h-4 text-[#8b949e]" />, onClick: h.openWorkspaceSettings, disabled: !h.hasProject },
      { id: "vscode", label: "Open in VS Code", icon: <VsCodeIcon className="w-4 h-4" />, onClick: h.openInVsCode, disabled: !h.hasProject },
      { id: "spend", label: "Token Spend & Chimes", shortcut: "Ctrl+Shift+B t", icon: <Coins className="w-4 h-4 text-[#e3b341]" />, onClick: h.openTokenSpend },
    ],
  };
}
