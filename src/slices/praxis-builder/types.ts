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
