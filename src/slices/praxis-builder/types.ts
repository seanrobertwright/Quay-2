// The shapes the `praxis_*` backend commands return (src-tauri/src/slices/praxis/models.rs).

/** A record kind, named by its folder under `.praxis/`. */
export type PraxisKind = "graphs" | "contracts" | "grants" | "triggers" | "graph-bindings" | "templates";

/** Why a definition file can't be opened. `line` and `column` are set for invalid JSON. */
export interface FileProblem {
  message: string;
  line?: number;
  column?: number;
}

export interface DefinitionEntry {
  id: string;
  problem?: FileProblem;
  /** Set when the file parses but its `id` isn't its name: `found` is the id inside, if it has a string one. */
  idMismatch?: { found?: string };
  /** For a workflow template whose name the Praxis host refuses (#447), the host's name rule. Renaming fixes it. */
  nameProblem?: string;
  /** A graph binding's `graphId`, when it is a string, so the list nests it under its graph. */
  graphId?: string;
  /** A graph binding's `costUnit`, when it is a string that isn't empty (#231, #274). */
  costUnit?: string;
}

/** One kind's definitions in id order; `truncated` when the folder held more than the cap. */
export interface DefinitionList {
  entries: DefinitionEntry[];
  truncated: boolean;
}

/**
 * A definition as read from disk. When the file exists, either `content` or `problem` is
 * set and `contentHash` is the hash of the bytes read; when it doesn't, `missing` is true.
 */
export interface DefinitionFile {
  id: string;
  kind: PraxisKind;
  missing: boolean;
  contentHash?: string;
  content?: Record<string, unknown>;
  problem?: FileProblem;
  /** A graph's `.praxis/layout/<id>.json`, when it exists and parses. */
  layout?: Record<string, unknown>;
  layoutProblem?: FileProblem;
  /** A contract's `.praxis/bindings/<id>.json`, when it exists and parses. */
  bindings?: Record<string, unknown>;
  bindingsProblem?: FileProblem;
  /** The hash of the bindings file's bytes, when it exists and can be read. */
  bindingsHash?: string;
}

/** Names one definition, the way every backend command takes it. */
export interface DefinitionRef {
  kind: PraxisKind;
  id: string;
}

/** A graph's layout as `praxis_save` takes it: positions in node order, and the viewport. */
export interface LayoutInput {
  nodes: { id: string; x: number; y: number }[];
  viewport: { x: number; y: number; zoom: number } | null;
}

/** A contract's binding record as `praxis_save` takes it. */
export interface BindingsInput {
  graphs: readonly string[];
  grants: readonly string[];
}

/**
 * What `praxis_save` did: wrote the record (as returned, with the hash of the written
 * bytes), or found the file, or a contract's bindings file, changed or deleted since the
 * draft loaded it. `bindingsHash` is the hash of the bindings file written, when it was.
 */
export type SaveOutcome =
  | {
      status: "saved";
      content: Record<string, unknown>;
      contentHash: string;
      layoutError?: string;
      bindingsHash?: string;
      bindingsError?: string;
    }
  | { status: "conflict"; reason: "changed" | "deleted" };

/** `praxis_contract_triggers`: the triggers whose `contractId` names a contract. */
export interface ContractTriggers {
  ids: string[];
  /** Trigger files that couldn't be read or weren't searched. */
  unchecked: string[];
}

/** A saved grant in a delegation chain, with its `limit` when that is a string. */
export interface ChainLink {
  id: string;
  limit?: string;
}

/** A contract whose bindings list a grant, and how the grant fares on its scratch mission. */
export interface BoundContract {
  id: string;
  /** The contract's `budget`, when it is a string. */
  budget?: string;
  /** Why the contract couldn't be read, so the grant wasn't checked against it. */
  problem?: string;
  /** `reduce`'s verdict on the grant, with each issue located on the grant's fields. */
  validation?: Validation;
}

/** `praxis_check_grant`: a grant checked against the saved records around it (#223, #231). */
export interface GrantCheck {
  /** The saved ancestors from the root grant down to the parent; empty for a root grant. */
  chain: ChainLink[];
  /** The grant above `chain` that stopped the walk: missing, unreadable, or a cycle. */
  chainBreak?: { id: string; message: string };
  /** The contracts whose bindings list the grant, in id order. */
  contracts: BoundContract[];
  /** Bindings files that couldn't be read or weren't searched. */
  unchecked: string[];
}

/** How a definition file differs from the last commit. */
export type ChangeStatus = "modified" | "added" | "deleted";

/** `praxis_changes`: the contracts, grants, templates and graph bindings changed since the last commit, empty outside git. */
export interface ChangedFiles {
  files: { kind: PraxisKind; id: string; status: ChangeStatus }[];
}

/** `praxis_diff`: one file's unified diff against the last commit; `status` is null when unchanged. */
export interface FileDiff {
  path: string;
  status: ChangeStatus | null;
  diff: string;
  /** The diff was cut at the backend's cap. */
  truncated: boolean;
}

/**
 * How serious an issue is: `error` when the SDK refuses the record, `warning` when the record
 * saves but Praxis would refuse a run with it as it stands (#274), `info` otherwise.
 */
export type Severity = "error" | "warning" | "info";

