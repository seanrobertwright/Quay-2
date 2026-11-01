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

/** True for the outcomes that say the host itself can't be used, rather than the one call failing. */
export function isHostLevelFailure(outcome: CallOutcome): boolean {
  switch (outcome.kind) {
    case "noHost":
    case "hostDown":
    case "notSignedIn":
    case "expired":
    case "cliNotFound":
      return true;
    default:
      return false;
  }
}

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

/** How a `praxis` call reaches the backend; `invoke` in the app. */
export type Invoker = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Checks the host once with `praxis workflows list --json`, the cheapest call that reaches it.
 * The backend updates the project's host condition from the outcome, so a caller reads the
 * condition, not this call's result. Aborting `signal` cancels the call; an aborted check sends
 * nothing. This is the call behind the 60 s recheck.
 */
export async function checkHost(projectPath: string, signal: AbortSignal, call: Invoker = invoke): Promise<void> {
  if (signal.aborted) return;
  const callId = crypto.randomUUID();
  // `praxis_host_cancel` can't fail; a lost cancel only lets the call run to its own timeout.
  const cancel = () => void call("praxis_host_cancel", { callId }).catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await call("praxis_host_workflows_list", { projectPath, callId });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
