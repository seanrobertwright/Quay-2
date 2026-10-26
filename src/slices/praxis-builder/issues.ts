// What the canvas and the Problems list show from a definition's validation diagnostics.
import type { Diagnostic, Severity, Validation } from "./types.ts";

/** A node's issues as its card badge shows them. */
export interface NodeIssues {
  count: number;
  /** `error` when any of the node's issues is an error. */
  severity: Severity;
}

/** Each node's issue count, keyed by node id, in the order the nodes first appear. */
export function issuesByNode(diagnostics: readonly Diagnostic[]): Map<string, NodeIssues> {
  const byNode = new Map<string, NodeIssues>();
  for (const d of diagnostics) {
    if (d.nodeId === undefined) continue;
    const seen = byNode.get(d.nodeId);
    byNode.set(d.nodeId, {
      count: (seen?.count ?? 0) + 1,
      severity: seen?.severity === "error" || d.severity === "error" ? "error" : "info",
    });
  }
  return byNode;
}

/**
 * Where in its node, or in the record, an issue is: the node's field (`config.then`), empty
 * for a whole node, or the dotted path for an issue outside any node (`revision`).
 */
export function issueField(d: Diagnostic): string {
  if (d.nodeId !== undefined) return d.field ?? "";
  return d.path
    .split("/")
    .slice(1)
    .map((segment) => segment.split("~1").join("/").split("~0").join("~"))
    .join(".");
}

/** How many errors and info issues a validation found, the omitted ones included. */
export function problemCounts(validation: Validation): { errors: number; info: number } {
  const errors = validation.diagnostics.filter((d) => d.severity === "error").length;
  return {
    errors: errors + validation.omitted.errors,
    info: validation.diagnostics.length - errors + validation.omitted.info,
  };
}
