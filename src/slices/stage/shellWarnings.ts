// The shell-wide warning stack (#635): problems that affect the whole window, shown as one
// dismissible line each under the stage tab bar. Per-terminal notices, such as the Skip banner,
// are not shell-wide and stay with their pane.
import { useSyncExternalStore } from "react";

/** A shell-wide warning. Its `id` names the problem, so showing it again replaces it. */
export interface ShellWarning {
  id: string;
  message: string;
}

/** The stack with `warning` on top, and any earlier warning with the same id removed. */
export function addWarning(stack: readonly ShellWarning[], warning: ShellWarning): ShellWarning[] {
  return [warning, ...stack.filter((w) => w.id !== warning.id)];
}

/** The stack without the warning `id`; the same warnings in the same order if it isn't there. */
export function dismissWarning(stack: readonly ShellWarning[], id: string): ShellWarning[] {
  return stack.filter((w) => w.id !== id);
}

// The window's live warnings, newest first. Anything in the frontend can raise one.
let live: readonly ShellWarning[] = [];
const listeners = new Set<() => void>();

function setLive(next: readonly ShellWarning[]): void {
  live = next;
  for (const listener of listeners) listener();
}

/** Shows `warning` on top of the shell-wide warnings, replacing a live one with the same id. */
export function showShellWarning(warning: ShellWarning): void {
  setLive(addWarning(live, warning));
}

/** Takes the warning `id` off the screen. */
export function dismissShellWarning(id: string): void {
  setLive(dismissWarning(live, id));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live shell-wide warnings, newest first; the component re-renders when they change. */
export function useShellWarnings(): readonly ShellWarning[] {
  return useSyncExternalStore(subscribe, () => live);
}
