import { Coins, Settings } from "lucide-react";
import { VsCodeIcon } from "../workspace/VsCodeIcon.tsx";
import type { ModuleId } from "./modules.ts";
import type { PanelLauncher } from "./ModulePanel.tsx";

/** The tools the placeholder panels open, each as it opens today. */
export interface PlaceholderHandlers {
  openWorkspaceSettings: () => void;
  openInVsCode: () => void;
  openTokenSpend: () => void;
  /** Whether a project is open, which Workspace Settings and Open in VS Code act on. */
  hasProject: boolean;
}

/** The modules whose panels are still placeholders. */
export type PlaceholderModule = Exclude<ModuleId, "projects" | "source-control" | "agents" | "workflows">;

/**
 * What each placeholder module lists until its own panel lands: the tools the rail's toolbar and
 * the stage header opened, grouped by the module the shell redesign spec gives them.
 */
export function placeholderLaunchers(h: PlaceholderHandlers): Record<PlaceholderModule, PanelLauncher[]> {
  return {
    project: [
      { id: "settings", label: "Workspace Settings", icon: <Settings className="w-4 h-4 text-[#8b949e]" />, onClick: h.openWorkspaceSettings, disabled: !h.hasProject },
      { id: "vscode", label: "Open in VS Code", icon: <VsCodeIcon className="w-4 h-4" />, onClick: h.openInVsCode, disabled: !h.hasProject },
      { id: "spend", label: "Token Spend & Chimes", shortcut: "Ctrl+Shift+B t", icon: <Coins className="w-4 h-4 text-[#e3b341]" />, onClick: h.openTokenSpend },
    ],
  };
}
