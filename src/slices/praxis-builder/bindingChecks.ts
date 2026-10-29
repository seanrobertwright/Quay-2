// The figures and issues the builder shows from a graph binding's checks (#247, #274). The
// backend runs every check: `praxis_validate` the submission checks against the graph, and
// `praxis_check_binding` the attach checks under each contract that lists the graph, with the
// coverage of its criteria. Here those results are joined for the Problems list, and the
// worst-case preview is worked out, which is arithmetic, not a check: Praxis holds a run at its
// cost bound whatever the preview says.
import { isDispatchable } from "./graphBinding.ts";
import { hasOwn, isObject, type JsonObject } from "./model.ts";
import type { BindingAttach, Diagnostic, ValidationStatus } from "./types.ts";

/** The label the worst-case figures carry (#247). */
export const WORST_CASE_LABEL = "if every attempt spends its whole allowance; Praxis holds the run at its cost bound.";

/** Where the attach checks stand: running, failed to run, or done with their result. */
export type AttachStatus = { state: "checking" } | { state: "failed"; error: string } | { state: "done"; attach: BindingAttach };

/** A graph node as the worst case reads it. */
export interface WorstCaseNode {
  id: string;
  kind: string;
  config: JsonObject;
}

/** One Bounded entry's worst case: allowance × attempts × iterations (iterations is 1 but for a LOOP). */
export interface EntryWorstCase {
  node: string;
  allowance: bigint;
  attempts: bigint;
  iterations: bigint;
  worstCase: bigint;
}

/** A binding's worst case: the sum over the Bounded entries it could count, and those it couldn't, with why. */
export interface WorstCase {
  total: bigint;
  counted: EntryWorstCase[];
  uncounted: { node: string; reason: string }[];
}

/** A canonical unsigned decimal string as a bigint, or null for anything else. */
function decimal(value: unknown): bigint | null {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

/**
 * One entry's worst case on `node` (#247): its allowance, times its `maxAttempts`, else the
 * contract's `contractMaxAttempts`, times the node's `maxIterations` for a LOOP, which Praxis
 * dispatches once per iteration. Null for an entry that isn't Bounded, which counts zero; a
 * reason when a figure it needs isn't known.
 */
export function entryWorstCase(entry: JsonObject, node: WorstCaseNode, contractMaxAttempts?: string): EntryWorstCase | { reason: string } | null {
  const exposure = isObject(entry.exposure) ? entry.exposure : null;
  if (exposure?.kind !== "BOUNDED" || (entry.executionKind !== "AGENT" && entry.executionKind !== "TOOL")) return null;
  const allowance = decimal(exposure.allowance);
  if (allowance === null || allowance === 0n) return { reason: "Its allowance isn't set." };
  const own = entry.maxAttempts;
  const attempts =
    typeof own === "number" && Number.isSafeInteger(own) && own >= 1 ? BigInt(own) : decimal(contractMaxAttempts);
  if (attempts === null) return { reason: "Its attempts aren't known: set Max attempts, or bind the graph to a contract." };
  let iterations = 1n;
  if (node.kind === "LOOP") {
    const n = decimal(node.config.maxIterations);
    if (n === null) return { reason: "The loop's maxIterations isn't a whole number." };
    iterations = n;
  }
  return { node: node.id, allowance, attempts, iterations, worstCase: allowance * attempts * iterations };
}

/**
 * A binding's worst case over the graph's `nodes` (#247): the sum of `entryWorstCase` over the
 * entries of its dispatchable nodes, in node order. Every entry counts, so both branches of a
 * DECISION do. Attempts come from each entry's `maxAttempts`, else `contractMaxAttempts`.
 */
export function worstCase(binding: JsonObject, nodes: readonly WorstCaseNode[], contractMaxAttempts?: string): WorstCase {
  const entries = isObject(binding.nodes) ? binding.nodes : {};
  const out: WorstCase = { total: 0n, counted: [], uncounted: [] };
  for (const node of nodes) {
    const entry = hasOwn(entries, node.id) ? entries[node.id] : undefined;
    if (!isDispatchable(node.kind) || !isObject(entry)) continue;
    const figure = entryWorstCase(entry, node, contractMaxAttempts);
    if (figure === null) continue;
    if ("reason" in figure) {
      out.uncounted.push({ node: node.id, reason: figure.reason });
    } else {
      out.counted.push(figure);
      out.total += figure.worstCase;
    }
  }
  return out;
}

/** An info issue about checks against contracts that didn't run. */
const unchecked = (message: string): Diagnostic => ({ code: "CONTRACTS_UNCHECKED", severity: "info", message, path: "" });

/** What the attach checks couldn't do, as info issues: they failed, a contract couldn't be read, or a file wasn't searched. */
export function attachStatusIssues(status: AttachStatus): Diagnostic[] {
  if (status.state === "checking") return [];
  if (status.state === "failed") return [unchecked(`The checks against the graph's contracts couldn't run: ${status.error}`)];
  return [
    ...status.attach.contracts.flatMap((c) =>
      c.problem === undefined ? [] : [unchecked(`Contract ${c.id} can't be read, so the binding wasn't checked against it: ${c.problem}`)]
    ),
    ...status.attach.unchecked.map((file) => unchecked(`Not checked against contracts: ${file}`)),
  ];
}

/**
 * The binding's own validation with its attach checks' warnings after its own issues (#274), so
 * the Problems list, the badges and the fields show both. While the attach checks run, the
 * binding's own status stands alone.
 */
export function withAttachIssues(binding: ValidationStatus, attach: AttachStatus): ValidationStatus {
  if (binding.state !== "done" || attach.state === "checking") return binding;
  const contracts = attach.state === "done" ? attach.attach.contracts : [];
  const { validation } = binding;
  return {
    state: "done",
    validation: {
      ...validation,
      diagnostics: [...validation.diagnostics, ...contracts.flatMap((c) => c.diagnostics), ...attachStatusIssues(attach)],
      omitted: { ...validation.omitted, warnings: validation.omitted.warnings + contracts.reduce((n, c) => n + c.omitted, 0) },
    },
  };
}

/**
 * The cost units that the saved bindings of `graphs` name (#231, #274), each with those bindings,
 * in the order first seen, for a contract form to show. `entries` are the graph bindings listed;
 * a binding that names no unit is left out. More than one unit means some binding disagrees with
 * the ledger's one unit.
 */
export function boundCostUnits(
  graphs: readonly string[],
  entries: readonly { id: string; graphId?: string; costUnit?: string }[]
): { unit: string; bindings: string[] }[] {
  const bound = new Set(graphs);
  const byUnit = new Map<string, string[]>();
  for (const e of entries) {
    if (e.graphId === undefined || e.costUnit === undefined || !bound.has(e.graphId)) continue;
    const list = byUnit.get(e.costUnit);
    if (list) list.push(e.id);
    else byUnit.set(e.costUnit, [e.id]);
  }
  return [...byUnit].map(([unit, bindings]) => ({ unit, bindings }));
}
