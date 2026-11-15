import type { CheckOutcome, PullRequestCheck, PullRequestTimeline, TimelineItem } from "../github/types.ts";

/** The Checks detail's groups, in the order it shows them, each with its heading. */
export const CHECK_GROUPS: readonly { outcome: CheckOutcome; label: string }[] = [
  { outcome: "failing", label: "Failing" },
  { outcome: "pending", label: "Pending" },
  { outcome: "skipped", label: "Skipped" },
  { outcome: "passing", label: "Successful" },
];

/** `checks` grouped failing, pending, skipped and successful, empty groups left out. */
export function groupChecks(checks: readonly PullRequestCheck[]) {
  return CHECK_GROUPS.map((group) => ({ ...group, checks: checks.filter((c) => c.outcome === group.outcome) })).filter(
    (group) => group.checks.length > 0,
  );
}

/** The Comments detail's filters. */
export type CommentFilter = "all" | "unresolved" | "mine";

export const COMMENT_FILTERS: readonly { filter: CommentFilter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "unresolved", label: "Unresolved" },
  { filter: "mine", label: "Mine" },
];

/** Whether the viewer wrote `item`, or any reply in it. */
const isMine = (item: TimelineItem, viewer: string) =>
  viewer !== "" && (item.author === viewer || item.replies.some((reply) => reply.author === viewer));

/**
 * The timeline items `filter` keeps: every one, the unresolved review threads, or the viewer's
 * own, including a thread the viewer replied in. The timeline comes oldest first; `newestFirst`
 * turns it round.
 */
export function filterTimeline(timeline: PullRequestTimeline, filter: CommentFilter, newestFirst: boolean): TimelineItem[] {
  const kept = timeline.items.filter((item) =>
    filter === "unresolved" ? item.kind === "thread" && item.resolved === false : filter === "mine" ? isMine(item, timeline.viewer) : true,
  );
  return newestFirst ? kept.reverse() : kept;
}

/** How many review threads each file has, for the Files picker's marks. */
export function commentsByPath(timeline: PullRequestTimeline | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of timeline?.items ?? []) {
    if (item.kind === "thread" && item.path) counts.set(item.path, (counts.get(item.path) ?? 0) + 1);
  }
  return counts;
}
