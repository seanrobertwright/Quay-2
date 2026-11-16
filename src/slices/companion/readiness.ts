import type { MergeMethod, MergeStateStatus, PullRequestReadiness } from "../github/types.ts";
import type { PullRequestLocation } from "./usePullRequestReadiness.ts";

/** The colour family the readiness card's headline takes. */
export type ReadinessTone = "ready" | "failing" | "blocked" | "pending" | "merged" | "closed";

/**
 * The readiness card's control. An open pull request has the merge split button, enabled when
 * GitHub would take the merge. A merged or closed one has its branch button (Delete branch while
 * the head branch is there, Restore branch once it is gone, none for a fork's branch) and, after
 * a close, Reopen.
 */
export type ReadinessControl =
  | { kind: "merge"; enabled: boolean }
  | { kind: "branch"; branch: "delete" | "restore" | null; reopen: boolean };

/** The readiness card's headline, its one line of reason, and its control. */
export interface Readiness {
  tone: ReadinessTone;
  headline: string;
  reason: string;
  control: ReadinessControl;
}

/** Merge states in which GitHub takes a merge: clean, failing checks that are not required, or hooks to run. */
const MERGEABLE_STATES: ReadonlySet<MergeStateStatus> = new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS"]);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What the readiness card says about `pr`. A merged or closed pull request says so. An open one
 * names the first thing that stands in the way of merging, in this order: draft, merge conflicts,
 * failing checks, running checks, an out-of-date branch, requested changes, a required review,
 * another protection rule, and GitHub still computing mergeability; with none of them it is
 * Ready to merge.
 */
export function readiness(pr: PullRequestReadiness): Readiness {
  const head = pr.headRefName;
  const base = pr.baseRefName;
  if (pr.state === "MERGED" || pr.state === "CLOSED") {
    const merged = pr.state === "MERGED";
    const branch = pr.isCrossRepository ? null : pr.headBranchExists ? "delete" : "restore";
    return {
      tone: merged ? "merged" : "closed",
      headline: merged ? "Merged" : "Closed without merging",
      reason: merged ? `${head} was merged into ${base}.` : `${head} was not merged into ${base}.`,
      control: { kind: "branch", branch, reopen: !merged },
    };
  }
  const enabled = !pr.isDraft && MERGEABLE_STATES.has(pr.mergeStateStatus);
  const say = (tone: ReadinessTone, headline: string, reason: string): Readiness => ({
    tone,
    headline,
    reason,
    control: { kind: "merge", enabled },
  });
  const { failing, pending, skipped, passing } = pr.checks;
  const total = failing + pending + skipped + passing;
  if (pr.isDraft) return say("blocked", "Draft", "Mark it ready for review on GitHub before it can merge.");
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
    return say("blocked", "Merge conflicts", `${head} has conflicts with ${base} that must be resolved.`);
  }
  if (failing > 0) {
    return say(
      "failing",
      `${plural(failing, "check")} failing`,
      enabled ? "No failing check is required, so it can still merge." : `Fix the failing ${failing === 1 ? "check" : "checks"} before merging.`,
    );
  }
  if (pending > 0) return say("pending", "Checks running", `${pending} of ${total} checks ${pending === 1 ? "is" : "are"} still running.`);
  if (pr.mergeStateStatus === "BEHIND") return say("blocked", "Branch out of date", `Update ${head} with ${base} before merging.`);
  if (pr.mergeStateStatus === "BLOCKED") {
    if (pr.reviewDecision === "CHANGES_REQUESTED") return say("blocked", "Changes requested", "A reviewer asked for changes.");
    if (pr.reviewDecision === "REVIEW_REQUIRED") {
      return say("blocked", "Review required", "An approving review is required before merging.");
    }
    return say("blocked", "Merging is blocked", "A branch protection rule blocks this merge.");
  }
  if (!enabled) return say("pending", "Checking mergeability", "GitHub is still working out whether this can merge.");
  const checksReason =
    total === 0
      ? "No checks ran on this branch."
      : passing === 0
        ? "Every check was skipped."
        : `All ${plural(passing, "check")} passed${skipped > 0 ? `, ${skipped} skipped` : ""}.`;
  return say("ready", "Ready to merge", checksReason);
}

/** A readiness card cell, which opens its detail under the card. */
export type ReadinessCellId = "checks" | "comments" | "files" | "commits";

/**
 * The cell the pull request view opens on arrival, on what needs the operator: Checks when a
 * check is failing, else Comments when a review thread is unresolved, else none, whatever the
 * pull request's state.
 */
export function arrivalCell(pr: Pick<PullRequestReadiness, "checks" | "comments">): ReadinessCellId | null {
  if (pr.checks.failing > 0) return "checks";
  if (pr.comments.unresolved > 0) return "comments";
  return null;
}

/** The colour a bar segment takes. */
export type SegmentTone = "failing" | "pending" | "skipped" | "passing" | "neutral";

/** One part of a cell's segmented bar, as wide as its `value` is a share of the bar's total. */
export interface BarSegment {
  tone: SegmentTone;
  /** What the segment stands for, for its tooltip and accessible name. */
  label: string;
  value: number;
}

