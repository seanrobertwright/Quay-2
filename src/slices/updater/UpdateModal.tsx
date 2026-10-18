import React, { useState, useEffect } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCw,
  ExternalLink,
  X,
  Sparkles,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { UpdateInfo, UpdatePhase, UpdateProgress } from "./types";
import {
  checkForUpdates,
  applyUpdate,
  APP_CURRENT_VERSION,
} from "./updaterService";

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUpdate?: UpdateInfo | null;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  initialUpdate,
}) => {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(initialUpdate || null);
  const [progress, setProgress] = useState<UpdateProgress>({
    downloaded: 0,
    total: 0,
    percentage: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialUpdate) {
        setUpdateInfo(initialUpdate);
        setPhase(initialUpdate.available ? "available" : "up-to-date");
      } else {
        handleCheck();
      }
    } else {
      setErrorMessage(null);
      setProgress({ downloaded: 0, total: 0, percentage: 0 });
    }
  }, [isOpen, initialUpdate]);

  const handleCheck = async () => {
    setPhase("checking");
    setErrorMessage(null);
    try {
      const res = await checkForUpdates();
      setUpdateInfo(res);
      setPhase(res.available ? "available" : "up-to-date");
    } catch (err: any) {
      console.error("Failed to check for updates:", err);
      setErrorMessage(err?.message || "Failed to check for updates");
      setPhase("error");
    }
  };

  const handleInstall = async () => {
    if (!updateInfo) return;
    setPhase("downloading");
    setErrorMessage(null);

    try {
      await applyUpdate(updateInfo, (prog) => {
        setProgress(prog);
        if (prog.percentage >= 100) {
          setPhase("installing");
        }
      });
      // If it doesn't automatically relaunch (e.g. browser download triggered):
      if (!updateInfo.rawUpdate) {
        setPhase("available");
        onClose();
      }
    } catch (err: any) {
      console.error("Failed to download or apply update:", err);
      setErrorMessage(err?.message || "Failed to apply update");
      setPhase("error");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden flex flex-col text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d] bg-[#0d1117]/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/25">
              <Sparkles className="w-5 h-5 text-[#58a6ff]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Quay Software Update</h2>
              <p className="text-[11px] text-[#8b949e]">
                Current Version: <span className="font-mono text-[#58a6ff]">v{APP_CURRENT_VERSION}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#8b949e] hover:text-white rounded-md hover:bg-[#21262d] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Phase: Checking */}
          {phase === "checking" && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <RotateCw className="w-7 h-7 text-[#58a6ff] animate-spin" />
              <p className="text-xs text-[#8b949e]">Checking GitHub and update endpoints for releases...</p>
            </div>
          )}

          {/* Phase: Up to Date */}
          {phase === "up-to-date" && (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-[#238636]/15 border border-[#238636]/30 flex items-center justify-center text-[#3fb950]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">You're up to date!</h3>
                <p className="text-xs text-[#8b949e]">
                  Quay <span className="font-mono text-[#58a6ff]">v{APP_CURRENT_VERSION}</span> is currently the latest version.
                </p>
              </div>
            </div>
          )}

          {/* Phase: Update Available */}
          {(phase === "available" || phase === "downloading" || phase === "installing") && updateInfo && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#21262d]/60 border border-[#30363d]">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle className="w-5 h-5 text-[#3fb950]" />
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-2">
                      <span>Quay v{updateInfo.latestVersion}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 font-mono">
                        New Version
                      </span>
                    </div>
                    {updateInfo.publishedAt && (
                      <span className="text-[10px] text-[#8b949e]">
                        Released on {new Date(updateInfo.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                {updateInfo.htmlUrl && (
                  <button
                    type="button"
                    onClick={() => openUrl(updateInfo.htmlUrl!)}
                    className="flex items-center gap-1 text-[11px] text-[#58a6ff] hover:text-[#79c0ff] transition-colors"
                  >
                    <span>Notes</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Release Notes */}
              {updateInfo.body && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                    Release Notes
                  </span>
                  <div className="max-h-44 overflow-y-auto p-3 rounded-lg bg-[#0d1117] border border-[#30363d] text-xs font-mono text-[#c9d1d9] whitespace-pre-wrap leading-relaxed">
                    {updateInfo.body}
                  </div>
                </div>
              )}

              {/* Download / Install Progress */}
              {(phase === "downloading" || phase === "installing") && (
                <div className="p-3 rounded-lg bg-[#0d1117] border border-[#58a6ff]/30 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#58a6ff] font-medium flex items-center gap-1.5">
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      {phase === "installing" ? "Applying update..." : "Downloading update package..."}
                    </span>
                    <span className="font-mono text-[#8b949e]">{progress.percentage}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#58a6ff] transition-all duration-300"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase: Error */}
          {phase === "error" && (
            <div className="p-3.5 rounded-lg bg-[#f85149]/10 border border-[#f85149]/30 flex items-start gap-2.5 text-xs text-[#ff7b72]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold text-white">Update Check Failed</span>
                <p className="text-[#c9d1d9]">{errorMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#30363d] bg-[#0d1117]/60">
          <div>
            {phase !== "checking" && phase !== "downloading" && phase !== "installing" && (
              <button
                type="button"
                onClick={handleCheck}
                className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Check Again</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={phase === "downloading" || phase === "installing"}
              className="px-3.5 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-xs font-medium text-[#c9d1d9] transition-colors disabled:opacity-50"
            >
              {phase === "available" ? "Remind Me Later" : "Close"}
            </button>

            {phase === "available" && (
              <button
                type="button"
                onClick={handleInstall}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{updateInfo?.rawUpdate ? "Update & Restart" : "Download Update"}</span>
              </button>
            )}

            {phase === "error" && updateInfo?.htmlUrl && (
              <button
                type="button"
                onClick={() => openUrl(updateInfo.htmlUrl!)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#58a6ff] hover:bg-[#79c0ff] text-white text-xs font-semibold transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Releases</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
