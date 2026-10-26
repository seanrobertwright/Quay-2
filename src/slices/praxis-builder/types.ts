// The shapes the `praxis_*` backend commands return (src-tauri/src/slices/praxis/models.rs).

/** A record kind, named by its folder under `.praxis/`. */
export type PraxisKind = "graphs" | "contracts" | "grants" | "triggers";

/** Why a definition file can't be opened. `line` and `column` are set for invalid JSON. */
export interface FileProblem {
  message: string;
  line?: number;
  column?: number;
}

export interface DefinitionEntry {
  id: string;
  problem?: FileProblem;
}

/** One kind's definitions in id order; `truncated` when the folder held more than the cap. */
export interface DefinitionList {
  entries: DefinitionEntry[];
  truncated: boolean;
}

/** A definition as read from disk: either `content` or `problem` is set. */
export interface DefinitionFile {
  id: string;
  kind: PraxisKind;
  content?: Record<string, unknown>;
  problem?: FileProblem;
  /** A graph's `.praxis/layout/<id>.json`, when it exists and parses. */
  layout?: Record<string, unknown>;
  layoutProblem?: FileProblem;
}

/** Names one definition, the way every backend command takes it. */
export interface DefinitionRef {
  kind: PraxisKind;
  id: string;
}

/** How serious an issue is: `error` when the SDK refuses the record, `info` otherwise. */
export type Severity = "error" | "info";

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
  omitted: { errors: number; info: number };
}
