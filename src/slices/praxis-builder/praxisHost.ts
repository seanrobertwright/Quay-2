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

/**
 * The outcome of one `praxis --json` call. A `status` record carries `trustHint`, the
 * certificate hint praxis wrote on stderr, when it gave one.
 */
export type CallOutcome =
  | { kind: "record"; record: Record<string, unknown>; trustHint?: string }
  | { kind: "blocked"; record: Record<string, unknown>; blockingRunAddress: string }
  /** `praxis graphs check` or `submit` exit 9: `record.findings` names the bundle file of each fault. */
  | { kind: "bundleInvalid"; record: Record<string, unknown> }
  /**
   * `praxis triggers check` or `submit` exit 9: `record.findings` gives each fault's JSON Pointer
   * `path` in the trigger and the host's `code`.
   */
  | { kind: "triggerInvalid"; record: Record<string, unknown> }
  | { kind: "needsUpdate"; detail: string }
  | { kind: "noHost"; message: string }
  | { kind: "hostDown"; message: string }
  | { kind: "notSignedIn"; message: string }
  | { kind: "expired"; message: string }
  /** The host refused the request: `hostCode` is its code, such as `NOT_FOUND`, and `record` the `praxis-error/1` record. */
  | { kind: "hostRefused"; message: string; hostCode: string; record: Record<string, unknown> }
  | { kind: "refused"; message: string }
  | { kind: "cliNotFound"; reason: string }
  /**
   * A write that ended without saying whether it took effect. When praxis says it couldn't
   * confirm a write other than a run creation (a graph workflow's submission or withdrawal, or a
   * graph trigger's submission, withdrawal, disabling or retirement), this carries the
   * `requestId` that resends it.
   */
  | { kind: "unknown"; detail: string; requestId?: string }
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

/** The words of an outcome that isn't a record, for a failed read. */
export function outcomeMessage(outcome: CallOutcome): string {
  switch (outcome.kind) {
    case "needsUpdate":
      return `Quay needs an update for this praxis: ${outcome.detail}`;
    case "bundleInvalid":
      return "The host found faults in the bundle.";
    case "triggerInvalid":
      return "The host found faults in the graph trigger.";
    case "refused":
    case "hostRefused":
    case "noHost":
    case "hostDown":
    case "notSignedIn":
    case "expired":
      return outcome.message;
    case "cliNotFound":
      return outcome.reason;
    case "unknown":
      return outcome.detail;
    case "timedOut":
      return "praxis didn't answer in time.";
    default:
      return "praxis gave an answer Quay can't read.";
  }
}

/**
 * What one write to the host that a person confirmed came to, in the words its confirm shows: a
 * withdrawal of a graph workflow or graph trigger candidate, or a graph trigger's disabling or
 * retirement.
 */
export type WriteOutcome =
  | { kind: "done" }
  /** Nothing changed: the host refused it, such as for a candidate already decided, or couldn't be asked. */
  | { kind: "refused"; message: string }
  /** Quay can't tell whether the host did it. */
  | { kind: "unknown"; message: string };

/** How a write's outcome names it. */
export interface WriteWords {
  /** "withdraw revision 2 of nightly". */
  doing: string;
  /** "withdrew revision 2 of nightly". */
  done: string;
}

/** What a write's call outcome means for the person who confirmed it. */
export function writeOutcomeOf(outcome: CallOutcome, words: WriteWords): WriteOutcome {
  switch (outcome.kind) {
    case "record":
      return { kind: "done" };
    case "hostRefused":
      if (outcome.hostCode === "REVISION_NOT_PENDING") {
        return {
          kind: "refused",
          message: `The host refused to ${words.doing}: it is no longer pending. The owner has admitted or rejected it, or it was withdrawn already. ${outcome.message}`,
        };
      }
      return { kind: "refused", message: `The host refused to ${words.doing}: ${outcome.message}` };
    case "unknown":
      return {
        kind: "unknown",
        message: `Quay can't tell whether the host ${words.done}: ${outcome.detail}${outcome.requestId ? " Pressing it again resends the same request." : ""}`,
      };
    case "timedOut":
      return { kind: "unknown", message: `praxis didn't answer in time, so Quay can't tell whether the host ${words.done}.` };
    case "cancelled":
      return { kind: "unknown", message: `praxis was stopped before it said whether the host ${words.done}.` };
    default:
      return { kind: "refused", message: `Quay didn't ${words.doing}: ${outcomeMessage(outcome)}` };
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
 * Sends `command` through the runner with a fresh call id. Aborting `signal` sends
 * `praxis_host_cancel` for that id, which kills its process. Rejects when the invoke does. The
 * one home of the cancel-on-abort rule for every `praxis` call.
 */
async function cancellableCall(command: string, args: Record<string, unknown>, signal: AbortSignal, call: Invoker): Promise<unknown> {
  const callId = crypto.randomUUID();
  // `praxis_host_cancel` can't fail; a lost cancel only lets the call run to its own timeout.
  const cancel = () => void call("praxis_host_cancel", { callId }).catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await call(command, { ...args, callId });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/**
 * Checks the host once with `praxis workflows list --json`, the cheapest call that reaches it.
 * The backend updates the project's host condition from the outcome, so a caller reads the
 * condition, not this call's result. Aborting `signal` cancels the call; an aborted check sends
 * nothing. This is the call behind the 60 s recheck.
 */
export async function checkHost(projectPath: string, signal: AbortSignal, call: Invoker = invoke): Promise<void> {
  if (signal.aborted) return;
  await cancellableCall("praxis_host_workflows_list", { projectPath }, signal, call);
}

/**
 * One `praxis` call through the runner's `command`, with a fresh call id. Aborting `signal` sends
 * `praxis_host_cancel` for it, which kills its process; an already aborted call sends nothing and
 * is `cancelled`. A command the backend refuses before running `praxis`, such as an unregistered
 * project or a limit out of range, comes back as `refused` in the backend's words. Never rejects.
 */
export async function praxisCall(command: string, args: Record<string, unknown>, signal: AbortSignal, call: Invoker = invoke): Promise<CallOutcome> {
  if (signal.aborted) return { kind: "cancelled" };
  try {
    return (await cancellableCall(command, args, signal, call)) as CallOutcome;
  } catch (e) {
    return { kind: "refused", message: String(e) };
  }
}
