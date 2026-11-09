// Check on host and Submit for a graph workflow (#444, #462): what stops a submission, how the
// host's findings in a bundle read, and the identical-bundle refusal. The gate sentences and
// answer readers it shares with a graph trigger's are in `hostSubmit.ts`. This module has no UI:
// the graph workflow form's Submit bar and its confirm dialog draw it.
//
// A submission sends the saved files only, so a bundle file with unsaved edits or local faults
// stops it. Quay doesn't copy the host's refusal list (child graphs, FUNCTION, HUMAN and
// COMPENSATION nodes, which will shrink): those come back as the host's findings from the check
// verb, which writes nothing and always runs before a submission.
import type { GraphWorkflowHostView } from "./graphHost.ts";
import {
  checkOutcome,
  hostBlocker,
  nameBlocker,
  recordLabel,
  submissionOutcome,
  unsavedBlocker,
  type FindingsReader,
  type HostCheck,
  type LocalChecks,
  type Submission,
} from "./hostSubmit.ts";
import { isObject } from "./hostReadSession.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import type { DefinitionRef, GraphWorkflowBundle } from "./types.ts";

/**
 * The records a submission of graph workflow `name` rests on: the graph workflow, then its graph,
 * graph binding and contract and each grant it carries, in the order praxis is given them. A
 * reference not picked yet is left out.
 */
export function bundleRecords(name: string, content: { contractId: string; graphId: string; graphBindingId: string }, grants: readonly string[]): DefinitionRef[] {
  const refs: DefinitionRef[] = [{ kind: "graph-workflows", id: name }];
  if (content.graphId) refs.push({ kind: "graphs", id: content.graphId });
  if (content.graphBindingId) refs.push({ kind: "graph-bindings", id: content.graphBindingId });
  if (content.contractId) refs.push({ kind: "contracts", id: content.contractId });
  for (const id of grants) refs.push({ kind: "grants", id });
  return refs;
}

/** What Submit's gates read. */
export interface SubmitGateInput {
  /** The bundle records, the graph workflow's included, whose drafts have edits their saved files lack. */
  unsaved: readonly DefinitionRef[];
  /** Where the graph workflow's local checks stand: its shape and the saved records it names. */
  local: LocalChecks;
  /** Why the backend won't build the saved bundle, in its words, when it won't. */
  bundleRefusal: string | null;
  /** The host's name rule, when the graph workflow's name breaks it. */
  nameRule: string | null;
  condition: HostCondition;
}

/** Why Submit is disabled, one sentence per gate that holds; empty when nothing stops it. */
export function submitBlockers(input: SubmitGateInput): string[] {
  const reasons: string[] = [];
  if (input.unsaved.length > 0) reasons.push(unsavedBlocker(input.unsaved));
  if (input.local === "checking") reasons.push("Checking the saved files…");
  else if (input.local === "fails") reasons.push("The graph workflow fails its local checks. Fix them first: only a bundle that passes them is submitted.");
  // The local checks name most of what makes a bundle unbuildable, so their reason stands alone.
  else if (input.bundleRefusal !== null) reasons.push(input.bundleRefusal);
  if (input.nameRule !== null) reasons.push(nameBlocker(input.nameRule));
  const host = hostBlocker(input.condition);
  if (host !== null) reasons.push(host);
  return reasons;
}

/**
 * The warnings a saved bundle gives, which never disable Submit: bundle files with changes that
 * aren't committed, or a git status Quay couldn't read.
 */
export function bundleWarnings(bundle: GraphWorkflowBundle): string[] {
  if (bundle.changesError !== undefined) {
    return [`Quay couldn't read git status, so it can't tell whether the bundle has changes that aren't committed: ${bundle.changesError}`];
  }
  const changed = bundle.files.filter((f) => f.change !== undefined);
  if (changed.length === 0) return [];
  return [`Changes not committed: ${changed.map(recordLabel).join(", ")}. They are submitted as saved.`];
}

/** One fault the host found in a bundle, in the file it names. */
export interface HostFinding {
  /** `graph`, `binding`, `contract` or `grants/<index>`, or a name Quay doesn't know yet. */
  file: string;
  /** An RFC 6901 pointer inside that file; empty for the whole record. */
  path: string;
  /** The host's code, an open enum: shown as given. */
  code: string;
  nodeId: string | null;
}

/**
 * What one `praxis graphs check` came to. A passed check gives `bundleDigest`, the host's digest
 * of the bundle, when it gave one.
 */
export type BundleCheck = HostCheck<HostFinding, { bundleDigest: string | null }>;

/** The findings a check result or a submission's refusal lists; one Quay can't read is left out. */
function findingsOf(record: Record<string, unknown>): HostFinding[] {
  if (!Array.isArray(record.findings)) return [];
  return record.findings.flatMap((f) =>
    isObject(f) && typeof f.file === "string" && typeof f.code === "string"
      ? [{ file: f.file, code: f.code, path: typeof f.path === "string" ? f.path : "", nodeId: typeof f.nodeId === "string" ? f.nodeId : null }]
      : [],
  );
}

/** A graph workflow's: each finding names its bundle file. */
const BUNDLE_FINDINGS: FindingsReader<HostFinding> = { invalid: "bundleInvalid", read: findingsOf };

/** The answer of the check verb, `praxis_host_graph_check`; null for a cancelled check. */
export const hostCheckOf = (outcome: CallOutcome): BundleCheck | null =>
  checkOutcome(outcome, BUNDLE_FINDINGS, (record) => ({ bundleDigest: typeof record.bundleDigest === "string" ? record.bundleDigest : null }));

/** The bundle file a finding names, from the saved bundle; null for a name Quay doesn't know. */
export function findingFile(finding: HostFinding, bundle: GraphWorkflowBundle | null): DefinitionRef | null {
  const file = bundle?.files.find((f) => f.file === finding.file);
  return file ? { kind: file.kind, id: file.id } : null;
}

/** Where in its file a finding is, as the list shows it: `TIME_PASSED at /deadline on node build`. */
export function findingText(finding: HostFinding): string {
  return `${finding.code}${finding.path ? ` at ${finding.path}` : ""}${finding.nodeId ? ` on node ${finding.nodeId}` : ""}`;
}

/**
 * The revision a bundle with the host's digest `digest` is identical to: the newest pending
 * candidate or current revision with that digest, as `view`'s revisions list them. Null when
 * there is none, and whenever the host gave no digest to compare, so nothing is refused then.
 */
export function identicalRevision(view: GraphWorkflowHostView, digest: string | null): number | null {
  if (digest === null) return null;
  const same = view.revisions.find((r) => r.bundleDigest === digest && (r.current || r.status === "CANDIDATE"));
  return same?.revision ?? null;
}

/** Why a submission identical to revision `revision` is refused. */
export const nothingChanged = (revision: number): string => `Nothing has changed since revision ${revision}. Change a bundle file before submitting again.`;

/** What a `praxis_host_graph_submit` outcome means for the person who confirmed it. */
export const submissionOf = (outcome: CallOutcome): Submission<HostFinding> => submissionOutcome(outcome, BUNDLE_FINDINGS);
