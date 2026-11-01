// Starting a workflow template run (#362, #454): a headless `praxis run <name> --json` through the
// Praxis CLI runner (#446), never in a terminal and never with `--follow`, which hides the work
// order id. The runner bounds a creation at 75 s and kills its process tree after that. praxis
// saves a pending creation in its profile before it sends one (#361), so a killed creation stays
// pending and the next Run resumes it rather than creating a second run. Quay never runs a
// creation again on its own. This module has no UI: the Runs view and its confirm dialog draw it.
import { invoke } from "@tauri-apps/api/core";
import type { TemplateHostState } from "./hostCatalog.ts";
import { praxisCall, type CallOutcome, type Invoker } from "./praxisHost.ts";
import type { ChangeStatus } from "./types.ts";
import { normalizePath } from "../../utils/paths.ts";

/** What one Run came to, in the words the Runs view shows. */
export type RunStart =
  /** Exit 0: the new run, which the view selects and follows. */
  | { kind: "created"; workOrderId: string; runId: string; runPageAddress: string | null }
  /** Exit 7: a held run, or one awaiting approval, blocks new runs. */
  | { kind: "blocked"; message: string; blockingWorkOrderId: string | null; blockingRunAddress: string }
  /** Exit 1 that names the host's state (down, not set up, signed out, expired), or no praxis. */
  | { kind: "host"; message: string }
  /** Quay can't tell whether a run was created: its own timeout, or an outcome praxis didn't report. */
  | { kind: "unknown"; message: string }
  /** Every other refusal, in praxis's own words. */
  | { kind: "refused"; message: string }
  /** Exit 2, or a format Quay doesn't read. */
  | { kind: "needsUpdate"; message: string };

/** How long the runner lets a creation take before it kills it: `CallBounds::create` in the backend. */
export const RUN_CREATE_TIMEOUT_S = 75;

/** The words of every outcome that can't say whether the run was created. */
export const UNKNOWN_OUTCOME_ADVICE =
  "praxis keeps the creation pending, so Run again finishes it and can't create a second run.";

/** The header of the "needs an update" outcome. */
export const NEEDS_UPDATE = "Quay needs an update for this praxis.";

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** What a `praxis_host_run` outcome means for the person who pressed Run. */
export function runStartOf(outcome: CallOutcome, name: string): RunStart {
  switch (outcome.kind) {
    case "record": {
      const workOrderId = str(outcome.record.workOrderId);
      if (workOrderId === null) {
        // The run was created, so this must not say Run again is safe.
        return { kind: "needsUpdate", message: `${NEEDS_UPDATE} praxis started a run of ${name}, but its result has no work order Quay can read.` };
      }
      return {
        kind: "created",
        workOrderId,
        runId: str(outcome.record.runId) ?? workOrderId,
        runPageAddress: str(outcome.record.runPageAddress),
      };
    }
    case "blocked": {
      const code = outcome.record.code;
      const which =
        code === "WORKFLOW_RUN_HELD"
          ? "A held run of this template"
          : code === "WORKFLOW_RUN_PENDING_APPROVAL"
            ? "A run of this template awaiting approval"
            : "A held run, or one awaiting approval,";
      return {
        kind: "blocked",
        message: `${which} blocks new runs of ${name}. Resolve it in the browser, then run again.`,
        blockingWorkOrderId: str(outcome.record.blockingWorkOrderId),
        blockingRunAddress: outcome.blockingRunAddress,
      };
    }
    case "noHost":
      return { kind: "host", message: "No Praxis host is set up on this machine, so no run was started. Set up a host, then run again." };
    case "hostDown":
      return { kind: "host", message: "The Praxis host isn't answering, so no run was started. Start the host, then run again." };
    case "notSignedIn":
      return { kind: "host", message: "praxis isn't signed in to this host, so no run was started. Sign in, then run again." };
    case "expired":
      return { kind: "host", message: "praxis's session on this host has expired, so no run was started. Sign in again, then run again." };
    case "cliNotFound":
      return { kind: "host", message: `Quay couldn't run praxis: ${outcome.reason}` };
    case "timedOut":
      return { kind: "unknown", message: `praxis didn't finish starting the run within ${RUN_CREATE_TIMEOUT_S} s, so Quay stopped it, and can't tell whether the run was created. ${UNKNOWN_OUTCOME_ADVICE}` };
    case "unknown":
      return { kind: "unknown", message: `Quay can't tell whether praxis created the run: ${outcome.detail} ${UNKNOWN_OUTCOME_ADVICE}` };
    case "cancelled":
      return { kind: "unknown", message: `praxis was stopped before it said whether the run was created. ${UNKNOWN_OUTCOME_ADVICE}` };
    case "refused":
      return { kind: "refused", message: outcome.message };
    case "needsUpdate":
      return { kind: "needsUpdate", message: `${NEEDS_UPDATE} ${outcome.detail}` };
  }
}

