import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GithubIssue, PullRequestReadiness } from "../github/types.ts";
import type { GithubPage } from "../github/paging.ts";
import type { PullRequestLocation } from "../companion/usePullRequestReadiness.ts";
import { formatUtcTimestamp, startOfLocalDay } from "../../lib/dates.ts";

/** Tickets asked for per page. */
export const TICKETS_PAGE_SIZE = 100;
/** Most open tickets read per repository; the +N link says "or more" past it. */
export const OPEN_TICKETS_READ_CAP = 300;
/** Most tickets closed today read per repository. */
export const CLOSED_TICKETS_READ_CAP = 200;
/** How often the pipeline reads GitHub again while the app runs, in ms. */
export const PIPELINE_REFRESH_MS = 120_000;

/** What the pipeline read about one repository's tickets. */
export interface RepoTickets {
  open: GithubIssue[];
  /** Whether `open` holds every open ticket, or stopped at the cap. */
  openComplete: boolean;
  /** Tickets closed and updated since local midnight. */
  closed: GithubIssue[];
  /** The signed-in login, or null when `gh` is not signed in. */
  viewer: string | null;
}

/** Reads `state` tickets a page at a time until GitHub has no more or `cap` are read. */
async function readPaged(repoPath: string, state: "open" | "closed", cap: number, since?: string): Promise<{ items: GithubIssue[]; complete: boolean }> {
  const items: GithubIssue[] = [];
  const seen = new Set<number>();
  let after: string | null = null;
  for (;;) {
    const args: Record<string, unknown> = { repoPath, state, pageSize: Math.min(TICKETS_PAGE_SIZE, cap - items.length) };
    if (after) args.after = after;
    if (since) args.since = since;
    const page: GithubPage<GithubIssue> = await invoke<GithubPage<GithubIssue>>("list_github_issues", args);
    // A ticket created between reads shifts the rest down a page; it is kept once.
    for (const item of page.items) if (!seen.has(item.number)) (seen.add(item.number), items.push(item));
    const more = page.hasNextPage && page.endCursor !== null;
    if (!more) return { items, complete: true };
    if (items.length >= cap) return { items: items.slice(0, cap), complete: false };
    after = page.endCursor;
  }
}

/**
 * One repository's tickets for the pipeline: its open tickets, paged up to `OPEN_TICKETS_READ_CAP`;
 * those closed since this machine's local midnight, paged up to `CLOSED_TICKETS_READ_CAP`; and the
 * signed-in login. Rejects when a list cannot be read.
 */
export async function readRepoTickets(repoPath: string, now: number): Promise<RepoTickets> {
  const since = formatUtcTimestamp(startOfLocalDay(now));
  const [open, closed, viewer] = await Promise.all([
    readPaged(repoPath, "open", OPEN_TICKETS_READ_CAP),
    readPaged(repoPath, "closed", CLOSED_TICKETS_READ_CAP, since),
    invoke<string | null>("get_github_viewer", { repoPath }).catch(() => null),
  ]);
  return { open: open.items, openComplete: open.complete, closed: closed.items, viewer };
}

/** A pull request's key in the reads. */
export const pullRequestKey = (location: PullRequestLocation) => `${location.repoPath}|${location.repo ?? ""}#${location.number}`;

/**
 * Keeps the pipeline's reads: each repository's tickets, and each lane's pull request through
 * `get_github_pr_readiness`, read when the repositories or pull requests change, every
 * `PIPELINE_REFRESH_MS`, and on `reload`. A read that a newer one replaced, or that arrives after
 * unmount, is dropped; a failed read keeps what was read before.
 */
export function usePipelineReads(
  repoPaths: readonly string[],
  pullRequests: readonly PullRequestLocation[],
): { tickets: Readonly<Record<string, RepoTickets>>; readiness: Readonly<Record<string, PullRequestReadiness>>; reload: () => void } {
  const [tickets, setTickets] = useState<Readonly<Record<string, RepoTickets>>>({});
  const [readiness, setReadiness] = useState<Readonly<Record<string, PullRequestReadiness>>>({});
  const [generation, setGeneration] = useState(0);
  const repoKey = [...new Set(repoPaths)].sort().join("\n");
  const prKey = [...new Set(pullRequests.map(pullRequestKey))].sort().join("\n");

  useEffect(() => {
    const timer = setInterval(() => setGeneration((g) => g + 1), PIPELINE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let stale = false;
    for (const repoPath of repoKey ? repoKey.split("\n") : []) {
      readRepoTickets(repoPath, Date.now())
        .then((read) => {
          if (!stale) setTickets((prev) => ({ ...prev, [repoPath]: read }));
        })
        .catch((err) => console.warn(`Could not read the tickets of ${repoPath}:`, err));
    }
    return () => {
      stale = true;
    };
  }, [repoKey, generation]);

  useEffect(() => {
    let stale = false;
    const byKey = new Map(pullRequests.map((location) => [pullRequestKey(location), location]));
    for (const key of prKey ? prKey.split("\n") : []) {
      const location = byKey.get(key);
      if (!location) continue;
      invoke<PullRequestReadiness>("get_github_pr_readiness", { repoPath: location.repoPath, repo: location.repo, number: location.number })
        .then((pr) => {
          if (!stale) setReadiness((prev) => ({ ...prev, [key]: pr }));
        })
        .catch((err) => console.warn(`Could not read pull request #${location.number}:`, err));
    }
    return () => {
      stale = true;
    };
    // `pullRequests` is read through `prKey`, which changes whenever a location does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prKey, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { tickets, readiness, reload };
}
