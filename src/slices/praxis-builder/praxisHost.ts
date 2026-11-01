// The frontend's side of the Praxis CLI runner (#446): the typed outcome of a `praxis` call, a
// project's host condition, and the helper that opens a visible terminal for the `praxis`
// commands that need a person. The backend module is `src-tauri/src/slices/praxis/host`.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** What a project's Praxis host is known to be, as the last call for it left it. */
export type HostCondition =
  | { state: "notCheckedYet" }
  | { state: "cliNotFound"; reason: string }
  | { state: "noHostSetUp" }
  | { state: "hostUnreachable" }
  | { state: "notSignedIn" }
  | { state: "signedIn" }
  | { state: "simulatedHost" };

/** The outcome of one `praxis --json` call. */
export type CallOutcome =
  | { kind: "record"; record: Record<string, unknown> }
  | { kind: "blocked"; record: Record<string, unknown>; blockingRunAddress: string }
  | { kind: "needsUpdate"; detail: string }
  | { kind: "noHost"; message: string }
  | { kind: "hostDown"; message: string }
  | { kind: "notSignedIn"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "cliNotFound"; reason: string }
  | { kind: "timedOut" }
  | { kind: "cancelled" };

/** The payload of the `praxis-host-condition` event. */
export interface HostConditionChange {
  projectPath: string;
  condition: HostCondition;
}

/** Calls `onChange` whenever a project's host condition changes. */
export function listenHostCondition(onChange: (change: HostConditionChange) => void): Promise<UnlistenFn> {
  return listen<HostConditionChange>("praxis-host-condition", (event) => onChange(event.payload));
}

/** The `praxis` commands that need a person at a terminal. Quay never runs them headless. */
export type InteractiveCommand = "serve" | "setup" | "login" | "trust";

/** Opens a plain shell terminal in `cwd` and types `argv` into it; false when it couldn't. */
export type RunInTerminal = (cwd: string, argv: string[]) => Promise<boolean>;

/**
 * Opens a visible shell terminal in `projectPath` with `praxis <command>` typed in, so the user
 * sees and answers every prompt. It runs the same `praxis` the builder's calls use, with the
 * installation setting's `--state`, and never a flag that skips a confirmation. Rejects with
 * the reason when `praxis` can't be found.
 */
export async function openPraxisTerminal(
  command: InteractiveCommand,
  projectPath: string,
  runInTerminal: RunInTerminal,
  argvFor: (command: InteractiveCommand) => Promise<string[]> = (c) => invoke<string[]>("praxis_host_terminal_argv", { command: c }),
): Promise<boolean> {
  return runInTerminal(projectPath, await argvFor(command));
}
