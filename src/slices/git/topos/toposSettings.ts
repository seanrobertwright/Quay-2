// Topos's user prefs (#369, #384). The Rust store in `src-tauri/src/slices/git/settings.rs` keeps
// them in topos.json, validates them and debounces the write; this side only reads and patches.

import type { DiffMode } from "./FileDiffView";
import { DEFAULT_COLUMN_WIDTH } from "./graphColumn.ts";
import { DEFAULT_INSPECTOR_WIDTH } from "./stagingKeys.ts";
import type { ListMode } from "./stagingLists.ts";

/** The four prefs Topos remembers. There is no theme or graph-order pref (#369). */
export interface ToposPrefs {
  graphColumnWidth: number;
  inspectorWidth: number;
  diffMode: DiffMode;
  fileListMode: ListMode;
}

/** What `topos_settings_read` and `topos_settings_write` return. */
export interface ToposSettings extends ToposPrefs {
  /** Per-repo state, keyed by git's common dir. */
  repos: Record<string, { lastOpened: number; suppressSpeedup: boolean }>;
}

/** What `topos_settings_write` takes. A field left out keeps its value. */
export type ToposSettingsPatch = Partial<ToposPrefs> & {
  /** A repo or worktree path Topos has just opened, which records its repo's last-opened time. */
  openedRepo?: string;
  /** A repo or worktree path whose repo the speed-up banner no longer suggests for (#385). */
  suppressSpeedup?: string;
};

/** The prefs before topos.json has been read, and the store's own defaults. */
export const DEFAULT_PREFS: ToposPrefs = {
  graphColumnWidth: DEFAULT_COLUMN_WIDTH,
  inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
  diffMode: "unified",
  fileListMode: "flat",
};
