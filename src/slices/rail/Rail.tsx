import { MouseEvent } from "react";
import { TerminalInfo } from "../terminal/types";
import { TerminalRow } from "./TerminalRow";
import {
  FolderGit2,
  Plus,
  Radio,
  Network,
  Activity,
  Layers,
} from "lucide-react";

interface Project {
  path: string;
  name: string;
  terminal_ids: string[];
}

interface RailProps {
  projects: Project[];
  activeProject: string;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  bridgePort: number;
  onSelectTerminal: (id: string) => void;
  onCloseTerminal: (id: string) => void;
  onNewTerminal: () => void;
  onSelectProject: (path: string) => void;
  onOpenA2APanel: () => void;
}

export const Rail: React.FC<RailProps> = ({
  projects,
  activeProject,
  terminals,
  activeTerminalId,
  bridgePort,
  onSelectTerminal,
  onCloseTerminal,
  onNewTerminal,
  onSelectProject,
  onOpenA2APanel,
}) => {
  return (
    <aside className="w-72 bg-[#0d1117] border-r border-[#30363d] flex flex-col h-full select-none text-[#c9d1d9]">
      {/* App Branding & Quay Logo */}
      <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-[#58a6ff]" />
          <span className="font-bold tracking-wide text-white text-sm">
            QUAY <span className="text-[10px] text-[#58a6ff] font-mono font-normal">Tauri</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#21262d] text-[11px] text-[#8b949e] font-mono">
          <Radio className="w-3 h-3 text-[#3fb950] animate-pulse" />
          <span>:{bridgePort || "..."}</span>
        </div>
      </div>

      {/* Projects Section */}
      <div className="p-3 border-b border-[#30363d] bg-[#161b22]/50">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
          <span>Projects</span>
        </div>

        <div className="space-y-1 max-h-36 overflow-y-auto">
          {projects.map((proj) => {
            const isActive = proj.path === activeProject;
            return (
              <button
                key={proj.path}
                onClick={() => onSelectProject(proj.path)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-left transition-colors ${
                  isActive
                    ? "bg-[#21262d] text-white font-medium"
                    : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9]"
                }`}
              >
                <span className="text-sm font-mono text-[#58a6ff]">
                  {isActive ? "▸" : " "}
                </span>
                <FolderGit2 className="w-3.5 h-3.5 shrink-0 text-[#8b949e]" />
                <span className="truncate" title={proj.path}>
                  {proj.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminals Section */}
      <div className="flex-1 flex flex-col min-h-0 p-3">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
          <span>Terminals ({terminals.length})</span>
          <button
            onClick={onNewTerminal}
            className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[#21262d] text-[#58a6ff] hover:text-white rounded text-xs transition-colors"
            title="New Terminal (^b n)"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {terminals.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#8b949e]">
              No terminals open in this project.
            </div>
          ) : (
            terminals.map((term, i) => (
              <TerminalRow
                key={term.id}
                index={i + 1}
                terminal={term}
                isActive={term.id === activeTerminalId}
                onSelect={() => onSelectTerminal(term.id)}
                onClose={(e: MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  onCloseTerminal(term.id);
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* Bottom Mission Control / A2A Router Bar */}
      <div className="p-3 border-t border-[#30363d] bg-[#161b22] flex flex-col gap-2">
        <button
          onClick={onOpenA2APanel}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#21262d] hover:bg-[#30363d] text-white rounded-md text-xs font-medium transition-colors border border-[#30363d]"
        >
          <Network className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span>A2A Orchestration Bus</span>
        </button>

        <div className="flex items-center justify-between text-[10px] text-[#8b949e] px-1 font-mono">
          <span>Shortcuts: ^b n / ^b 1..9</span>
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-[#3fb950]" />
            <span>ConPTY</span>
          </span>
        </div>
      </div>
    </aside>
  );
};
