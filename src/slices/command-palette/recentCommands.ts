// The palette's most recent commands, newest first, which the pie's Palette slices copy (#649).
// Kept in the WebView's localStorage, and validated as they are read.
import type { PrefsStorage } from "../companion/companionPrefs.ts";
import type { RecentPaletteCommand } from "../pie/pieRing.ts";

const KEY = "quay_recent_palette_commands";

/** How many recent commands are kept: one per Palette slice. */
export const MAX_RECENT_COMMANDS = 3;

export interface RecentCommands {
  /** The commands the palette ran, newest first. */
  read(): RecentPaletteCommand[];
  /** Records that the palette ran `command`, and returns the recent commands with it first. */
  ran(command: RecentPaletteCommand): RecentPaletteCommand[];
}

const isCommand = (v: unknown): v is RecentPaletteCommand =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Record<string, unknown>).id === "string" &&
  (v as Record<string, unknown>).id !== "" &&
  typeof (v as Record<string, unknown>).title === "string";

function parse(raw: string | null): RecentPaletteCommand[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter(isCommand)
    .map(({ id, title }) => ({ id, title }))
    .slice(0, MAX_RECENT_COMMANDS);
}

/** The palette's recent commands in `storage`. */
export function recentCommands(storage: PrefsStorage): RecentCommands {
  return {
    read: () => parse(storage.getItem(KEY)),
    ran(command) {
      const recent = [{ id: command.id, title: command.title }, ...parse(storage.getItem(KEY)).filter((c) => c.id !== command.id)].slice(
        0,
        MAX_RECENT_COMMANDS
      );
      storage.setItem(KEY, JSON.stringify(recent));
      return recent;
    },
  };
}
