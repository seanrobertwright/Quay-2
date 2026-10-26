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

/**
 * What `praxis_save` did: wrote the record (as returned, with the hash of the written
 * bytes), or found the file changed or deleted since the draft loaded it.
 */
export type SaveOutcome =
  | { status: "saved"; content: Record<string, unknown>; contentHash: string; layoutError?: string }
  | { status: "conflict"; reason: "changed" | "deleted" };
