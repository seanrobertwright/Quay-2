import { useState, useEffect, FC } from "react";
import { ClaudeTokenStats } from "../sessions/types";
import {
  playTurnCompletedChime,
  playAttentionChime,
  isChimeEnabled,
  setChimeEnabled,
  getChimeVolume,
  setChimeVolume,
} from "./audioChime";
import {
  X,
  Coins,
  Cpu,
  Volume2,
  VolumeX,
  RotateCw,
  Bell,
  TrendingUp,
} from "lucide-react";

interface TokenSpendModalProps {
  isOpen: boolean;
  stats: ClaudeTokenStats | null;
  isLoading?: boolean;
  onRefresh?: () => void;
  onClose: () => void;
}

export const TokenSpendModal: FC<TokenSpendModalProps> = ({
  isOpen,
  stats,
  isLoading = false,
  onRefresh,
  onClose,
}) => {
  const [chimeEnabled, setChimeState] = useState(isChimeEnabled());
  const [volume, setVolState] = useState(getChimeVolume());

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

  const handleToggleChime = () => {
    const next = !chimeEnabled;
    setChimeEnabled(next);
    setChimeState(next);
    if (next) {
      playTurnCompletedChime();
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setChimeVolume(newVol);
    setVolState(newVol);
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const totalCost = stats?.total_cost_usd || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-[#d29922]/15 text-[#d29922] border border-[#d29922]/30">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Token Spend & Audio Chime Meter</span>
              </h2>
              <p className="text-xs text-[#8b949e] mt-0.5">
                Anthropic API cost estimation & background turn completion alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isLoading}
                className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors disabled:opacity-50"
                title="Refresh stats"
              >
                <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#58a6ff]" : ""}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Top Stat Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                Estimated Total Spend
              </span>
              <span className="text-xl font-bold font-mono text-[#3fb950]">
                ${totalCost.toFixed(2)}
              </span>
              <span className="text-[10px] text-[#8b949e]">Based on official rates</span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                Total Output Tokens
              </span>
              <span className="text-xl font-bold font-mono text-[#58a6ff]">
                {formatNumber(stats?.total_output_tokens || 0)}
              </span>
              <span className="text-[10px] text-[#8b949e]">
                In: {formatNumber(stats?.total_input_tokens || 0)}
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                Prompt Cache Reads
              </span>
              <span className="text-xl font-bold font-mono text-[#bc8cff]">
                {formatNumber(stats?.total_cache_read_tokens || 0)}
              </span>
              <span className="text-[10px] text-[#3fb950] font-medium flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                <span>90% cost savings</span>
              </span>
            </div>
          </div>

          {/* Model Breakdown */}
          <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-[#58a6ff]" />
                <span>Model Usage Breakdown</span>
              </div>
              <span className="text-[11px] text-[#8b949e] font-normal">
                {stats?.total_sessions || 0} sessions • {stats?.total_messages || 0} msgs
              </span>
            </div>

            <div className="space-y-2 pt-1">
              {(stats?.model_breakdown || []).map((m) => {
                const percent =
                  totalCost > 0
                    ? Math.round((m.estimated_cost_usd / totalCost) * 100)
                    : 0;

                return (
                  <div key={m.model_name} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-white truncate max-w-[280px]">
                        {m.model_name}
                      </span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-[#8b949e]">
                          {formatNumber(m.output_tokens)} out
                        </span>
                        <span className="font-semibold text-[#3fb950]">
                          ${m.estimated_cost_usd.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    {/* Bar */}
                    <div className="h-1.5 w-full bg-[#21262d] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#58a6ff] rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(3, percent)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Background Turn Audio Chime Settings */}
          <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#d29922]" />
                <div>
                  <h4 className="text-xs font-semibold text-white">Background Turn Chimes</h4>
                  <p className="text-[11px] text-[#8b949e]">
                    Plays a gentle chord when Claude completes a turn or asks for input
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleChime}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                  chimeEnabled
                    ? "bg-[#3fb950]/15 text-[#3fb950] border-[#3fb950]/40 hover:bg-[#3fb950]/25"
                    : "bg-[#21262d] text-[#8b949e] border-[#30363d] hover:text-white"
                }`}
              >
                {chimeEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{chimeEnabled ? "Chimes Active" : "Muted"}</span>
              </button>
            </div>

            {chimeEnabled && (
              <div className="flex items-center justify-between pt-2 border-t border-[#30363d]/40 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#8b949e]">Volume:</span>
                  <input
                    type="range"
                    min="0.05"
                    max="1.0"
                    step="0.05"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-28 accent-[#58a6ff] cursor-pointer"
                  />
                  <span className="font-mono text-[10px] text-[#c9d1d9]">
                    {Math.round(volume * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => playTurnCompletedChime()}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] hover:text-white text-[11px] font-medium border border-[#30363d] transition-colors"
                  >
                    Test Completion Chime
                  </button>
                  <button
                    type="button"
                    onClick={() => playAttentionChime()}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#d29922] hover:text-white text-[11px] font-medium border border-[#30363d] transition-colors"
                  >
                    Test Attention Ping
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#30363d] bg-[#0d1117] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white text-xs font-medium border border-[#30363d] transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