/** One issue in a definition, from `praxis_validate`. */
export interface Diagnostic {
  /** The SDK's error code, or a Quay code such as `REVISION_MISMATCH`. */
  code: string;
  severity: Severity;
  message: string;
  /** A JSON Pointer to the value at fault, `""` for the record as a whole. */
  path: string;
  /** The graph node the issue is on, when it is on one. */
  nodeId?: string;
  /** The place inside that node, dotted (`config.then`), when it isn't the whole node. */
  field?: string;
}

/** `praxis_validate`'s result. With a verdict, the first diagnostic carries its code. */
export interface Validation {
  /** The SDK's verdict: the first rule the record breaks, or null when the SDK accepts it. */
  verdict: string | null;
  /** At most the backend's cap (500) of the issues found. */
  diagnostics: Diagnostic[];
  /** The issues found beyond `diagnostics`, by severity. */
  omitted: { errors: number; warnings: number; info: number };
}

/** Where a check of a definition stands: running, failed to run, or done with its result. */
export type ValidationStatus =
  | { state: "checking" }
  | { state: "failed"; error: string }
  | { state: "done"; validation: Validation };

/** A draft's content as `praxis_rename` takes it, and returns it with references rewritten. */
export interface DraftContent {
  kind: PraxisKind;
  id: string;
  content: Record<string, unknown>;
}

/**
 * One file a rename writes: rewritten at `path`, or moved to `newPath`. `hashes` is set for
 * a file whose content it writes, a definition or a contract's bindings file, so a draft that
 * expected `previous` can expect `next`.
 */
export interface FileChange {
  path: string;
  newPath?: string;
  hashes?: { previous: string; next: string };
}

/**
 * What `praxis_rename` does, or did. A dry run fills only `changes`, `unchecked` and
 * `drafts`. A rename that stopped part-way says why in `error`, after the steps in `done`.
 */
export interface RenameOutcome {
  changes: FileChange[];
  /** Files searched for references that couldn't be read. */
  unchecked: string[];
  /** The drafts sent whose references the rename rewrites, with their content after it. */
  drafts: DraftContent[];
  done: string[];
  error?: string;
}

/**
 * What `praxis_delete` does, or did: the files that go to the trash, definition first, and
 * the files that refer to it. A delete that stopped part-way says why in `error`.
 */
export interface DeleteOutcome {
  files: string[];
  referrers: string[];
  unchecked: string[];
  done: string[];
  error?: string;
}

/**
 * One cross-record issue (#223, #269): what a contract's scratch mission refused of a record,
 * or a reference that names no record. `kind` and `id` name the record it is on, and
 * `contract` the contract whose mission found it. A binding entry that names no record is on
 * the contract, at `/bindings/<graphs|grants>/<index>`.
 */
export interface RecordIssue extends Diagnostic {
  kind: PraxisKind;
  id: string;
  contract: string;
}

/** One contract checked across records, with what it binds and what its mission refused. */
export interface ContractContext {
  id: string;
  /** No contract file has this id, though a trigger or a bindings file names it. */
  missing: boolean;
  /** Why the contract file couldn't be read, so no mission was opened. */
  problem?: string;
  graphs: string[];
  grants: string[];
  /** The saved triggers whose `contractId` names this contract. */
  triggers: string[];
  issues: RecordIssue[];
  /** How many more issues were found than `issues` holds. */
  omitted: number;
}

/** `praxis_check_context`: some contracts checked across records, in id order. */
export interface ContextCheck {
  contracts: ContractContext[];
  /** Bindings and trigger files that couldn't be read or weren't searched. */
  unchecked: string[];
}

/**
 * `praxis_binding_suggestions`: the ids used across the project's saved graph bindings, with the
 * agents of its saved workflow templates among the agent ids (#247).
 */
export type BindingSuggestions = Record<"agentId" | "protocolBindingId" | "action" | "resource", string[]>;

/** One contract criterion at a VERIFICATION node, and the Validation ancestors whose entries list it. */
export interface CriterionCoverage {
  criterion: string;
  /** The ancestors' ids, in graph order; empty when the criterion is uncovered there. */
  coveredBy: string[];
}

/** A VERIFICATION node's coverage of one contract's criteria, in the contract's order. */
export interface VerificationCoverage {
  nodeId: string;
  criteria: CriterionCoverage[];
}

/** One contract whose bindings list a binding's graph, and the binding's attach checks under it (#274). */
export interface AttachContract {
  id: string;
  /** Why the contract couldn't be read, so nothing was checked against it. */
  problem?: string;
  /** `Contract.budget`, when it is a string. */
  budget?: string;
  /** `Contract.maxAttempts`, when it is a string. */
  maxAttempts?: string;
  coverage: VerificationCoverage[];
  /** Warnings, each named after the contract. */
  diagnostics: Diagnostic[];
  /** How many more warnings were found than `diagnostics` holds. */
  omitted: number;
}

/** `praxis_check_binding`: a binding's attach checks under each contract that lists its graph, in id order. */
export interface BindingAttach {
  contracts: AttachContract[];
  /** Files that couldn't be read or weren't searched. */
  unchecked: string[];
}

/** `praxis_graph_pin`: what a graph binding pins, read from the graph as saved on disk (#247). */
export interface GraphPin {
  /** The graph's `revision`, when it has a string one. */
  revision?: string;
  /** The SDK digest of the graph record exactly as the file holds it. */
  digest: string;
}
