// The cross-record checks as the builder holds them (#223, #269): each contract's last result
// from `praxis_check_context`, merged as checks come back, and what each record and graph reads
// from them. A full check covers every contract; opening or saving a record re-checks only the
// contracts it affects, so results arrive out of order and the newest per contract wins.
import { definitionKey } from "./session.ts";
import type { ContextCheck, ContractContext, DefinitionRef, RecordIssue } from "./types.ts";

export interface RunContexts {
  /** Each contract's last result, by contract id. */
  byId: ReadonlyMap<string, ContractContext>;
  /** The request each result in `byId` came from, so an older one never replaces it. */
  seqs: ReadonlyMap<string, number>;
  /** The bindings and trigger files the last full check couldn't read. */
  unchecked: readonly string[];
  /** Whether a full check has come back, so a contract absent from `byId` is known not to exist. */
  checked: boolean;
}

export const NO_CONTEXTS: RunContexts = { byId: new Map(), seqs: new Map(), unchecked: [], checked: false };

/** Whether nothing names or binds a contract with no file, so it has nothing to show. */
const forgotten = (c: ContractContext) => c.missing && c.triggers.length === 0 && c.graphs.length === 0 && c.grants.length === 0;

/**
 * The contexts with `result` merged in: request `seq` of them, a full check of every contract or
 * a targeted one. A full check drops the contracts it didn't find, unless a newer check has them.
 */
export function mergeContexts(cur: RunContexts, result: ContextCheck, { seq, full }: { seq: number; full: boolean }): RunContexts {
  const byId = new Map(cur.byId);
  const seqs = new Map(cur.seqs);
  if (full) {
    const found = new Set(result.contracts.map((c) => c.id));
    for (const [id, at] of cur.seqs) {
      if (!found.has(id) && at < seq) {
        byId.delete(id);
        seqs.delete(id);
      }
    }
  }
  for (const c of result.contracts) {
    if ((seqs.get(c.id) ?? -1) > seq) continue;
    if (forgotten(c)) {
      byId.delete(c.id);
      seqs.delete(c.id);
    } else {
      byId.set(c.id, c);
      seqs.set(c.id, seq);
    }
  }
  return { byId, seqs, unchecked: full ? result.unchecked : cur.unchecked, checked: cur.checked || full };
}

/** Whether the contract's last result binds or names the record. */
function mentions(c: ContractContext, ref: DefinitionRef): boolean {
  switch (ref.kind) {
    case "contracts":
      return c.id === ref.id;
    case "graphs":
      return c.graphs.includes(ref.id);
    case "grants":
      return c.grants.includes(ref.id);
    case "triggers":
      return c.triggers.includes(ref.id);
  }
}

/**
 * The contracts whose last result binds or names the record. A re-check of the record asks for
 * these too, so a contract it has left, such as a trigger's previous contract, is checked again.
 */
export const contractsToRecheck = (cur: RunContexts, ref: DefinitionRef): string[] =>
  [...cur.byId.values()].filter((c) => mentions(c, ref)).map((c) => c.id);

/** The record's cross-record issues from every contract, in contract order, each said once. */
export function issuesOn(cur: RunContexts, ref: DefinitionRef): RecordIssue[] {
  const seen = new Set<string>();
  const out: RecordIssue[] = [];
  for (const c of [...cur.byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const i of c.issues) {
      if (i.kind !== ref.kind || i.id !== ref.id) continue;
      const key = JSON.stringify([i.path, i.code, i.message]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}

/** The definition keys of the records with a cross-record error, for the list's badges. */
export function recordsWithErrors(cur: RunContexts): Set<string> {
  const out = new Set<string>();
  for (const c of cur.byId.values()) {
    for (const i of c.issues) if (i.severity === "error") out.add(definitionKey(i));
  }
  return out;
}

/** What a graph's Run context shows: the contracts it runs under, and its cross-record issues. */
export interface GraphRunContext {
  /** The contracts with a file whose bindings list the graph, in id order. */
  contracts: ContractContext[];
  issues: RecordIssue[];
}

/**
 * The graph's run context. Once a full check is back, a graph no contract binds gets an info
 * issue, since it can't run until one does (#223).
 */
export function graphRunContext(cur: RunContexts, graphId: string): GraphRunContext {
  const ref: DefinitionRef = { kind: "graphs", id: graphId };
  const contracts = [...cur.byId.values()].filter((c) => !c.missing && mentions(c, ref)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const issues = issuesOn(cur, ref);
  if (cur.checked && contracts.length === 0) {
    issues.push({
      kind: "graphs",
      id: graphId,
      contract: "",
      code: "NOT_BOUND",
      severity: "info",
      message: "No contract binds this graph, so it can't run. Add it to a contract's Graphs.",
      path: "",
    });
  }
  return { contracts, issues };
}

/**
 * Where on its record an issue is, for a line under the form or the panel: the field, the item
 * of a list counted from 1, a binding entry by its section, or "" for the record as a whole.
 */
export function issuePlace(issue: RecordIssue): string {
  const parts = issue.path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.length === 0) return "";
  const item = (p: string | undefined) => (p !== undefined && /^\d+$/.test(p) ? ` item ${Number(p) + 1}` : "");
  if (parts[0] === "bindings" && (parts[1] === "graphs" || parts[1] === "grants")) {
    return `${parts[1] === "graphs" ? "Graphs" : "Grants"}${item(parts[2])}`;
  }
  return `${parts[0]}${item(parts[1])}`;
}
