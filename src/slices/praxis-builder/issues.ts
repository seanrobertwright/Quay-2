// What the canvas and the Problems list show from a definition's validation diagnostics.
import type { ValidationStatus } from "./ProblemsPanel.tsx";
import type { Diagnostic, Severity, Validation } from "./types.ts";

/** A node's issues as its card badge shows them. */
export interface NodeIssues {
  count: number;
  /** `error` when any of the node's issues is an error. */
  severity: Severity;
}

/** A stable key per diagnostic from what it says, numbered when two say the same thing. */
export function withKeys(diagnostics: readonly Diagnostic[]): [string, Diagnostic][] {
  const seen = new Map<string, number>();
  return diagnostics.map((d) => {
    const base = `${d.code}|${d.path}|${d.message}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [n === 0 ? base : `${base}|${n}`, d];
  });
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

/**
 * One node's issues, grouped by the inspector control each is about: the first of `slots`
 * that is the issue's field or a dotted prefix of it (`dependsOn` takes `dependsOn.1`).
 * Issues on the whole node, or on a field with no control, are grouped under "".
 */
export function nodeIssuesBySlot(
  diagnostics: readonly Diagnostic[],
  nodeId: string,
  slots: readonly string[]
): Map<string, Diagnostic[]> {
  const bySlot = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (d.nodeId !== nodeId) continue;
    const field = d.field ?? "";
    const slot = slots.find((s) => field === s || field.startsWith(`${s}.`)) ?? "";
    const list = bySlot.get(slot);
    if (list) list.push(d);
    else bySlot.set(slot, [d]);
  }
  return bySlot;
}


/**
 * The graph's validation with the chosen graph binding's issues after its own (#273), each
 * named after the binding, so the canvas's Problems list and badges show both. The graph's
 * verdict stays the verdict. Without a binding it is the graph's own status.
 */
export function withBindingIssues(
  graph: ValidationStatus,
  bindingId: string,
  binding: ValidationStatus | null
): ValidationStatus {
  if (binding === null) return graph;
  if (graph.state !== "done") return graph;
  if (binding.state !== "done") return binding;
  const { validation } = binding;
  return {
    state: "done",
    validation: {
      verdict: graph.validation.verdict,
      diagnostics: [
        ...graph.validation.diagnostics,
        ...validation.diagnostics.map((d) => ({ ...d, message: `Binding ${bindingId}: ${d.message}` })),
      ],
      omitted: {
        errors: graph.validation.omitted.errors + validation.omitted.errors,
        info: graph.validation.omitted.info + validation.omitted.info,
      },
    },
  };
}
