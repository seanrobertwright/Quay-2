import type { GithubIssue, PullRequestReadiness } from "../github/types.ts";
import { parseUtcTimestamp, startOfLocalDay } from "../../lib/dates.ts";
import type { LinkRef, TerminalLink } from "../terminal/types.ts";
import { readiness } from "../companion/readiness.ts";

/** A lane's four steps, in the order the bar draws them. */
export type LaneStepId = "ticket" | "terminal" | "pull-request" | "merged";

/** The steps with the labels drawn under them. */
export const LANE_STEPS: readonly { id: LaneStepId; label: string }[] = [
  { id: "ticket", label: "Ticket" },
  { id: "terminal", label: "Terminal" },
  { id: "pull-request", label: "Pull request" },
  { id: "merged", label: "Merged" },
];

/** The colour a step takes: passed, the one the ticket is in, held up, failing, or still ahead. */
export type LaneStepTone = "done" | "current" | "blocked" | "failing" | "todo";

/** The chip that says the lane needs the operator. */
export type NeedsYou = "Waiting" | "Merge" | "Failing";

/** What a terminal row's lane is read from. */
export interface LaneInput {
  /** The terminal's link; a lane needs its ticket slot filled. */
  link: TerminalLink | null;
  /** What the open ticket list says about the ticket, or null while it has not been read. */
  ticket: { title: string; assignee: string | null; blocker: LinkRef | null } | null;
  /** The linked pull request as last read, or null while it has not been read or there is none. */
  pullRequest: PullRequestReadiness | null;
  /** Whether the terminal is waiting on the operator. */
  waiting: boolean;
  now: number;
}

/** One terminal row's lane. */
export interface TicketLane {
  /** `owner/name` of the ticket's repository as its slot names it, or null for the project's own. */
  repo: string | null;
  number: number;
  title: string;
  steps: { id: LaneStepId; label: string; tone: LaneStepTone }[];
  current: LaneStepId;
  stateLine: string;
  needsYou: NeedsYou | null;
  /** The open blocker while one holds the ticket up. */
  blocker: LinkRef | null;
  assignee: string | null;
  /** How long the ticket has been in its current step, such as "5m", "3h" or "2d". */
  age: string;
  /** Whether the readiness card would read Ready to merge, so the lane offers Merge. */
  canMerge: boolean;
}

/** The checks of a pull request in words, from its counts. */
function checksText({ failing, pending, passing }: PullRequestReadiness["checks"]): string {
  if (failing > 0) return "checks failing";
  if (pending > 0) return "checks running";
  if (passing > 0) return "checks passing";
  return "no checks";
}

