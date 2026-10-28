// The grant form's rules (#223, #231): a new grant's record, its edits, the parent picker's
// check, and the inline limit checks against the parent grant and the contracts that bind
// the grant. The backend checks the grant with the SDK's `reduce` on a scratch mission; these
// checks show the same limit rules as the user types.
import type { Step } from "./history.ts";
import { idProblem } from "./lifecycle.ts";
import type { Json, JsonObject } from "./model.ts";
import type { ChainLink, Diagnostic, GrantCheck } from "./types.ts";

/**
 * A new grant's record (#223): a root grant of the finite-v1 profile, which Praxis requires,
 * with its counts at their smallest legal value. The subject and both times are left empty,
 * so they are flagged until set, since none can be guessed.
 */
export function newGrantContent(id: string): JsonObject {
  return {
    id,
    subject: "",
    profile: "finite-v1",
    actions: [],
    resources: [],
    notBefore: "",
    expiresAt: "",
    limit: "0",
    canDelegate: false,
    depth: "0",
  };
}

/**
 * One change to a grant draft. `value` undefined removes the field, as clearing `parentId`
 * makes the grant a root. `live` marks a field being typed, which merges into the step before it.
 */
export type GrantEdit = { type: "set-field"; key: string; value: Json | undefined; live?: boolean };

/** The content after `edit`, or the same object when it changes nothing. */
export function applyGrantEdit(content: JsonObject, edit: GrantEdit): JsonObject {
  if (edit.value === undefined) {
    if (!(edit.key in content)) return content;
    const { [edit.key]: _removed, ...rest } = content;
    return rest;
  }
  if (JSON.stringify(content[edit.key]) === JSON.stringify(edit.value)) return content;
  return { ...content, [edit.key]: edit.value };
}

/** The undo step for a grant edit. Typing in one field merges until its blur or Enter. */
export function grantStepFor(edit: GrantEdit): Step {
  const label = `${edit.value === undefined ? "Clear" : "Set"} ${edit.key}`;
  return edit.live ? { label, merge: { key: `grant|${edit.key}` } } : { label };
}

/**
 * Why `id` can't be the parent of the grant `self`, or null when it can. It may name a grant
 * that doesn't exist, which the form flags, but only a filename-safe id could ever name one.
 */
export function parentIdProblem(id: string, self: string): string | null {
  return idProblem(id) ?? (id === self ? "A grant can't be its own parent." : null);
}

const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const isDecimal = (v: Json | undefined): v is string => typeof v === "string" && CANONICAL_INTEGER.test(v);

/** -1, 0 or 1 as canonical decimal `a` is less than, equal to or more than `b`. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

const limitIssue = (message: string): Diagnostic => ({ code: "LIMIT", severity: "error", message, path: "/limit" });

/**
 * The inline checks on a grant's `limit` (#231): at most the parent grant's limit, and at
 * most the budget of every contract whose bindings list the grant. A value that isn't a
 * canonical whole number isn't compared, since the SDK's own issues cover it. The parent's
 * limit counts only when the saved chain ends at `parentId`.
 */
export function limitIssues(limit: Json | undefined, parentId: Json | undefined, check: GrantCheck): Diagnostic[] {
  if (!isDecimal(limit)) return [];
  const issues: Diagnostic[] = [];
  const parent = check.chain[check.chain.length - 1];
  if (parent && parent.id === parentId && isDecimal(parent.limit) && compareDecimal(limit, parent.limit) > 0) {
    issues.push(limitIssue(`This is more than parent grant ${parent.id}'s limit of ${parent.limit}.`));
  }
  for (const c of check.contracts) {
    if (isDecimal(c.budget) && compareDecimal(limit, c.budget) > 0) {
      issues.push(limitIssue(`This is more than contract ${c.id}'s budget of ${c.budget}.`));
    }
  }
  return issues;
}

/** A link in the chain the form shows; `self` marks the grant being edited. */
export interface ShownLink extends ChainLink {
  self?: boolean;
}

/**
 * The delegation chain from the root grant down to the grant `self` (#231), each with its
 * limit. When the saved chain stopped at a grant that is missing or can't be read, `broken`
 * names it, above the rest. A chain that doesn't end at `parentId` is from before the parent
 * changed, so only the grant itself shows until it is read again.
 */
export function delegationChain(
  self: string,
  limit: Json | undefined,
  parentId: Json | undefined,
  check: GrantCheck
): { links: ShownLink[]; broken?: GrantCheck["chainBreak"] } {
  const own: ShownLink = { id: self, limit: typeof limit === "string" ? limit : undefined, self: true };
  const current = typeof parentId === "string" && check.chain[check.chain.length - 1]?.id === parentId;
  const brokenAtParent = typeof parentId === "string" && check.chain.length === 0 && check.chainBreak?.id === parentId;
  if (!current && !brokenAtParent) return { links: [own] };
  const links = [...check.chain, own];
  return check.chainBreak ? { broken: check.chainBreak, links } : { links };
}
