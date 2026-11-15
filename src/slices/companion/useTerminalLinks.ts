import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LinkRef, LinkSlotName, TerminalInfo, TerminalLink } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import type { GithubIssue, GithubPullRequest, GithubRepoInfo } from "../github/types.ts";
import type { GithubPage } from "../github/paging.ts";
import type { Envelope } from "../bridge/useBridgeEvents.ts";
import { isSamePath, normalizePath, resolveRootRepo } from "../../utils/paths.ts";
import {
  applyLinkSignal,
  applyPullRequestFacts,
  EMPTY_LINK,
  pinLink,
  unpinLink,
  type LinkContext,
  type LinkSignal,
} from "./terminalLink.ts";
import { branchSignals, launchSignals, toolCallActivity } from "./linkSignals.ts";
import { linkGuesses, searchLinkChoices } from "./linkChoices.ts";
import type { CompanionLinking } from "./Companion.tsx";

/** How long a repository's open pull request list is reused before it is fetched again, in ms. */
const OPEN_PULL_REQUESTS_TTL_MS = 60_000;
/** Most open pull requests or tickets read per repository: one page. */
const LIST_PAGE_SIZE = 100;

/** The terminal links the companion shows, and the launch facts the app records for them. */
export interface TerminalLinks {
  /** What the companion reads and changes about terminal links. */
  linking: CompanionLinking;
  /** Records the ticket a new terminal was launched from, such as a worktree created from an issue. */
  recordLaunch: (terminal: TerminalInfo, ticket: number) => void;
}

/** The repository folder (`resolveRootRepo`) a terminal works in. */
type RootPath = string;

/**
 * Keeps every terminal's link: reads launch facts when a terminal without a link is first seen,
 * agent activity from each finished tool call the bridge reports, and the working folder's branch
 * whenever it or the open pull request list changes, resolves each through `applyLinkSignal`, and
 * saves the result with the terminal through `set_terminal_link`.
 */
