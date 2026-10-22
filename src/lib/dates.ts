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

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A local calendar date, e.g. "2026-10-21". */
export function formatDateStamp(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** A UTC calendar date, e.g. "2026-10-21", the same on every machine. */
export function formatUtcDateStamp(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Whether text is a calendar date written "YYYY-MM-DD", such as "2026-10-21". The digits are read
 * as they are, with no time zone; "2026-02-30" is not a date.
 */
export function isDateStamp(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Whole calendar days from one "YYYY-MM-DD" date to another, negative when `to` comes first. The
 * digits are read as they are, with no time zone. Throws when either is not such a date.
 */
export function daysBetweenDateStamps(from: string, to: string): number {
  const dayNumber = (text: string) => {
    if (!isDateStamp(text)) throw new Error(`${JSON.stringify(text)} is not a date written YYYY-MM-DD`);
    const [year, month, day] = text.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return dayNumber(to) - dayNumber(from);
}

/**
 * The moment a UTC timestamp written "YYYY-MM-DDTHH:MM:SS", with optional fractional seconds and
 * a closing "Z", names, in milliseconds since the epoch, such as Claude Code writes in its
 * transcripts. Null for any other text, including a timestamp with no zone or an impossible date.
 */
export function parseUtcTimestamp(text: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(text);
  if (!match || !isDateStamp(match[1])) return null;
  const [hours, minutes, seconds] = match.slice(2, 5).map(Number);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const ms = Number((match[5] ?? "0").padEnd(3, "0").slice(0, 3));
  return Date.UTC(year, month - 1, day, hours, minutes, seconds, ms);
}
