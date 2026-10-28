// Creating and renaming definitions (#222): the filename-safe id rule the list checks as
// the user types, the id a new definition starts with, and a new graph's record. The
// backend checks the same rule (`validate_id` in src-tauri/src/slices/praxis/store.rs)
// before it writes anything, so this copy only gives early feedback.
import type { JsonObject } from "./model.ts";

/** The longest definition id. */
export const MAX_DEFINITION_ID = 128;

const SAFE = /^[A-Za-z0-9._-]*$/;

/**
 * Why `id` isn't a filename-safe definition id, or null when it is: 1 to 128 of
 * `[A-Za-z0-9._-]`, no leading dot, and not a Windows reserved device name, with or
 * without an extension.
 */
export function idProblem(id: string): string | null {
  if (id === "") return "The id is empty.";
  if (id.length > MAX_DEFINITION_ID) return `The id is longer than ${MAX_DEFINITION_ID} characters.`;
  if (!SAFE.test(id)) return "The id may only use letters, digits, '.', '_' and '-'.";
  if (id.startsWith(".")) return "The id can't start with a dot.";
  const stem = id.split(".")[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/.test(stem)) return `'${stem}' is a reserved device name on Windows.`;
  return null;
}

/**
 * Why `id` can't name a definition among `taken`, or null when it can. Ids must differ
 * ignoring case. `self` is the definition being renamed, whose own id doesn't count, so a
 * rename may change only its case.
 */
export function definitionIdProblem(id: string, taken: Iterable<string>, self?: string): string | null {
  const problem = idProblem(id);
  if (problem) return problem;
  const lower = id.toLowerCase();
  for (const other of taken) {
    if (other !== self && other.toLowerCase() === lower) return `'${other}' is already taken.`;
  }
  return null;
}

/** `<prefix>-<n>` with the smallest `n` from 1 that no id in `taken` has, ignoring case. */
export function nextDefinitionId(prefix: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((id) => id.toLowerCase()));
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!lower.has(id.toLowerCase())) return id;
  }
}

/**
 * A new graph's record (#221): a single END node. The revision is a placeholder that the
 * first save replaces with the content digest.
 */
export function newGraphContent(id: string): JsonObject {
  return { id, revision: "unsaved", nodes: [{ id: "end-1", kind: "END", dependsOn: [], config: {} }] };
}
