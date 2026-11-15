import type { LinkRef, LinkSlotName } from "../terminal/types.ts";
import { branchTicket, OWNER_NAME_PATTERN, positiveNumber } from "./linkSignals.ts";

/** One entry the Link to... picker offers; picking it pins `ref` to `slot`. */
export interface LinkChoice {
  slot: LinkSlotName;
  ref: LinkRef;
  /** The title, when Quay has it. */
  label: string | null;
}

/** What the picker knows about an open pull request. */
export interface PullRequestSummary {
  number: number;
  title: string;
  headRefName: string;
  closingIssues: readonly number[];
}

/** What the picker knows about an open ticket. */
export interface TicketSummary {
  number: number;
  title: string;
}

/** How many recent pull requests the picker guesses. */
export const RECENT_PULL_REQUESTS = 5;
/** Most matches search lists of each kind. */
export const MAX_SEARCH_MATCHES = 10;

/**
 * The picker's guesses, before any search: the ticket the branch is named for, the open pull
 * requests whose head branch it is or that close that ticket, then the `RECENT_PULL_REQUESTS`
 * newest open pull requests. `openPullRequests` is newest first; each ref is listed once.
 */
export function linkGuesses(branch: string | null, openPullRequests: readonly PullRequestSummary[]): LinkChoice[] {
  const ticket = branch === null ? null : branchTicket(branch);
  const choices: LinkChoice[] = [];
  if (ticket !== null) choices.push({ slot: "ticket", ref: { repo: null, number: ticket }, label: null });
  const own = openPullRequests.filter(
    (pr) => pr.headRefName === branch || (ticket !== null && pr.closingIssues.includes(ticket)),
  );
  const recent = openPullRequests.slice(0, RECENT_PULL_REQUESTS).filter((pr) => !own.includes(pr));
  for (const pr of [...own, ...recent]) {
    choices.push({ slot: "pull_request", ref: { repo: null, number: pr.number }, label: pr.title });
  }
  return choices;
}

/** `#N`, `N` or `owner/name#N`. */
const NUMBER_QUERY = new RegExp(String.raw`^(?:(${OWNER_NAME_PATTERN}))?#?(\d+)$`);

/**
 * The picker's search results for `query`. A number, or `owner/name#N`, offers that pull request
 * and that ticket, since a pin may point at any repository `gh` can read. Words match the titles
 * of open pull requests, then of open tickets, case-insensitively, at most `MAX_SEARCH_MATCHES`
 * of each.
 */
export function searchLinkChoices(
  query: string,
  openPullRequests: readonly PullRequestSummary[],
  openTickets: readonly TicketSummary[],
): LinkChoice[] {
  const text = query.trim();
  if (!text) return [];
  const numbered = NUMBER_QUERY.exec(text);
  const number = numbered ? positiveNumber(numbered[2]) : null;
  if (numbered && number !== null) {
    const ref = { repo: numbered[1] ?? null, number };
    const title = (list: readonly { number: number; title: string }[]) =>
      ref.repo === null ? (list.find((item) => item.number === number)?.title ?? null) : null;
    return [
      { slot: "pull_request", ref, label: title(openPullRequests) },
      { slot: "ticket", ref: { ...ref }, label: title(openTickets) },
    ];
  }
  const words = text.toLowerCase().split(/\s+/);
  const matches = (title: string) => words.every((word) => title.toLowerCase().includes(word));
  return [
    ...openPullRequests
      .filter((pr) => matches(pr.title))
      .slice(0, MAX_SEARCH_MATCHES)
      .map((pr): LinkChoice => ({ slot: "pull_request", ref: { repo: null, number: pr.number }, label: pr.title })),
    ...openTickets
      .filter((t) => matches(t.title))
      .slice(0, MAX_SEARCH_MATCHES)
      .map((t): LinkChoice => ({ slot: "ticket", ref: { repo: null, number: t.number }, label: t.title })),
  ];
}
