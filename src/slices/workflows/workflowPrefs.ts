// The Workflows panel's per-machine preferences (#645): the Archon workflows pinned to Start, and
// the Praxis graphs each project opened most recently. Kept in the WebView's localStorage, and
// validated as they are read.
import { normalizePath } from "../../utils/paths.ts";
import type { PrefsStorage } from "../companion/companionPrefs.ts";

const PINS_KEY = "quay_workflow_pins";
const RECENT_GRAPHS_KEY = "quay_recent_praxis_graphs";

/** The most recently opened graphs kept per project. */
export const MAX_RECENT_GRAPHS = 10;

/** The most projects whose recent graphs are kept. */
const MAX_PROJECTS = 50;

export interface WorkflowPrefs {
  /** The pinned workflows' names, in pin order. */
  readPins(): string[];
  pin(name: string): void;
  unpin(name: string): void;
  /** The ids of the graphs `projectPath` opened, most recent first. */
  readRecentGraphs(projectPath: string): string[];
  /** Records that `projectPath` opened graph `id`. */
  graphOpened(projectPath: string, id: string): void;
}

const isNameList = (v: unknown): v is unknown[] => Array.isArray(v);
const names = (v: unknown[]) => v.filter((x): x is string => typeof x === "string" && x !== "");

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePins(raw: string | null): string[] {
  const value = parseJson(raw);
  return isNameList(value) ? names(value) : [];
}

function parseRecent(raw: string | null): Record<string, string[]> {
  const value = parseJson(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [project, ids] of Object.entries(value)) if (isNameList(ids)) out[project] = names(ids).slice(0, MAX_RECENT_GRAPHS);
  return out;
}

/** The Workflows panel's preferences in `storage`. */
export function workflowPrefs(storage: PrefsStorage): WorkflowPrefs {
  const writePins = (pins: string[]) => storage.setItem(PINS_KEY, JSON.stringify(pins));
  return {
    readPins: () => parsePins(storage.getItem(PINS_KEY)),
    pin(name) {
      const pins = parsePins(storage.getItem(PINS_KEY));
      if (!pins.includes(name)) writePins([...pins, name]);
    },
    unpin(name) {
      writePins(parsePins(storage.getItem(PINS_KEY)).filter((pin) => pin !== name));
    },
    readRecentGraphs: (projectPath) => parseRecent(storage.getItem(RECENT_GRAPHS_KEY))[normalizePath(projectPath)] ?? [],
    graphOpened(projectPath, id) {
      const recent = parseRecent(storage.getItem(RECENT_GRAPHS_KEY));
      const key = normalizePath(projectPath);
      const ids = [id, ...(recent[key] ?? []).filter((other) => other !== id)].slice(0, MAX_RECENT_GRAPHS);
      // The project just used goes last, so the oldest projects drop off first.
      delete recent[key];
      recent[key] = ids;
      const projects = Object.keys(recent);
      for (const old of projects.slice(0, Math.max(0, projects.length - MAX_PROJECTS))) delete recent[old];
      storage.setItem(RECENT_GRAPHS_KEY, JSON.stringify(recent));
    },
  };
}

/**
 * A project's graphs for Start's recent list: those it opened recently that still exist, most
 * recent first, then the others in the order `listed` gives them.
 */
export function recentGraphs(listed: readonly string[], opened: readonly string[]): string[] {
  const exists = new Set(listed);
  const first = opened.filter((id) => exists.has(id));
  const seen = new Set(first);
  return [...first, ...listed.filter((id) => !seen.has(id))];
}