/** A duration as its largest whole unit: "0m", "5m", "3h", "2d". */
function stepAge(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The lane a terminal row shows, or null for a plain shell, whose ticket slot is empty.
 *
 * The ticket is in the Merged step once its pull request is read as merged (or its slot last saw
 * it merged), in Pull request while the terminal has one, else in Terminal. The link keeps a merged
 * pull request until a new signal names another, so the lane keeps showing Merged until then.
 * The chip is Waiting while the terminal waits on the operator, else Failing while a check fails,
 * else Merge while the readiness card would read Ready to merge. Age counts from when the slot of
 * the current step was set.
 */
export function ticketLane({ link, ticket, pullRequest, waiting, now }: LaneInput): TicketLane | null {
  const ticketSlot = link?.ticket;
  if (!ticketSlot) return null;
  const prSlot = link.pull_request;
  const pr = prSlot && pullRequest && pullRequest.number === prSlot.number ? pullRequest : null;
  const prState = pr?.state ?? prSlot?.state ?? null;
  const current: LaneStepId = prState === "MERGED" ? "merged" : prSlot ? "pull-request" : "terminal";
  const verdict = pr && pr.state === "OPEN" ? readiness(pr) : null;
  const blocker = current === "terminal" ? (ticket?.blocker ?? null) : null;
  const currentTone: LaneStepTone =
    current === "merged" ? "done" : blocker !== null ? "blocked" : verdict?.tone === "failing" ? "failing" : "current";
  const at = LANE_STEPS.findIndex((s) => s.id === current);
  const steps = LANE_STEPS.map((s, i) => ({ ...s, tone: i < at ? ("done" as const) : i === at ? currentTone : ("todo" as const) }));

  let stateLine: string;
  if (prSlot && current === "merged") stateLine = `PR #${prSlot.number} · merged`;
  else if (prSlot && prState === "CLOSED") stateLine = `PR #${prSlot.number} · closed without merging`;
  else if (prSlot && pr && verdict) {
    const parts = [`PR #${prSlot.number}`, checksText(pr.checks)];
    if (verdict.tone !== "failing" && verdict.tone !== "pending") parts.push(verdict.headline.toLowerCase());
    stateLine = parts.join(" · ");
  } else if (prSlot) stateLine = `PR #${prSlot.number}`;
  else if (blocker !== null) stateLine = `Blocked by #${blocker.number}`;
  else stateLine = "No pull request yet";

  const canMerge = verdict?.headline === "Ready to merge";
  const needsYou: NeedsYou | null = waiting ? "Waiting" : verdict?.tone === "failing" ? "Failing" : canMerge ? "Merge" : null;
  const since = current === "terminal" ? ticketSlot.at : (prSlot?.at ?? ticketSlot.at);
  return {
    repo: ticketSlot.repo,
    number: ticketSlot.number,
    title: ticket?.title ?? `Ticket #${ticketSlot.number}`,
    steps,
    current,
    stateLine,
    needsYou,
    blocker,
    assignee: ticket?.assignee ?? null,
    age: stepAge(now - since),
    canMerge,
  };
}

/** The most tickets Ready to start and Blocked each show before their +N link. */
export const PIPELINE_LIST_CAP = 3;

/** One of the lists under the terminals: the tickets shown, and how many more there are. */
export interface PipelineList {
  shown: GithubIssue[];
  more: number;
}

/** What the Projects panel shows under a project's terminals. */
export interface PipelineLists {
  ready: PipelineList;
  blocked: PipelineList;
  /** Tickets closed as completed since local midnight that no terminal holds. */
  mergedToday: number;
}

/** What the lists are read from. */
export interface PipelineListsInput {
  /** The open tickets read, perhaps only the first pages. */
  open: readonly GithubIssue[];
  /** Whether `open` holds every open ticket, or stopped at the read cap. */
  openComplete: boolean;
  /** Closed tickets, such as those updated since local midnight. */
  closed: readonly GithubIssue[];
  /** The signed-in login, or null while it is not known. */
  viewer: string | null;
  /** The numbers of the tickets a terminal holds, which show as lanes instead. */
  linked: ReadonlySet<number>;
  now: number;
}

const cap = (items: GithubIssue[]): PipelineList => ({ shown: items.slice(0, PIPELINE_LIST_CAP), more: Math.max(0, items.length - PIPELINE_LIST_CAP) });

/**
 * Ready to start and Blocked: the open tickets no terminal holds that are assigned to the operator
 * or to no one, lowest number first (a spec's tickets are cut in build order), Blocked while one
 * has an open blocker. Each shows three, then counts the rest. Merged today counts the tickets
 * closed as completed since local midnight that no terminal holds.
 */
export function pipelineLists({ open, closed, viewer, linked, now }: PipelineListsInput): PipelineLists {
  const mine = open
    .filter((i) => !linked.has(i.number))
    .filter((i) => i.assignees.length === 0 || (viewer !== null && i.assignees.some((a) => a.login.toLowerCase() === viewer.toLowerCase())))
    .sort((a, b) => a.number - b.number);
  const isBlocked = (i: GithubIssue) => i.openBlockerCount > 0 || i.blockedBy.length > 0;
  const midnight = startOfLocalDay(now);
  const mergedToday = closed.filter((i) => {
    if (linked.has(i.number) || i.stateReason !== "COMPLETED" || !i.closedAt) return false;
    const at = parseUtcTimestamp(i.closedAt);
    return at !== null && at >= midnight && at <= now;
  }).length;
  return { ready: cap(mine.filter((i) => !isBlocked(i))), blocked: cap(mine.filter(isBlocked)), mergedToday };
}

/** The +N link's words: "+4", or "+4 or more" when the open list stopped at its read cap. */
export function moreLabel(more: number, complete: boolean): string {
  return complete ? `+${more}` : `+${more} or more`;
}
