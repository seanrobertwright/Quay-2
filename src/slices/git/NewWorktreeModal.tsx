import React, { useState, useEffect } from "react";
import { GitBranch, X, FolderGit2, Sparkles, Plus, AlertCircle } from "lucide-react";

interface NewWorktreeModalProps {
  isOpen: boolean;
  repoPath: string;
  projectName: string;
  initialBranch?: string;
  suggestedIssueNumber?: number;
  onClose: () => void;
  onCreate: (
    branch: string,
    newBranch: boolean,
    baseBranch: string,
    launchClaude: boolean
  ) => Promise<void>;
}

export const NewWorktreeModal: React.FC<NewWorktreeModalProps> = ({
  isOpen,
  repoPath,
  projectName,
  initialBranch = "",
  suggestedIssueNumber,
  onClose,
  onCreate,
}) => {
  const [branch, setBranch] = useState(initialBranch);
  const [newBranch, setNewBranch] = useState(true);
  const [baseBranch, setBaseBranch] = useState("main");
  const [launchClaude, setLaunchClaude] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (suggestedIssueNumber) {
        setBranch(`feat/issue-${suggestedIssueNumber}`);
      } else if (initialBranch) {
        setBranch(initialBranch);
      } else {
        setBranch("");
      }
      setNewBranch(true);
      setBaseBranch("main");
      setLaunchClaude(true);
      setError(null);
    }
  }, [isOpen, initialBranch, suggestedIssueNumber]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch.trim()) {
      setError("Please specify a branch name");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      await onCreate(branch.trim(), newBranch, baseBranch.trim(), launchClaude);
      onClose();
    } catch (err: any) {
      setError(err?.toString() || "Failed to create worktree");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>New Git Worktree</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono">
                  {projectName}
                </span>
              </h2>
              <p className="text-xs text-[#8b949e] mt-0.5">
                Isolated working tree for parallel issue development
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-[#f85149]/10 border border-[#f85149]/30 text-[#ff7b72] rounded-md flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Branch Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#c9d1d9] flex items-center justify-between">
              <span>Branch Name</span>
              <span className="text-[11px] text-[#8b949e] font-normal">
                Folder: <code className="text-[#58a6ff]">.worktrees/{branch ? branch.replace(/[\/\\]/g, "-") : "..."}</code>
              </span>
            </label>
            <div className="relative">
              <GitBranch className="w-4 h-4 text-[#8b949e] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="e.g. feat/issue-86 or fix/buffer-leak"
                className="w-full pl-9 pr-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md text-xs font-mono text-white placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff]"
                autoFocus
              />
            </div>

            {/* Quick Suggestions */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-[#8b949e]">Prefixes:</span>
              {["feat/issue-", "fix/issue-", "wayfinder/issue-"].map((pre) => (
                <button
                  key={pre}
                  type="button"
                  onClick={() => setBranch(pre)}
                  className="px-2 py-0.5 rounded text-[10px] bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#58a6ff] font-mono border border-[#30363d]"
                >
                  +{pre}
                </button>
              ))}
            </div>
          </div>

          {/* New Branch vs Existing */}
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newBranch}
                onChange={(e) => setNewBranch(e.target.checked)}
                className="rounded border-[#30363d] text-[#58a6ff] focus:ring-0"
              />
              <span className="text-[#c9d1d9]">Create as new branch</span>
            </label>

            {newBranch && (
              <div className="flex items-center gap-2">
                <span className="text-[#8b949e]">from</span>
                <input
                  type="text"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder="main"
                  className="w-24 px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs font-mono text-white placeholder-[#8b949e]"
                />
              </div>
            )}
          </div>

          {/* Launch Claude Option */}
          <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-md">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={launchClaude}
                onChange={(e) => setLaunchClaude(e.target.checked)}
                className="rounded border-[#30363d] text-[#58a6ff] focus:ring-0"
              />
              <div>
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#58a6ff]" />
                  <span>Launch Claude Code terminal immediately</span>
                </span>
                <p className="text-[11px] text-[#8b949e] mt-0.5">
                  Opens a new terminal pane inside the worktree with workspace environment variables
                </p>
              </div>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-[#30363d] flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-[#8b949e] font-mono truncate max-w-xs">
              <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate" title={repoPath}>
                {repoPath}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d] rounded-md transition-colors"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isCreating}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white rounded-md shadow-sm transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isCreating ? "Creating Worktree..." : "Create Worktree"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
