// What Topos offers on a ref badge and a commit row (#367, #393, #394): the context menus' items,
// what a double-click or Enter on a badge checks out, and the graph's keys for them.

import { isSamePath } from "../../../utils/paths.ts";
import type { Operation } from "./composer.ts";
import { errorMessage, parseGitError } from "./gitVersion.ts";
import { folderName, type Badge, type GitRefs, type WorktreeHead } from "./graphRefs.ts";
import { shortOid } from "./graphStore.ts";
import { OPERATION_NOUNS } from "./operation.ts";

/** `CheckoutTarget` from `src-tauri/src/slices/git/checkout.rs`. */
export type CheckoutTarget =
  | { kind: "branch"; name: string }
  | { kind: "remote"; name: string }
  | { kind: "detached"; at: string };

/** What a menu item, a key or a double-click asks for. */
export type RefAction =
  | { kind: "checkout"; target: CheckoutTarget }
  | { kind: "showWorktree"; path: string }
  | { kind: "createBranch"; at: string }
  | { kind: "createTag"; at: string }
  | { kind: "renameBranch"; name: string }
  | { kind: "setUpstream"; name: string }
  | { kind: "deleteBranch"; name: string }
  | { kind: "deleteTag"; name: string }
  | { kind: "copySha"; oid: string };

/** A context menu item. A disabled one has no action and says why. */
export type MenuItem =
  | { label: string; action: RefAction; disabledReason?: undefined }
  | { label: string; action: null; disabledReason: string };

/** What the menus need to know beyond the badge. */
export interface RefContext {
  /** The selected worktree, the one a checkout switches. */
  selectedPath: string | null;
  worktrees: readonly WorktreeHead[];
  /** Why no checkout can run now, such as an operation under way, or null when one can. */
  busy: string | null;
}

/** The label of the item, and the toast button, that retargets the Rail to another worktree. */
export const SHOW_WORKTREE = "Show that worktree";

/** Where a local branch is checked out: nowhere, in the selected worktree, or in another one. */
type LocalBranchAt = { at: "free" } | { at: "here" } | { at: "elsewhere"; holder: string };

function localBranchAt(name: string, ctx: RefContext): LocalBranchAt {
  const holder = ctx.worktrees.find((w) => w.branch === name);
  if (holder === undefined) return { at: "free" };
  return isSamePath(holder.path, ctx.selectedPath) ? { at: "here" } : { at: "elsewhere", holder: holder.path };
}

const heldBy = (holder: string) => `Checked out in worktree ${folderName(holder)}`;

function checkoutItem(label: string, target: CheckoutTarget, ctx: RefContext): MenuItem {
  return ctx.busy === null ? { label, action: { kind: "checkout", target } } : { label, action: null, disabledReason: ctx.busy };
}

const createBranchItem = (at: string): MenuItem => ({ label: "Create branch here…", action: { kind: "createBranch", at } });

/**
 * Rename, Set upstream and Delete for the local branch `name`. A branch checked out in any
 * worktree, `here` the selected one, is never deleted (#367).
 */
function branchWriteItems(name: string, checkedOut: { here: true } | { here: false; holder: string } | null): MenuItem[] {
  const del: MenuItem =
    checkedOut === null
      ? { label: "Delete…", action: { kind: "deleteBranch", name } }
      : { label: "Delete…", action: null, disabledReason: checkedOut.here ? "Checked out here" : heldBy(checkedOut.holder) };
  return [
    { label: "Rename…", action: { kind: "renameBranch", name } },
    { label: "Set upstream…", action: { kind: "setUpstream", name } },
    del,
  ];
}