/** One of the readiness card's four cells: its name, its count and its segmented bar. */
export interface ReadinessCell {
  id: ReadinessCellId;
  label: string;
  count: number;
  /** The bar's segments, empty ones left out. */
  segments: BarSegment[];
}

const segments = (parts: BarSegment[]) => parts.filter((part) => part.value > 0);

/**
 * The readiness card's cells, in the order the card shows them. Checks splits by outcome, Comments
 * into unresolved review threads and the rest, Files into lines added and deleted, and Commits is
 * one segment.
 */
export function readinessCells(pr: PullRequestReadiness): ReadinessCell[] {
  const { failing, pending, skipped, passing } = pr.checks;
  const { total, unresolved } = pr.comments;
  return [
    {
      id: "checks",
      label: "Checks",
      count: failing + pending + skipped + passing,
      segments: segments([
        { tone: "failing", label: `${failing} failing`, value: failing },
        { tone: "pending", label: `${pending} running`, value: pending },
        { tone: "skipped", label: `${skipped} skipped`, value: skipped },
        { tone: "passing", label: `${passing} passed`, value: passing },
      ]),
    },
    {
      id: "comments",
      label: "Comments",
      count: total,
      segments: segments([
        { tone: "pending", label: `${unresolved} unresolved`, value: unresolved },
        { tone: "neutral", label: plural(total - unresolved, "other"), value: total - unresolved },
      ]),
    },
    {
      id: "files",
      label: "Files",
      count: pr.changedFiles,
      segments: segments([
        { tone: "passing", label: `+${pr.additions}`, value: pr.additions },
        { tone: "failing", label: `−${pr.deletions}`, value: pr.deletions },
      ]),
    },
    {
      id: "commits",
      label: "Commits",
      count: pr.commits,
      segments: segments([{ tone: "neutral", label: plural(pr.commits, "commit"), value: pr.commits }]),
    },
  ];
}

/** The merge split button's methods, in the order its menu lists them, each with its button text. */
export const MERGE_METHODS: readonly { method: MergeMethod; label: string }[] = [
  { method: "merge", label: "Create a merge commit" },
  { method: "squash", label: "Squash and merge" },
  { method: "rebase", label: "Rebase and merge" },
];

/** The merge split button's text for `method`. */
export const mergeMethodLabel = (method: MergeMethod): string =>
  MERGE_METHODS.find((m) => m.method === method)?.label ?? "Merge";

/** The method the merge split button starts on. */
export const DEFAULT_MERGE_METHOD: MergeMethod = "squash";

/**
 * The commit title and message the confirm step starts with, as GitHub fills them: a squash
 * commit is the pull request's title and number over its description, and a merge commit names
 * the pull request and its branch over its title. Rebase writes no new commit, so it has none.
 */
export function commitMessageDefaults(
  pr: Pick<PullRequestReadiness, "number" | "title" | "body" | "headRefName">,
  method: MergeMethod,
): { title: string; message: string } | null {
  if (method === "squash") return { title: `${pr.title} (#${pr.number})`, message: pr.body };
  if (method === "merge") return { title: `Merge pull request #${pr.number} from ${pr.headRefName}`, message: pr.title };
  return null;
}

/** Whether GitHub would take a merge of `pr` now: the readiness card's merge button is enabled. */
export function canMerge(pr: PullRequestReadiness): boolean {
  const { control } = readiness(pr);
  return control.kind === "merge" && control.enabled;
}

/** What `merge_github_pr` is sent to merge the pull request at `location`. */
export interface MergeArgs {
  repoPath: string;
  repo: string | null;
  number: number;
  method: MergeMethod;
  commitTitle: string | null;
  commitMessage: string | null;
  /** The head the merge was decided on; GitHub refuses the merge if the branch has moved since. */
  headSha: string;
  headBranch: string;
  deleteBranch: boolean;
}

/**
 * What a merge of `pr` by `method` sends with the pull request view's defaults, as a merge that
 * skips the confirm step does: GitHub's commit title and message for the method, and Delete branch
 * on, except for a fork's branch, which is not Quay's to delete. `edits` are the confirm step's.
 */
export function mergeArgs(
  location: PullRequestLocation,
  pr: Pick<PullRequestReadiness, "number" | "title" | "body" | "headRefName" | "headRefOid" | "isCrossRepository">,
  method: MergeMethod,
  edits: { title?: string; message?: string; deleteBranch?: boolean } = {},
): MergeArgs {
  const defaults = commitMessageDefaults(pr, method);
  return {
    repoPath: location.repoPath,
    repo: location.repo,
    number: location.number,
    method,
    commitTitle: defaults ? (edits.title ?? defaults.title) : null,
    commitMessage: defaults ? (edits.message ?? defaults.message) : null,
    headSha: pr.headRefOid,
    headBranch: pr.headRefName,
    deleteBranch: !pr.isCrossRepository && (edits.deleteBranch ?? true),
  };
}

/** What `merge_github_pr` reports once the pull request has merged. */
export interface MergeOutcome {
  branchDeleted: boolean;
  branchError: string | null;
}

/** The warning a merge that went through still carries: Delete branch failing, or null. */
export const mergeWarning = (outcome: MergeOutcome): string | null =>
  outcome.branchError ? `Merged, but Delete branch failed: ${outcome.branchError}` : null;
