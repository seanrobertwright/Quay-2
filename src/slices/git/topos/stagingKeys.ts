// The staging inspector's keys and words (#366, #382): what a key does in the Unstaged and Staged
// lists, and the sentences the inspector shows and announces.

import { errorMessage } from "./gitVersion.ts";
import { STATUS_CAP, type PathTarget } from "./stagingLists.ts";

export type ListAction = "up" | "down" | "open" | "stage" | "unstage";

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * What `e` does in a list: ↑/↓ move, Enter opens a folder, `s` stages and `u` unstages. Tab is
 * left to the browser, which moves focus between the lists and their buttons. Nothing acts while
 * focus is in a text field, and no chord with Ctrl, Alt or Meta is taken, so `Ctrl+B`, `Ctrl+K`
 * and `Alt+digit` stay Quay's.
 */
export function listKeyAction(e: KeyPress, inTextField: boolean): ListAction | null {
  if (inTextField || e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Enter":
      return "open";
    case "s":
    case "S":
      return "stage";
    case "u":
    case "U":
      return "unstage";
    default:
      return null;
  }
}

/** The WIP row's text: every change, including those past the status cap. */
export function wipLabel(total: number): string {
  return `${total.toLocaleString("en-US")} changed`;
}

/** The note a status past `STATUS_CAP` shows, or null. */
export function capNote(status: { total: number; truncated: boolean }): string | null {
  return status.truncated ? `Showing the first ${STATUS_CAP.toLocaleString("en-US")} changes` : null;
}

export type StagingAction = "stage" | "unstage" | "ignore";

/** The staging actions that move changes between the worktree and the index. */
export type StageDirection = Exclude<StagingAction, "ignore">;

/** What the live region announces once `action` on `target` has finished. */
export function doneMessage(action: StagingAction, target: PathTarget): string {
  if (action === "ignore") return `Added ${target.kind === "paths" ? target.paths[0] : ""}/ to .gitignore`;
  const verb = action === "stage" ? "Staged" : "Unstaged";
  if (target.kind === "all") return `${verb} all changes`;
  return target.paths.length === 1 ? `${verb} ${target.paths[0]}` : `${verb} ${target.paths.length.toLocaleString("en-US")} paths`;
}

export interface FailureView {
  message: string;
  /** Whether the failure offers Retry: a held `index.lock`, after the backend's own retries. */
  retry: boolean;
  /** Whether the diff the operation was built from is out of date, so the diff view reloads it. */
  stale: boolean;
}

/** What the inspector shows for a rejected staging command. */
export function failureView(e: unknown): FailureView {
  if (typeof e === "object" && e !== null && Object.prototype.hasOwnProperty.call(e, "kind")) {
    switch ((e as { kind: unknown }).kind) {
      case "indexLocked":
        return {
          message: "Another git process is holding index.lock. Quay never deletes it; retry once that process is done.",
          retry: true,
          stale: false,
        };
      case "stagingBusy":
        return { message: "Another staging operation is still running on this worktree.", retry: false, stale: false };
      case "staleDiff":
        return {
          message: "The file changed since its diff was read, so nothing was staged or unstaged. The diff was reloaded.",
          retry: false,
          stale: true,
        };
    }
  }
  return { message: errorMessage(e), retry: false, stale: false };
}

/** The inspector column's width when Topos opens (#366). Persisting it is the settings ticket's. */
export const DEFAULT_INSPECTOR_WIDTH = 400;
export const MIN_INSPECTOR_WIDTH = 280;
export const MAX_INSPECTOR_WIDTH = 720;
const INSPECTOR_STEP = 16;
const INSPECTOR_BIG_STEP = 64;

export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_INSPECTOR_WIDTH;
  return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(width)));
}

/**
 * The width the inspector's handle `key` moves it to, or null for a key it doesn't handle. The
 * handle is on the inspector's left edge, so ArrowLeft widens it. Shift or PageUp/PageDown move
 * further, and Home and End go to either end.
 */
export function inspectorWidthByKey(width: number, key: string, shift: boolean): number | null {
  const step = shift ? INSPECTOR_BIG_STEP : INSPECTOR_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampInspectorWidth(width + step);
    case "ArrowRight":
      return clampInspectorWidth(width - step);
    case "PageUp":
      return clampInspectorWidth(width + INSPECTOR_BIG_STEP);
    case "PageDown":
      return clampInspectorWidth(width - INSPECTOR_BIG_STEP);
    case "Home":
      return MIN_INSPECTOR_WIDTH;
    case "End":
      return MAX_INSPECTOR_WIDTH;
    default:
      return null;
  }
}
