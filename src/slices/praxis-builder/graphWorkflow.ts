// The graph workflow record's rules (#459): `.praxis/graph-workflows/<name>.json` holding
// `{version, contractId, graphId, graphBindingId}`, the unit Quay will submit to a Praxis host
// (#444). Its file name is its name, so it holds no id. The backend checks its shape and,
// against the saved records it names, its local checks; these rules only shape the form.
import type { Step } from "./history.ts";
import { hasOwn, withField, type Json, type JsonObject } from "./model.ts";

/** The `version` a graph workflow is written with. */
export const GRAPH_WORKFLOW_VERSION = 1;

/** The fields that name another record, each with the noun the form and its undo steps use. */
export const GRAPH_WORKFLOW_REFERENCES = {
  contractId: "contract",
  graphId: "graph",
  graphBindingId: "graph binding",
} as const;
export type GraphWorkflowReference = keyof typeof GRAPH_WORKFLOW_REFERENCES;

/** A new graph workflow's record: it names no contract, graph or binding until they are picked. */
export function newGraphWorkflowContent(_name: string): JsonObject {
  return { version: GRAPH_WORKFLOW_VERSION, contractId: "", graphId: "", graphBindingId: "" };
}

/** One change to a graph workflow draft. `live` marks a field being typed, which merges into the step before it. */
export type GraphWorkflowEdit = { type: "set-field"; key: string; value: Json | undefined; live?: boolean };

/** The record after `edit`, or the same object when it changes nothing. */
export function applyGraphWorkflowEdit(content: JsonObject, edit: GraphWorkflowEdit): JsonObject {
  return withField(content, edit.key, edit.value);
}

/** The undo step for a graph workflow edit. Typing in one field merges until its blur or Enter. */
export function graphWorkflowStepFor(edit: GraphWorkflowEdit): Step {
  const noun = hasOwn(GRAPH_WORKFLOW_REFERENCES, edit.key)
    ? GRAPH_WORKFLOW_REFERENCES[edit.key as GraphWorkflowReference]
    : edit.key;
  const label = edit.value === undefined ? `Remove ${noun}` : `Set ${noun}`;
  return edit.live ? { label, merge: { key: `graph-workflow|${edit.key}` } } : { label };
}