export function useTerminalLinks(
  terminals: readonly TerminalInfo[],
  projects: readonly Project[],
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>,
): TerminalLinks {
  const [links, setLinks] = useState<Readonly<Record<string, TerminalLink>>>({});
  const linksRef = useRef<Record<string, TerminalLink>>({});
  const [repoNames, setRepoNames] = useState<Readonly<Record<RootPath, string | null>>>({});
  const [pullRequests, setPullRequests] = useState<Readonly<Record<RootPath, { items: GithubPullRequest[]; at: number }>>>({});
  const [tickets, setTickets] = useState<Readonly<Record<RootPath, GithubIssue[]>>>({});
  const requested = useRef(new Set<string>());

  const rootOf = useCallback(
    (terminal: Pick<TerminalInfo, "project_path">): RootPath => resolveRootRepo(terminal.project_path, projects, projectWorktrees),
    [projects, projectWorktrees],
  );
  const contextOf = useCallback(
    (terminal: TerminalInfo): LinkContext => ({
      ownRepo: repoNames[rootOf(terminal)] ?? null,
      repos: Object.values(repoNames).filter((name): name is string => !!name),
    }),
    [repoNames, rootOf],
  );

  // Kept in refs, so the bridge listener registered once reads the latest of each.
  const latest = useRef({ terminals, projectWorktrees, pullRequests, rootOf, contextOf });
  latest.current = { terminals, projectWorktrees, pullRequests, rootOf, contextOf };

  /** Moves the terminal's link through `step` and saves it when it changed. */
  const update = useCallback((terminal: TerminalInfo, step: (link: TerminalLink | null) => TerminalLink | null) => {
    const before = linksRef.current[terminal.id] ?? terminal.link ?? null;
    const after = step(before);
    if (after === null || JSON.stringify(after) === JSON.stringify(before ?? EMPTY_LINK)) return;
    linksRef.current = { ...linksRef.current, [terminal.id]: after };
    setLinks(linksRef.current);
    invoke("set_terminal_link", { terminalId: terminal.id, link: after }).catch((err) =>
      console.warn(`Could not save the link of terminal ${terminal.id}:`, err),
    );
  }, []);

  /** Applies `signals`, then what the open pull request list says about the linked pull request. */
  const resolve = useCallback(
    (terminal: TerminalInfo, signals: readonly LinkSignal[]) => {
      const { contextOf: ctxOf, pullRequests: prs, rootOf: root } = latest.current;
      const ctx = ctxOf(terminal);
      const open = prs[root(terminal)]?.items ?? [];
      update(terminal, (link) => {
        let next = signals.reduce((acc: TerminalLink | null, signal) => applyLinkSignal(acc, signal, ctx), link);
        const linked = next?.pull_request;
        const pr = linked && linked.repo === null ? open.find((p) => p.number === linked.number) : undefined;
        if (pr) next = applyPullRequestFacts(next, { repo: null, number: pr.number, state: pr.state, closes: pr.closingIssues ?? [] }, Date.now());
        return next;
      });
    },
    [update],
  );

  const fetchPullRequests = useCallback((root: RootPath, force = false) => {
    const held = latest.current.pullRequests[root];
    const key = `prs:${root}`;
    if (!force && (requested.current.has(key) || (held && Date.now() - held.at < OPEN_PULL_REQUESTS_TTL_MS))) return;
    requested.current.add(key);
    invoke<GithubPage<GithubPullRequest>>("list_github_prs", { repoPath: root, state: "open", pageSize: LIST_PAGE_SIZE })
      .then((page) => setPullRequests((prev) => ({ ...prev, [root]: { items: page.items, at: Date.now() } })))
      .catch((err) => console.warn(`Could not list the open pull requests of ${root}:`, err))
      .finally(() => requested.current.delete(key));
  }, []);

  // Each repository's owner/name, once, so signals can be matched to the repositories that count.
  useEffect(() => {
    const roots = new Set<RootPath>([...projects.map((p) => p.path), ...terminals.map(rootOf)]);
    for (const root of roots) {
      const key = `repo:${normalizePath(root)}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      invoke<GithubRepoInfo | null>("get_github_repo_info", { repoPath: root })
        .then((info) => setRepoNames((prev) => ({ ...prev, [root]: info?.nwo ?? null })))
        .catch(() => setRepoNames((prev) => ({ ...prev, [root]: null })));
    }
  }, [projects, terminals, rootOf]);

  // Launch facts, for a terminal Quay sees with no link yet.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const terminal of terminals) {
      if (seen.current.has(terminal.id)) continue;
      seen.current.add(terminal.id);
      if (terminal.link) continue;
      const signals = launchSignals({ command_text: terminal.command_text }, Date.now());
      if (signals.length) resolve(terminal, signals);
    }
  }, [terminals, resolve]);

  // The derived branch: re-read whenever the branch or the open pull request list changes.
  const derived = useRef<Record<string, string>>({});
  const pendingFolders = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const terminal of terminals) {
      const root = rootOf(terminal);
      fetchPullRequests(root);
      const open = pullRequests[root];
      const pending = pendingFolders.current[terminal.id];
      if (pending) {
        const entry = findWorktree(projectWorktrees, pending);
        if (entry) {
          delete pendingFolders.current[terminal.id];
          resolve(terminal, branchSignals(entry.branch, open?.items ?? [], "activity", Date.now()));
        }
      }
      const branch = findWorktree(projectWorktrees, terminal.project_path)?.branch;
      if (!branch) continue;
      const key = `${branch}@${open?.at ?? 0}`;
      if (derived.current[terminal.id] === key) continue;
      derived.current[terminal.id] = key;
      resolve(terminal, branchSignals(branch, open?.items ?? [], "branch", Date.now()));
    }
  }, [terminals, projectWorktrees, pullRequests, rootOf, fetchPullRequests, resolve]);

  // Agent activity: each finished tool call, with the command it ran and what it printed.
  useEffect(() => {
    const unlisten = listen<Envelope>("bridge-event", ({ payload }) => {
      if (payload.type !== "tool.finished" || !payload.tag) return;
      const command = payload.data?.input?.command;
      if (typeof command !== "string") return;
      const terminal = latest.current.terminals.find((t) => t.id === payload.tag);
      if (!terminal) return;
      const status = payload.data?.status;
      const result = typeof payload.data?.text === "string" ? payload.data.text : "";
      const activity = toolCallActivity({ command, result, ok: status === undefined || status === "ok" }, Date.now());
      const signals = [...activity.signals];
      if (activity.folder) {
        const folder = absoluteFolder(activity.folder, terminal.project_path);
        const root = latest.current.rootOf(terminal);
        const open = latest.current.pullRequests[root]?.items ?? [];
        const branch = activity.branch ?? findWorktree(latest.current.projectWorktrees, folder)?.branch;
        if (branch) signals.push(...branchSignals(branch, open, "activity", Date.now()));
        else pendingFolders.current[terminal.id] = folder;
      }
      if (signals.length) resolve(terminal, signals);
      if (activity.signals.some((s) => s.slot === "pull_request")) fetchPullRequests(latest.current.rootOf(terminal), true);
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [resolve, fetchPullRequests]);

  const byId = useMemo(() => new Map(terminals.map((t) => [t.id, t])), [terminals]);
  const pin = useCallback(
    (terminalId: string, slot: LinkSlotName, ref: LinkRef) => {
      const terminal = byId.get(terminalId);
      if (terminal) update(terminal, (link) => pinLink(link, slot, ref, Date.now()));
    },
    [byId, update],
  );
  const unpin = useCallback(
    (terminalId: string, slot: LinkSlotName) => {
      const terminal = byId.get(terminalId);
      if (!terminal) return;
      update(terminal, (link) => unpinLink(link, slot));
      // The branch is read again, so an automatic signal can fill the slot the pin left.
      delete derived.current[terminalId];
      fetchPullRequests(rootOf(terminal), true);
    },
    [byId, update, fetchPullRequests, rootOf],
  );
  const recordLaunch = useCallback(
    (terminal: TerminalInfo, ticket: number) => {
      seen.current.add(terminal.id);
      resolve(terminal, launchSignals({ ticket }, Date.now()));
    },
    [resolve],
  );
  const loadChoices = useCallback(
    (terminal: TerminalInfo) => {
      const root = rootOf(terminal);
      fetchPullRequests(root);
      invoke<GithubPage<GithubIssue>>("list_github_issues", { repoPath: root, state: "open", pageSize: LIST_PAGE_SIZE })
        .then((page) => setTickets((prev) => ({ ...prev, [root]: page.items })))
        .catch((err) => console.warn(`Could not list the open tickets of ${root}:`, err));
    },
    [rootOf, fetchPullRequests],
  );

  return {
    linking: {
      linkOf: (terminal) => links[terminal.id] ?? terminal.link ?? null,
      pin,
      unpin,
      loadChoices,
      choices: (terminal, query) => {
        const prs = pullRequests[rootOf(terminal)]?.items ?? [];
        return query.trim()
          ? searchLinkChoices(query, prs, tickets[rootOf(terminal)] ?? [])
          : linkGuesses(findWorktree(projectWorktrees, terminal.project_path)?.branch ?? null, prs);
      },
    },
    recordLaunch,
  };
}

/** The worktree at `folder` in any project's worktree list. */
function findWorktree(
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>,
  folder: string,
): GitWorktree | undefined {
  for (const list of Object.values(projectWorktrees)) {
    const entry = list.find((wt) => isSamePath(wt.path, folder));
    if (entry) return entry;
  }
  return undefined;
}

/** `folder` as an absolute path, read against the terminal's folder when it is relative. */
function absoluteFolder(folder: string, base: string): string {
  return /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(folder) ? folder : `${normalizePath(base)}/${folder}`;
}
