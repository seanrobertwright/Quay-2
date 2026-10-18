/**
 * Display formatting for timestamps. Callers pass epoch milliseconds (the Rust side parses
 * every timestamp string, treating zone-less ones as UTC), so nothing here parses strings.
 */

/** Local wall-clock time on a 24-hour clock, e.g. "14:06:11". */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** Local date and time, e.g. "10/18/2026, 2:06:11 PM". */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Elapsed time as "850ms", "12s", "4m 03s", "1h 39m" or "2d 3h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${String(sec).padStart(2, "0")}s`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ${String(min % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** "just now", "12s ago", "5m ago", "3h ago", "2d ago"; future times read as "just now". */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (!Number.isFinite(diff) || diff < 5_000) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
