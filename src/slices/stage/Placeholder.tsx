import { Terminal, Plus } from "lucide-react";

interface PlaceholderProps {
  onNewTerminal: () => void;
}

export const Placeholder: React.FC<PlaceholderProps> = ({ onNewTerminal }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0d1117] text-[#8b949e] select-none">
      <div className="w-16 h-16 rounded-full bg-[#161b22] border border-[#30363d] flex items-center justify-center mb-4 text-[#58a6ff]">
        <Terminal className="w-8 h-8" />
      </div>
      <h3 className="text-base font-semibold text-white mb-2">
        No Terminal in this Project
      </h3>
      <p className="text-xs text-[#8b949e] max-w-sm text-center mb-6 font-mono">
        Press <kbd className="px-1.5 py-0.5 bg-[#21262d] border border-[#30363d] rounded text-white text-[11px]">Ctrl+Shift+B N</kbd> or click below to launch an AI Agent, PowerShell, or a custom Command.
      </p>
      <button
        onClick={onNewTerminal}
        className="flex items-center gap-2 px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-sm font-medium shadow-sm transition-colors"
      >
        <Plus className="w-4 h-4" />
        <span>Launch Terminal</span>
      </button>
    </div>
  );
};
