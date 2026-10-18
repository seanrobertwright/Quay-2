import { useState, useEffect, useRef, FC } from "react";
import { ClaudeTokenStats, DailySpend, UsageWindowKey } from "../sessions/types";
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

  const [windowKey, setWindowKey] = useState<UsageWindowKey>("today");

  // Rescan transcripts each time the modal opens; the scanner only re-reads changed files
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  useEffect(() => {
    if (isOpen) onRefreshRef.current?.();
  }, [isOpen]);

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

  const selected = stats?.windows?.find((w) => w.key === windowKey) ?? null;
  const windowCost = selected?.cost_usd ?? 0;

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
                API-equivalent spend from Claude Code transcripts & turn completion alerts
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
          {/* Time window selector */}
          <div
            role="radiogroup"
            aria-label="Time window"
            className="flex items-center bg-[#0d1117] border border-[#30363d] rounded-md p-0.5 w-fit text-xs"
          >
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={windowKey === opt.key}
                onClick={() => setWindowKey(opt.key)}
                className={`px-3 py-1 rounded font-medium transition-colors ${
                  windowKey === opt.key
                    ? "bg-[#21262d] text-white"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Stat tiles for the selected window */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                Estimated Spend
              </span>
              <span className="text-xl font-bold font-mono text-white">
                ${windowCost.toFixed(2)}
              </span>
              <span className="text-[10px] text-[#8b949e]">
                {selected?.label ?? "—"} · API list prices
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                Output Tokens
              </span>
              <span className="text-xl font-bold font-mono text-white">
                {formatNumber(selected?.output_tokens || 0)}
              </span>
              <span className="text-[10px] text-[#8b949e]">
                In: {formatNumber(selected?.input_tokens || 0)} · Cache writes:{" "}
                {formatNumber(selected?.cache_write_tokens || 0)}
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
                Prompt Cache Reads
              </span>
              <span className="text-xl font-bold font-mono text-white">
                {formatNumber(selected?.cache_read_tokens || 0)}
              </span>
              <span className="text-[10px] text-[#8b949e] flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-[#3fb950]" />
                <span>
                  {windowKey === "all" && stats?.legacy_through
                    ? "Saved (transcripts only): "
                    : "Saved: "}
                  ${(selected?.cache_savings_usd ?? 0).toFixed(2)} vs full input price
                </span>
              </span>
            </div>
          </div>

          {/* Daily spend, last 30 UTC days */}
          {stats?.daily && stats.daily.length > 0 && <DailySpendStrip days={stats.daily} />}

          {/* Model Breakdown */}
          <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-[#58a6ff]" />
                <span>Model Usage · {selected?.label ?? ""}</span>
              </div>
              <span className="text-[11px] text-[#8b949e] font-normal">
                {formatNumber(selected?.messages || 0)} API responses
              </span>
            </div>

            <div className="space-y-2 pt-1">
              {(selected?.model_breakdown || []).length === 0 && (
                <p className="text-[11px] text-[#8b949e]">No Claude usage in this window.</p>
              )}
              {(selected?.model_breakdown || []).map((m) => {
                const percent =
                  windowCost > 0 ? Math.round((m.estimated_cost_usd / windowCost) * 100) : 0;

                return (
                  <div key={m.model_name} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-white truncate max-w-[260px]" title={m.model_name}>
                        {m.model_name}
                      </span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-[#8b949e]">{formatNumber(m.output_tokens)} out</span>
                        {m.messages > 0 && (
                          <span className="text-[#8b949e]">{formatNumber(m.messages)} resp</span>
                        )}
                        <span className="font-semibold text-white">
                          ${m.estimated_cost_usd.toFixed(2)}
                        </span>
                        <span className="text-[#8b949e] w-8 text-right">{percent}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-[#21262d] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#388bfd] rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(2, percent)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-[#8b949e] pt-2 border-t border-[#30363d]/40 leading-relaxed">
              Estimated from {stats?.transcript_files ?? 0} Claude Code transcript files at Anthropic
              list prices (cache writes and fast mode included); subscription plans are not billed
              this way.
              {stats?.tracked_since && <> Daily totals tracked since {stats.tracked_since}.</>}
              {windowKey === "all" && stats?.legacy_through && (
                <> All time adds Claude Code&apos;s stats cache through {stats.legacy_through}.</>
              )}
              {" "}Days are UTC.
            </p>
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

const WINDOW_OPTIONS: { key: UsageWindowKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-18" -> "Oct 18", read straight from the digits (no Date parsing, no local-zone shift). */
const shortDay = (isoDay: string) => {
  const month = Number(isoDay.slice(5, 7));
  const day = Number(isoDay.slice(8, 10));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${day}` : isoDay;
};

/** One column per UTC day, single series, with a hover readout and a screen-reader table. */
const DailySpendStrip: FC<{ days: DailySpend[] }> = ({ days }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.cost_usd), 0);
  const active = hovered !== null ? days[hovered] : days[days.length - 1];
  const CHART_HEIGHT = 56;

  return (
    <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white">Daily spend · last 30 days</span>
        <span className="font-mono text-[11px] text-[#c9d1d9]">
          {shortDay(active.date)}: <span className="text-white font-semibold">${active.cost_usd.toFixed(2)}</span>
          <span className="text-[#8b949e]"> · {active.output_tokens.toLocaleString()} out</span>
        </span>
      </div>

      <div
        className="flex items-end gap-[2px] border-b border-[#30363d]"
        style={{ height: CHART_HEIGHT }}
        aria-hidden="true"
        onMouseLeave={() => setHovered(null)}
      >
        {days.map((d, i) => {
          const h = max > 0 ? Math.max(d.cost_usd > 0 ? 2 : 0, (d.cost_usd / max) * CHART_HEIGHT) : 0;
          return (
            <div
              key={d.date}
              className="flex-1 h-full flex items-end justify-center cursor-default"
              onMouseEnter={() => setHovered(i)}
            >
              <div
                className={`w-full max-w-[24px] rounded-t-[4px] transition-opacity ${
                  hovered === null || hovered === i ? "opacity-100" : "opacity-40"
                } bg-[#388bfd]`}
                style={{ height: h }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-[#8b949e]" aria-hidden="true">
        <span>{shortDay(days[0].date)}</span>
        <span>max ${max.toFixed(2)}</span>
        <span>{shortDay(days[days.length - 1].date)}</span>
      </div>

      <table className="sr-only">
        <caption>Daily Claude spend, last 30 UTC days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Spend (USD)</th>
            <th scope="col">Output tokens</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.cost_usd.toFixed(2)}</td>
              <td>{d.output_tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