/** The context menu of `badge`, on the commit `oid`. The selected worktree's HEAD has none. */
export function badgeMenu(badge: Badge, oid: string, ctx: RefContext): MenuItem[] {
  switch (badge.kind) {
    case "head":
      return badge.current ? [] : [{ label: SHOW_WORKTREE, action: { kind: "showWorktree", path: badge.path } }];
    case "local": {
      const where = localBranchAt(badge.name, ctx);
      switch (where.at) {
        case "free":
          return [checkoutItem("Checkout", { kind: "branch", name: badge.name }, ctx), createBranchItem(oid), ...branchWriteItems(badge.name, null)];
        case "here":
          return [
            { label: "Checkout", action: null, disabledReason: "Already checked out here" },
            createBranchItem(oid),
            ...branchWriteItems(badge.name, { here: true }),
          ];
        case "elsewhere":
          return [
            { label: "Checkout", action: null, disabledReason: heldBy(where.holder) },
            { label: SHOW_WORKTREE, action: { kind: "showWorktree", path: where.holder } },
            createBranchItem(oid),
            ...branchWriteItems(badge.name, { here: false, holder: where.holder }),
          ];
      }
    }
    case "remote":
      return [checkoutItem("Checkout", { kind: "remote", name: badge.name }, ctx), createBranchItem(oid)];
    case "tag":
      return [
        checkoutItem("Checkout detached", { kind: "detached", at: oid }, ctx),
        createBranchItem(oid),
        { label: "Delete tag…", action: { kind: "deleteTag", name: badge.name } },
      ];
  }
}

/** The commit row's context menu. */
export function commitMenu(oid: string, ctx: RefContext): MenuItem[] {
  return [
    createBranchItem(oid),
    { label: "Create tag here…", action: { kind: "createTag", at: oid } },
    checkoutItem("Checkout detached", { kind: "detached", at: oid }, ctx),
    { label: "Copy SHA", action: { kind: "copySha", oid } },
  ];
}

/** What a double-click or Enter on a badge does: an action, why it can't, or nothing. */
export type PrimaryAction =
  | { kind: "run"; action: RefAction }
  | { kind: "blocked"; reason: string; worktree: string | null }
  | null;

/**
 * A badge's double-click and Enter (#367): a local branch checks out, a remote branch checks out
 * the branch tracking it (or one made for it), and another worktree's HEAD shows that worktree.
 * A tag, and a branch already checked out here, do nothing.
 */
export function primaryAction(badge: Badge, ctx: RefContext): PrimaryAction {
  const checkout = (target: CheckoutTarget): PrimaryAction =>
    ctx.busy === null ? { kind: "run", action: { kind: "checkout", target } } : { kind: "blocked", reason: ctx.busy, worktree: null };
  switch (badge.kind) {
    case "tag":
      return null;
    case "head":
      return badge.current ? null : { kind: "run", action: { kind: "showWorktree", path: badge.path } };
    case "remote":
      return checkout({ kind: "remote", name: badge.name });
    case "local": {
      const where = localBranchAt(badge.name, ctx);
      switch (where.at) {
        case "free":
          return checkout({ kind: "branch", name: badge.name });
        case "here":
          return null;
        case "elsewhere":
          return { kind: "blocked", reason: heldBy(where.holder), worktree: where.holder };
      }
    }
  }
}

/** The branch the worktree at `path` has checked out in `refs`, or null when detached. */
export function branchAt(refs: GitRefs, path: string): string | null {
  return refs.worktrees.find((w) => isSamePath(w.path, path))?.branch ?? null;
}

/** An option of the "Topos: Checkout…" dialog and the checkout it runs. */
export interface CheckoutChoice {
  value: string;
  label: string;
  target: Extract<CheckoutTarget, { name: string }>;
}

/**
 * What "Topos: Checkout…" offers the worktree at `path`: every local branch but the one checked
 * out there, and every remote-tracking branch, in `refs` order.
 */
export function checkoutChoices(refs: GitRefs, path: string): CheckoutChoice[] {
  const here = branchAt(refs, path);
  const choices: CheckoutChoice[] = [];
  for (const r of refs.refs) {
    if (r.kind === "local" && r.name !== here) choices.push({ value: String(choices.length), label: r.name, target: { kind: "branch", name: r.name } });
    if (r.kind === "remote") choices.push({ value: String(choices.length), label: `${r.name} (remote)`, target: { kind: "remote", name: r.name } });
  }
  return choices;
}

/**
 * Why New branch can't create `name` now, or null when it can: it needs a name, and checking the
 * branch out waits for `busy` (see `checkoutBlockedBy`) as every other checkout does.
 */
