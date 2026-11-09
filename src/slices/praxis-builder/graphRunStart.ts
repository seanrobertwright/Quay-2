// What a graph workflow's host state means for Run (#444, #466), in one place so the Runs header
// and the confirm agree: why Run is disabled, why the confirm's Start run is withheld, and the
// confirm's warnings. The host runs its current admitted revision, never the project's files, so
// Run needs one; edits that differ from it warn but never stop a run. The creation itself is
// `graphRunStarts` in `runStart.ts`.
import type { GraphWorkflowHostView } from "./graphHost.ts";
import { hostConditionView } from "./hostCondition.ts";
import { RECORD_KINDS } from "./kinds.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { BundleChanges, DefinitionRef } from "./types.ts";

/**
 * Why Run in the Runs header is disabled, from what the host was last read to hold: no admitted
 * revision, or one it says can't run. Null when nothing known stops a run, including when the
 * state is unknown: the confirm reads the host again before it lets a run start.
 */
export function graphRunRefusedBy(name: string, view: GraphWorkflowHostView): string | null {
  const { state } = view;
  switch (state.kind) {
    case "nameRefused":
      return state.rule;
    case "notSubmitted":
      return `The host has no admitted revision of ${name} to run. Submit it; once the owner admits it in the browser, it can run.`;
    case "retired":
      return `The owner retired ${name} on the host, so it has no admitted revision to run.`;
    case "candidate":
      return view.current === null
        ? `No revision of ${name} is admitted yet: candidate revision ${state.revision} waits for the owner in the browser.`
        : null;
    case "notReady":
      return `Admitted revision ${state.revision} isn't ready to run: ${state.reason}`;
    default:
      return null;
  }
}

/**
 * Why the confirm's Start run is withheld: what disables Run in the header, or no reading that
 * names an admitted revision, because the host can't be read or its read failed.
 */
export function graphConfirmRefusedBy(name: string, view: GraphWorkflowHostView, condition: HostCondition): string | null {
  const refusal = graphRunRefusedBy(name, view);
  if (refusal !== null) return refusal;
  const { state } = view;
  if (state.kind === "unknown") {
    if (state.why === "host") return `Quay can't tell which revision would run: ${hostConditionView(condition).label}.`;
    return `Quay couldn't read ${name}'s admitted revision from the host${state.message ? `: ${state.message}` : "."}`;
  }
  return view.current === null ? `Quay couldn't read ${name}'s admitted revision from the host.` : null;
}

/** One warning of the graph run confirm. */
export interface GraphRunWarning {
  key: "differs" | "unsaved" | "uncommitted" | "gitUnknown";
  text: string;
}

/** How the bundle's files differ from the last commit, or why Quay couldn't tell. */
export type BundleChangesRead = BundleChanges | { error: string };

/** A record as the warnings name it: "graph g". Graph bindings have no group in the left list. */
export function recordLabel(ref: DefinitionRef): string {
  const noun = ref.kind === "graph-bindings" ? "graph binding" : (RECORD_KINDS.find((k) => k.kind === ref.kind)?.singular ?? ref.kind);
  return `${noun} ${ref.id}`;
}

/**
 * The confirm's warnings: the saved files aren't the current revision's, `unsaved` names records
 * of the bundle with unsaved edits, and `changes` says which of its files aren't committed.
 */
export function graphRunWarnings(view: GraphWorkflowHostView, unsaved: readonly DefinitionRef[], changes: BundleChangesRead | null): GraphRunWarning[] {
  const warnings: GraphRunWarning[] = [];
  const revision = view.current?.revision;
  const runs = revision === undefined ? "the host's admitted revision runs" : `admitted revision ${revision} runs`;
  if (view.differsFromCurrent && revision !== undefined) {
    warnings.push({ key: "differs", text: `The saved files differ from admitted revision ${revision}. Revision ${revision} runs, not the saved files.` });
  }
  if (unsaved.length > 0) {
    warnings.push({ key: "unsaved", text: `Unsaved edits to ${unsaved.map(recordLabel).join(", ")} don't run: ${runs}.` });
  }
  if (changes && "error" in changes) {
    warnings.push({ key: "gitUnknown", text: `Quay couldn't read git status, so it can't tell whether the bundle's files have changes that aren't committed: ${changes.error}` });
  } else if (changes && changes.files.length > 0) {
    warnings.push({ key: "uncommitted", text: `These files have changes that aren't committed: ${changes.files.map((f) => f.path).join(", ")}.` });
  }
  return warnings;
}
