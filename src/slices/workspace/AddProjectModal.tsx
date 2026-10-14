import { useState, useEffect } from "react";
import { FolderGit2, FolderOpen, X, CheckCircle, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProject: (path: string) => Promise<void>;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onAddProject,
}) => {
  const [folderPath, setFolderPath] = useState("");
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen) {
      setFolderPath("");
      setIsValid(null);
      setErrorMsg("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, folderPath, isSubmitting]);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    try {
      setIsBrowsing(true);
      setErrorMsg("");
      const selected = await invoke<string | null>("pick_folder");
      if (selected) {
        setFolderPath(selected);
        setIsValid(true);
      }
    } catch (err) {
      console.error("Browse failed:", err);
      setErrorMsg("Failed to open folder picker.");
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleValidate = async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      setIsValid(null);
      return;
    }
    try {
      const valid = await invoke<boolean>("validate_path", { path: trimmed });
      setIsValid(valid);
      if (!valid) {
        setErrorMsg("Directory does not exist.");
      } else {
        setErrorMsg("");
      }
    } catch {
      setIsValid(null);
    }
  };

  const handleConfirm = async () => {
    const trimmed = folderPath.trim();
    if (!trimmed) {
      setErrorMsg("Please provide a valid folder path.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg("");
      await onAddProject(trimmed);
      onClose();
    } catch (err: any) {
      console.error("Failed to add project:", err);
      setErrorMsg(typeof err === "string" ? err : "Failed to add project");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="w-[500px] bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl p-6 text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#30363d]">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-[#58a6ff]" />
            <h2 className="text-lg font-semibold text-white">Add Project Workspace</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#8b949e] hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="py-5 space-y-4">
          <p className="text-xs text-[#8b949e] leading-relaxed">
            Select or enter a local folder path. Quay will host interactive Claude Code sessions and PowerShell terminals scoped to this project directory.
          </p>

          <div>
            <label className="block text-xs font-medium text-[#8b949e] mb-1.5 uppercase tracking-wide">
              Folder Path
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  autoFocus
                  value={folderPath}
                  onChange={(e) => {
                    setFolderPath(e.target.value);
                    handleValidate(e.target.value);
                  }}
                  onBlur={() => handleValidate(folderPath)}
                  placeholder="E:\Projects\my-repo"
                  className={`w-full px-3 py-2 bg-[#0d1117] border rounded text-sm text-white placeholder-[#484f58] focus:outline-none focus:ring-1 font-mono transition-colors ${
                    isValid === true
                      ? "border-[#238636] focus:border-[#238636] focus:ring-[#238636]"
                      : isValid === false
                      ? "border-[#da3633] focus:border-[#da3633] focus:ring-[#da3633]"
                      : "border-[#30363d] focus:border-[#58a6ff] focus:ring-[#58a6ff]"
                  }`}
                />
                {isValid === true && (
                  <CheckCircle className="w-4 h-4 text-[#3fb950] absolute right-3 top-2.5" />
                )}
                {isValid === false && (
                  <AlertCircle className="w-4 h-4 text-[#ff7b72] absolute right-3 top-2.5" />
                )}
              </div>

              <button
                type="button"
                onClick={handleBrowse}
                disabled={isBrowsing}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#21262d] hover:bg-[#30363d] text-white rounded text-xs font-medium border border-[#30363d] transition-colors shrink-0"
                title="Browse folder via Windows Dialog"
              >
                <FolderOpen className="w-4 h-4 text-[#58a6ff]" />
                <span>{isBrowsing ? "Browsing..." : "Browse..."}</span>
              </button>
            </div>

            {errorMsg && (
              <p className="text-xs text-[#ff7b72] mt-1.5 flex items-center gap-1 font-mono">
                <AlertCircle className="w-3.5 h-3.5" />
                {errorMsg}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#30363d]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[#8b949e] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !folderPath.trim()}
            className="px-4 py-1.5 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 disabled:pointer-events-none text-white rounded text-xs font-medium shadow-sm transition-colors"
          >
            {isSubmitting ? "Adding..." : "Add Project"}
          </button>
        </div>
      </div>
    </div>
  );
};