export function newBranchRefusal(name: string, checkout: boolean, busy: string | null): string | null {
  if (name.trim() === "") return "Name the branch";
  return checkout ? busy : null;
}

/** The graph keys of #367, which act on the selected row or the badge the cursor is on. */
export type GraphKey = "createBranch" | "createTag" | "checkout" | "menu" | "nextBadge" | "previousBadge";

/** The graph key `e` is, or null. No chord with Ctrl, Alt or Meta, and nothing in a text field. */
export function graphKey(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  inTextField: boolean
): GraphKey | null {
  if (inTextField || e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) return "menu";
  switch (e.key) {
    case "b":
    case "B":
      return "createBranch";
    case "t":
    case "T":
      return "createTag";
    case "Enter":
      return "checkout";
    case "ArrowRight":
      return "nextBadge";
    case "ArrowLeft":
      return "previousBadge";
    default:
      return null;
  }
}

/**
 * Where the badge cursor goes from `index` (null for the row itself) on a row with `count`
 * badges: right onto the next badge, stopping on the last, and left back toward the row.
 */
export function nextBadge(index: number | null, count: number, key: "nextBadge" | "previousBadge"): number | null {
  if (count === 0) return null;
  const at = index === null ? null : Math.min(index, count - 1);
  if (key === "nextBadge") return at === null ? 0 : Math.min(at + 1, count - 1);
  return at === null || at === 0 ? null : at - 1;
}

/** How a refused ref operation reads in its toast. */
export interface RefFailure {
  /** Plain text; `what` and every path or name in it are untrusted. */
  text: string;
  /** The files a checkout would overwrite, the first few and a count of the rest. */
  lines: string[];
  /** The worktree holding the branch, for "Show that worktree", or null. */
  worktree: string | null;
  /** Whether the staging inspector is where to fix it. */
  openInspector: boolean;
}

/** The files a toast lists before counting the rest. */
const LISTED_PATHS = 5;

/** The toast for `e`, a refused ref operation on `what`. */
export function refFailure(what: string, e: unknown): RefFailure {
  const error = parseGitError(e);
  const plain = (text: string): RefFailure => ({ text, lines: [], worktree: null, openInspector: false });
  switch (error?.kind) {
    case "checkoutWouldOverwrite": {
      const { paths } = error;
      const lines = paths.length > LISTED_PATHS + 1 ? [...paths.slice(0, LISTED_PATHS), `and ${paths.length - LISTED_PATHS} more`] : paths;
      const files = paths.length === 1 ? "1 file" : `${paths.length} files`;
      return {
        text: `Checking out ${what} would overwrite changes to ${files}. Commit, stash or discard them in the inspector first.`,
        lines,
        worktree: null,
        openInspector: true,
      };
    }
    case "branchInOtherWorktree":
      return { ...plain(`${what} is checked out in worktree ${folderName(error.worktree)}`), worktree: error.worktree };
    case "invalidRefName":
      return plain(`${error.name} isn't a valid name or commit`);
    case "refExists":
      return plain(`${error.name} already exists`);
    case "refLocked":
      return plain(`Another git process holds a lock on ${what}; try again once it's done`);
    case "stagingBusy":
      return plain("Another git operation is running in this worktree; try again once it's done");
    default:
      return plain(errorMessage(e));
  }
}

/** What a toast says after checking out `target`, landing on `branch` (null when detached). */
export function checkoutDone(target: CheckoutTarget, branch: string | null): string {
  switch (target.kind) {
    case "branch":
      return `Checked out ${target.name}`;
    case "remote":
      return `Checked out ${branch ?? target.name}, tracking ${target.name}`;
    case "detached":
      return `Checked out ${shortOid(target.at)}, detached`;
  }
}

/**
 * Why a checkout can't run in the selected worktree now, or null when it can: an operation under
 * way there (#352), whose kind is `operation` (null before it is read), or another git operation
 * running in its staging slot.
 */
export function checkoutBlockedBy(operation: Operation | null, slotBusy: boolean): string | null {
  if (operation !== null && operation !== "none") return `Finish or abort the ${OPERATION_NOUNS[operation]} first`;
  if (slotBusy) return "Wait for the git operation running in this worktree";
  return null;
}
