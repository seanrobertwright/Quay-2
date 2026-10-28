// The contract form's rules (#223, #231): a new contract's record, the checks its integer,
// duration and time fields make as the user types, and the binding record that lists the
// graphs and grants run under it (`.praxis/bindings/<contract-id>.json`). The backend
// validates the whole contract with the SDK; these checks only refuse what can't be stored.
import type { Step } from "./history.ts";
import { idProblem } from "./lifecycle.ts";
import { isObject, type Json, type JsonObject } from "./model.ts";
import type { PraxisKind } from "./types.ts";

/** The SDK's canonical integer: digits with no leading zero, at most 100 of them. */
const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/;
export const MAX_INTEGER_DIGITS = 100;

/**
 * Why `text` can't be stored as an integer field of at least `min`, or null when it can.
 * Empty, negative, fractional and non-numeric text are refused, and so are leading zeros,
 * which the SDK's pattern doesn't allow.
 */
export function integerProblem(text: string, min = 0n): string | null {
  const t = text.trim();
  if (t === "") return "Enter a whole number.";
  if (/^-\s*\d/.test(t)) return "This can't be negative.";
  if (!/^\d+$/.test(t)) return "Enter a whole number in digits, such as 3.";
  if (!CANONICAL_INTEGER.test(t)) return "Write the number without leading zeros.";
  if (t.length > MAX_INTEGER_DIGITS) return `Use at most ${MAX_INTEGER_DIGITS} digits.`;
  if (BigInt(t) < min) return `This must be at least ${min}.`;
  return null;
}

/** A duration's units, largest first, in milliseconds each. */
export const DURATION_UNITS = [
  { unit: "d", label: "days", ms: 86_400_000n },
  { unit: "h", label: "hours", ms: 3_600_000n },
  { unit: "min", label: "minutes", ms: 60_000n },
  { unit: "s", label: "seconds", ms: 1000n },
  { unit: "ms", label: "milliseconds", ms: 1n },
] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number]["unit"];

const unitMs = (unit: DurationUnit) => DURATION_UNITS.find((u) => u.unit === unit)!.ms;

/** A stored millisecond count as an amount of the largest unit that divides it, or null when it isn't a canonical integer. */
export function durationParts(ms: string): { amount: string; unit: DurationUnit } | null {
  if (!CANONICAL_INTEGER.test(ms) || ms.length > MAX_INTEGER_DIGITS) return null;
  const n = BigInt(ms);
  if (n === 0n) return { amount: "0", unit: "min" };
  const { unit, ms: size } = DURATION_UNITS.find((u) => n % u.ms === 0n)!;
  return { amount: String(n / size), unit };
}

/** The millisecond count an amount of `unit` stores, or why it can't be stored. */
export function durationMs(amount: string, unit: DurationUnit): { ok: true; ms: string } | { ok: false; problem: string } {
  const problem = integerProblem(amount);
  if (problem) return { ok: false, problem };
  const ms = String(BigInt(amount.trim()) * unitMs(unit));
  if (ms.length > MAX_INTEGER_DIGITS) return { ok: false, problem: "This is longer than Praxis can store." };
  return { ok: true, ms };
}

/** A stored epoch-millisecond time as a number the date helper can show, or null when it isn't one. */
export function timeMs(stored: Json | undefined): number | null {
  if (typeof stored !== "string" || !CANONICAL_INTEGER.test(stored)) return null;
  const n = Number(stored);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * A new contract's record (#223): `missionId` is its id, it runs graphs, needs approval, and
 * its counts start at their smallest legal value. The deadline is left empty, so it is flagged
 * until set, and the criteria are empty, since no criterion can be guessed.
 */
export function newContractContent(id: string): JsonObject {
  return {
    id,
    missionId: id,
    aiwsEdition: "0.4",
    profile: "finite-v1",
    budget: "0",
    deadline: "",
    criteria: [],
    actions: [],
    resources: [],
    requiresApproval: true,
    maxAttempts: "1",
    maxAuthorizationAgeMs: "0",
    features: ["graphs"],
  };
}

/** The values the SDK allows in `features`. */
export const CONTRACT_FEATURES = ["graphs", "triggers"] as const;

/** A contract's binding record: the graphs and grants that run under it, in the order listed. */
export interface Bindings {
  graphs: readonly string[];
  grants: readonly string[];
}

export type BindingList = keyof Bindings;

export const EMPTY_BINDINGS: Bindings = { graphs: [], grants: [] };

/** The binding list that holds definitions of `kind`, if any. */
export function bindingListFor(kind: PraxisKind): BindingList | null {
  return kind === "graphs" || kind === "grants" ? kind : null;
}

/** A bindings file's lists as read from disk. Entries that aren't strings, and repeats, are dropped. */
export function parseBindings(value: unknown): Bindings {
  if (!isObject(value)) return EMPTY_BINDINGS;
  const list = (v: Json | undefined) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);
  return { graphs: list(value.graphs), grants: list(value.grants) };
}

/** The bindings with the `kind` definition `old` renamed to `next`, or the same object when none is bound. */
export function renameInBindings(bindings: Bindings, kind: PraxisKind, old: string, next: string): Bindings {
  const list = bindingListFor(kind);
  if (!list || !bindings[list].includes(old)) return bindings;
  return { ...bindings, [list]: bindings[list].map((id) => (id === old ? next : id)) };
}

/**
 * Why `id` can't be added to a binding list holding `bound`, or null when it can. It may
 * name a definition that doesn't exist, which the form flags, but only a filename-safe id
 * could ever name one.
 */
export function bindingIdProblem(id: string, bound: readonly string[]): string | null {
  return idProblem(id) ?? (bound.includes(id) ? `'${id}' is already listed.` : null);
}

/** One change to a contract draft. `live` marks a field being typed, which merges into the step before it. */
export type ContractEdit =
  | { type: "set-field"; key: string; value: Json; live?: boolean }
  | { type: "add-binding"; list: BindingList; id: string }
  | { type: "remove-binding"; list: BindingList; id: string };

/** The content and bindings after `edit`, or the same objects when it changes nothing. */
export function applyContractEdit(
  content: JsonObject,
  bindings: Bindings,
  edit: ContractEdit
): { content: JsonObject; bindings: Bindings } {
  switch (edit.type) {
    case "set-field":
      return JSON.stringify(content[edit.key]) === JSON.stringify(edit.value)
        ? { content, bindings }
        : { content: { ...content, [edit.key]: edit.value }, bindings };
    case "add-binding":
      return bindings[edit.list].includes(edit.id)
        ? { content, bindings }
        : { content, bindings: { ...bindings, [edit.list]: [...bindings[edit.list], edit.id] } };
    case "remove-binding":
      return bindings[edit.list].includes(edit.id)
        ? { content, bindings: { ...bindings, [edit.list]: bindings[edit.list].filter((id) => id !== edit.id) } }
        : { content, bindings };
  }
}

const SINGULAR: Record<BindingList, string> = { graphs: "graph", grants: "grant" };

/** The undo step for a contract edit. Typing in one field merges until its blur or Enter. */
export function contractStepFor(edit: ContractEdit): Step {
  switch (edit.type) {
    case "set-field": {
      const label = `Set ${edit.key}`;
      return edit.live ? { label, merge: { key: `contract|${edit.key}` } } : { label };
    }
    case "add-binding":
      return { label: `Bind ${SINGULAR[edit.list]} ${edit.id}` };
    case "remove-binding":
      return { label: `Unbind ${SINGULAR[edit.list]} ${edit.id}` };
  }
}
