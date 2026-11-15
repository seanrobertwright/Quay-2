// Fixtures the companion's tests share: in-memory preference storage and a terminal record.
import type { TerminalInfo } from "../../terminal/types.ts";
import type { PrefsStorage } from "../companionPrefs.ts";

/** A `PrefsStorage` over a map, starting from `initial`; `data` shows what was written. */
export function memoryStorage(initial: Record<string, string> = {}): PrefsStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

/** An idle Claude terminal `id` running in `project_path`. */
export const terminalInfo = (id: string, project_path: string): TerminalInfo => ({
  id,
  name: `term-${id}`,
  project_path,
  run_kind: "claude",
  permission_mode: "normal",
  live_mode: "normal",
  claude_status: "idle",
  auto_approved_count: 0,
});