/**
 * Why the host can't run the template, from its host state: the reasons `workflows show` gave
 * when it isn't `runnable`, the host's diagnostics for a copy it holds invalid, or the name rule.
 * Null when nothing known stops a run. Run in the header is disabled with this reason.
 */
export function runRefusedBy(state: TemplateHostState): string | null {
  switch (state.kind) {
    case "notReady":
      return `The host can't run it: ${state.reason}`;
    case "invalidOnHost":
      return `The host's copy isn't valid${state.diagnostics.length > 0 ? `: ${state.diagnostics.join(" ")}` : "."}`;
    case "nameRefused":
      return state.rule;
    default:
      return null;
  }
}

/** One warning of the confirm dialog. */
export interface RunWarning {
  key: "differs" | "notInstalled" | "notReady" | "invalidOnHost" | "unsaved" | "uncommitted" | "gitUnknown";
  text: string;
}

/**
 * The confirm dialog's warnings, from the template's host state, whether the open draft has
 * edits the saved file lacks, and how the file differs from the last commit.
 */
export function runWarnings(state: TemplateHostState, unsaved: boolean, changed: ChangeStatus | "unknown" | undefined): RunWarning[] {
  const warnings: RunWarning[] = [];
  if (state.kind === "differs") {
    warnings.push({ key: "differs", text: "The host's installed copy differs from the saved file. The host's copy runs, not this file." });
  } else if (state.kind === "notInstalled") {
    warnings.push({ key: "notInstalled", text: "The host doesn't have this template installed, so there is nothing to run." });
  } else if (state.kind === "notReady") {
    warnings.push({ key: "notReady", text: `The host's copy isn't ready to run: ${state.reason}` });
  } else if (state.kind === "invalidOnHost") {
    warnings.push({ key: "invalidOnHost", text: runRefusedBy(state) ?? "" });
  }
  if (unsaved) warnings.push({ key: "unsaved", text: "The draft has unsaved changes. They don't run: the host runs its installed copy." });
  if (changed === "unknown") {
    warnings.push({ key: "gitUnknown", text: "Quay couldn't read git status, so it can't tell whether this template has changes that aren't committed." });
  } else if (changed !== undefined) {
    warnings.push({ key: "uncommitted", text: "The template file has changes that aren't committed." });
  }
  return warnings;
}

/** Why the confirm dialog's Run is withheld: what stops the header's Run, or no host copy at all. */
export function confirmRefusedBy(state: TemplateHostState): string | null {
  if (state.kind === "notInstalled") return "Install the template on the host first.";
  return runRefusedBy(state);
}

/** Every Run in flight, one per project and template, shared by every Runs view. */
export interface RunStarts {
  /**
   * Runs `praxis run <name> --json` for `projectPath`, or joins the creation in flight for that
   * name. Never cancelled by Quay: it ends when praxis does, or at the runner's 75 s timeout.
   */
  start(projectPath: string, name: string): Promise<RunStart>;
  /** The creation in flight for `name`, if any. */
  inFlight(projectPath: string, name: string): Promise<RunStart> | null;
  /** Calls `listener` whenever a creation starts or ends; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createRunStarts(call: Invoker = invoke): RunStarts {
  const flights = new Map<string, Promise<RunStart>>();
  const listeners = new Set<() => void>();
  const keyOf = (projectPath: string, name: string) => `${normalizePath(projectPath)}\n${name}`;
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    start(projectPath, name) {
      const key = keyOf(projectPath, name);
      const joined = flights.get(key);
      if (joined) return joined;
      // A signal that is never aborted: closing the view doesn't kill a creation.
      const flight = praxisCall("praxis_host_run", { projectPath, name }, new AbortController().signal, call)
        .then((outcome) => runStartOf(outcome, name))
        .finally(() => {
          flights.delete(key);
          changed();
        });
      flights.set(key, flight);
      changed();
      return flight;
    },
    inFlight: (projectPath, name) => flights.get(keyOf(projectPath, name)) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The app's creations. */
export const runStarts = createRunStarts();
