import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileDiff, GitGraph, GitPullRequest, RotateCw, Search, ShieldCheck, Zap } from "lucide-react";
import type { LinkRef, LinkSlotName } from "../terminal/types.ts";
import type { GithubIssue, GithubPullRequest, GithubRepoInfo } from "./types.ts";
import { canLoadMore, GITHUB_LIST_CAP, loadedCountLabel } from "./paging.ts";
import { useLoadMoreSentinel, usePagedGithubList, type PagedGithubList } from "./usePagedGithubList.ts";

interface SourceControlPanelProps {
  /** Whether the panel shows; it reads GitHub only while it does. */
  isOpen: boolean;
  /** The repository whose pull requests and issues the panel lists. */
  repoPath: string;
  /** The selected terminal's name, which a pick is pinned to, or null when none is selected. */
  pickTarget: string | null;
  /** Pins `ref` to the selected terminal's `slot` and opens it in the companion. */
  onPick: (slot: LinkSlotName, ref: LinkRef) => void;
  onOpenTopos: () => void;
  /** Opens the repo-wide Diffs. */
  onOpenDiffs: () => void;
  onOpenPrePrAudit: () => void;
  /** Starts Archon's conflict resolution on a pull request that conflicts with its base. */
  onResolveConflicts?: (pr: GithubPullRequest) => void;
}

type ListKind = "prs" | "issues";
type StateFilter = "open" | "all";

/** A row's state word when it is not simply open: Draft, Merged or Closed. */
function stateWord(state: string, isDraft = false): string | null {
  if (state === "MERGED") return "Merged";
  if (state === "CLOSED") return "Closed";
  return isDraft ? "Draft" : null;
}

/** Whether a pull request's number, title or head branch contains `query`, lower-cased. */
function prMatches(pr: GithubPullRequest, query: string): boolean {
  return String(pr.number).includes(query) || pr.title.toLowerCase().includes(query) || pr.headRefName.toLowerCase().includes(query);
}

/** Whether an issue's number, title or a label contains `query`, lower-cased. */
function issueMatches(issue: GithubIssue, query: string): boolean {
  return (
    String(issue.number).includes(query) ||
    issue.title.toLowerCase().includes(query) ||
    issue.labels.some((l) => l.name.toLowerCase().includes(query))
  );
}

/**
 * The last row of a paged list, a status line. While another page may load it is the
 * infinite-scroll sentinel; a failed page offers Retry; otherwise it gives the count, which at the
 * cap tells the operator to filter.
 */
const LoadMoreRow = ({ pages, sentinelRef }: { pages: PagedGithubList<unknown>; sentinelRef: (node: HTMLElement | null) => void }) => {
  const { list, isLoadingMore, loadMoreError, loadMore } = pages;
  if (list.items.length === 0 && !list.hasNextPage) return null;
  const count = loadedCountLabel(list, GITHUB_LIST_CAP);
  const more = canLoadMore(list, GITHUB_LIST_CAP);
  return (
    <div
      role="status"
      ref={more && !loadMoreError ? sentinelRef : undefined}
      className="px-3 py-3 flex items-center justify-center gap-2 text-center text-[11px] text-[#8b949e]"
    >
      {more && loadMoreError ? (
        <>
          <span className="text-[#ff7b72]" title={loadMoreError}>
            Couldn&apos;t load more ({count})
          </span>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="min-h-6 px-2 rounded bg-[#21262d] hover:bg-[#30363d] text-white font-medium"
          >
            Retry
          </button>
        </>
      ) : more ? (
        <span>
          {isLoadingMore ? "Loading more" : "Scroll for more"} ({count})
        </span>
      ) : (
        <span>{count}</span>
      )}
    </div>
  );
};

/** An exclusive choice drawn as a radio group; arrow keys move the choice and focus together. */
const Choice = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, by: number) => {
    const next = (from + by + options.length) % options.length;
    onChange(options[next][0]);
    buttons.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5">
      {options.map(([id, name], index) => (
        <button
          key={id}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(index, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(index, -1);
            }
          }}
          className={`flex-1 min-h-6 px-2 rounded text-[11px] font-medium ${
            value === id ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-[#c9d1d9]"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
};

const LIST_OPTIONS = [
  ["prs", "Pull requests"],
  ["issues", "Issues"],
] as const;
const STATE_OPTIONS = [
  ["open", "Open"],
  ["all", "All"],
] as const;

const ROW =
  "flex-1 min-w-0 w-full min-h-10 flex flex-col px-2.5 py-2 rounded-md text-left text-xs enabled:hover:bg-[#161b22] disabled:opacity-60";
const TAG = "shrink-0 px-1.5 rounded bg-[#21262d] text-[#c9d1d9]";
const ALERT_TAG = "shrink-0 px-1.5 rounded bg-[#f85149]/20 text-[#ff7b72]";
const EMPTY = "py-8 text-center text-xs text-[#8b949e]";

/**
 * The Source control module's panel: Topos, the repo-wide Diffs and the Pre-PR Audit, then the
 * repository's pull requests and issues, filtered and paged as the GitHub drawer did. Picking a row
 * pins it to the selected terminal, which opens it in the companion.
 */
export const SourceControlPanel = ({
  isOpen,
  repoPath,
  pickTarget,
  onPick,
  onOpenTopos,
  onOpenDiffs,
  onOpenPrePrAudit,
  onResolveConflicts,
}: SourceControlPanelProps) => {
  const id = useId();
  const [repoInfo, setRepoInfo] = useState<GithubRepoInfo | null>(null);
  const [kind, setKind] = useState<ListKind>("prs");
  const [prState, setPrState] = useState<StateFilter>("open");
  const [issueState, setIssueState] = useState<StateFilter>("open");
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<Record<ListKind, string | null>>({ prs: null, issues: null });
  const prPages = usePagedGithubList<GithubPullRequest>("list_github_prs", repoPath, prState, GITHUB_LIST_CAP);
  const issuePages = usePagedGithubList<GithubIssue>("list_github_issues", repoPath, issueState, GITHUB_LIST_CAP);
  const { loadFirstPage: loadFirstPrPage } = prPages;
  const { loadFirstPage: loadFirstIssuePage } = issuePages;
  const prSentinelRef = useLoadMoreSentinel(prPages.loadMore, prPages.list.items.length);
  const issueSentinelRef = useLoadMoreSentinel(issuePages.loadMore, issuePages.list.items.length);

  // Each load spawns `gh`, so each reruns only when its own inputs change: a filter change
  // refetches its own list and nothing else.
  const loadRepo = useCallback(() => {
    if (!repoPath) return;
    invoke<GithubRepoInfo | null>("get_github_repo_info", { repoPath }).then(setRepoInfo, () => setRepoInfo(null));
  }, [repoPath]);
  const loadPrs = useCallback(() => {
    if (!repoPath) return;
    setErrors((e) => ({ ...e, prs: null }));
    loadFirstPrPage().catch((err) => setErrors((e) => ({ ...e, prs: String(err) })));
  }, [repoPath, loadFirstPrPage]);
  const loadIssues = useCallback(() => {
    if (!repoPath) return;
    setErrors((e) => ({ ...e, issues: null }));
    loadFirstIssuePage().catch((err) => setErrors((e) => ({ ...e, issues: String(err) })));
  }, [repoPath, loadFirstIssuePage]);

  useEffect(() => {
    if (isOpen) loadRepo();
  }, [isOpen, loadRepo]);
  useEffect(() => {
    if (isOpen) loadPrs();
  }, [isOpen, loadPrs]);
  useEffect(() => {
    if (isOpen) loadIssues();
  }, [isOpen, loadIssues]);

  const query = search.trim().toLowerCase();
  const prs = useMemo(() => prPages.list.items.filter((pr) => !query || prMatches(pr, query)), [prPages.list.items, query]);
  const labels = useMemo(
    () => [...new Set(issuePages.list.items.flatMap((i) => i.labels.map((l) => l.name)))].sort(),
    [issuePages.list.items],
  );
  const issues = useMemo(
    () =>
      issuePages.list.items.filter(
        (i) => (!label || i.labels.some((l) => l.name === label)) && (!query || issueMatches(i, query)),
      ),
    [issuePages.list.items, label, query],
  );

  const nwo = repoInfo?.nwo ?? null;
  const canPick = pickTarget !== null;
  const hintId = `${id}-hint`;
  const shownError = errors[kind];
  const tools = [
    { key: "topos", name: "Topos", shortcut: "Ctrl+Shift+B c", icon: <GitGraph className="w-4 h-4 text-[#58a6ff]" />, onClick: onOpenTopos },
    { key: "diffs", name: "Diffs", shortcut: "Ctrl+Shift+B d", icon: <FileDiff className="w-4 h-4 text-[#3fb950]" />, onClick: onOpenDiffs },
    { key: "audit", name: "Pre-PR Audit", shortcut: "Ctrl+Shift+B a", icon: <ShieldCheck className="w-4 h-4 text-[#f85149]" />, onClick: onOpenPrePrAudit },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col select-none text-[#c9d1d9]">
      <div className="h-12 shrink-0 pl-4 pr-2 flex items-center gap-2 border-b border-[#30363d] bg-[#161b22]">
        <h2 className="shrink-0 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">Source control</h2>
        {nwo && <span className="min-w-0 truncate font-mono text-[11px] text-[#58a6ff]">{nwo}</span>}
        <button
          type="button"
          onClick={() => {
            loadRepo();
            loadPrs();
            loadIssues();
          }}
          aria-label="Refresh pull requests and issues"
          title="Refresh pull requests and issues"
          className="ml-auto shrink-0 w-8 h-8 grid place-items-center rounded text-[#8b949e] hover:text-white hover:bg-[#21262d]"
        >
          <RotateCw aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      <ul aria-label="Source control tools" className="shrink-0 p-2 space-y-1 border-b border-[#30363d]">
        {tools.map((tool) => {
          const shortcutId = `${id}-${tool.key}-shortcut`;
          return (
            <li key={tool.key}>
              <button
                type="button"
                onClick={tool.onClick}
                aria-label={tool.name}
                aria-describedby={shortcutId}
                className="w-full min-h-10 flex items-center gap-2.5 px-2.5 rounded-md text-left text-xs hover:bg-[#161b22] hover:text-white"
              >
                <span aria-hidden="true" className="shrink-0 w-4 h-4 grid place-items-center">
                  {tool.icon}
                </span>
                <span className="flex-1 truncate">{tool.name}</span>
                <span id={shortcutId} className="shrink-0 font-mono text-[10px] text-[#8b949e]">
                  {tool.shortcut}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 p-2 space-y-2 border-b border-[#30363d] text-xs">
        <Choice label="List" options={LIST_OPTIONS} value={kind} onChange={setKind} />
        <Choice
          label="State"
          options={STATE_OPTIONS}
          value={kind === "prs" ? prState : issueState}
          onChange={kind === "prs" ? setPrState : setIssueState}
        />
        <div className="relative">
          <Search aria-hidden="true" className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter by title, number, branch or label"
            placeholder="Filter by title, #, branch or label"
            className="w-full h-8 pl-8 pr-2.5 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff]"
          />
        </div>
        {kind === "issues" && labels.length > 0 && (
          <select
            aria-label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full h-8 px-2 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white focus:outline-hidden focus:border-[#58a6ff]"
          >
            <option value="">All labels</option>
            {labels.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <p id={hintId} className="text-[11px] text-[#8b949e]">
          {canPick ? `Opens in the companion for ${pickTarget}.` : "Select a terminal to open a pull request or issue in the companion."}
        </p>
      </div>

      {/* The scroll container is the load-more sentinel's parent, which the sentinel watches against. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {shownError ? (
          <div role="alert" className="p-4 space-y-2 text-center text-xs">
            <p className="font-semibold text-white">Couldn&apos;t read GitHub</p>
            <p className="text-[#8b949e] break-words">{shownError}</p>
            <button
              type="button"
              onClick={kind === "prs" ? loadPrs : loadIssues}
              className="min-h-6 px-3 rounded bg-[#21262d] hover:bg-[#30363d] text-white font-medium"
            >
              Retry
            </button>
          </div>
        ) : kind === "prs" ? (
          <ul aria-label="Pull requests" className="p-2 space-y-1">
            {prs.length === 0 && prPages.list.items.length > 0 && <li className={EMPTY}>No pull request matches the filter</li>}
            {prs.map((item) => {
              const word = stateWord(item.state, item.isDraft);
              const conflicting = item.mergeable === "CONFLICTING";
              return (
                <li key={item.number} className="flex items-start gap-1">
                  <button
                    type="button"
                    data-row
                    disabled={!canPick}
                    aria-describedby={hintId}
                    onClick={() => onPick("pull_request", { repo: nwo, number: item.number })}
                    className={ROW}
                  >
                    <span className="flex items-start gap-1.5">
                      <GitPullRequest
                        aria-hidden="true"
                        className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${item.state === "OPEN" ? "text-[#3fb950]" : "text-[#8b949e]"}`}
                      />
                      <span className="font-mono font-bold text-[#58a6ff]">#{item.number}</span>
                      <span className="min-w-0 line-clamp-2 text-white">{item.title}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-[#8b949e]">
                      <span className="min-w-0 truncate">
                        {item.headRefName} → {item.baseRefName}
                      </span>
                      {word && <span className={TAG}>{word}</span>}
                      {conflicting && <span className={ALERT_TAG}>Conflict</span>}
                    </span>
                  </button>
                  {conflicting && onResolveConflicts && (
                    <button
                      type="button"
                      onClick={() => onResolveConflicts(item)}
                      aria-label={`Resolve the conflicts of #${item.number} with Archon`}
                      title="Run Archon's conflict resolution workflow"
                      className="shrink-0 w-8 h-8 mt-1 grid place-items-center rounded text-[#d2a8ff] hover:bg-[#a371f7]/20"
                    >
                      <Zap aria-hidden="true" className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul aria-label="Issues" className="p-2 space-y-1">
            {issues.length === 0 && issuePages.list.items.length > 0 && <li className={EMPTY}>No issue matches the filter</li>}
            {issues.map((item) => {
              const word = stateWord(item.state);
              const blockers = Math.max(item.openBlockerCount ?? 0, item.blockedBy?.length ?? 0);
              return (
                <li key={item.number}>
                  <button
                    type="button"
                    data-row
                    disabled={!canPick}
                    aria-describedby={hintId}
                    onClick={() => onPick("ticket", { repo: nwo, number: item.number })}
                    className={ROW}
                  >
                    <span className="flex items-start gap-1.5">
                      <span className="font-mono font-bold text-[#58a6ff]">#{item.number}</span>
                      <span className="min-w-0 line-clamp-2 text-white">{item.title}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[10px] text-[#8b949e]">
                      {word && <span className={TAG}>{word}</span>}
                      {blockers > 0 && <span className={ALERT_TAG}>Blocked by {blockers}</span>}
                      {item.labels.map((l) => (
                        <span key={l.name} className={TAG}>
                          {l.name}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!shownError &&
          (kind === "prs" ? (
            <LoadMoreRow key="prs" pages={prPages} sentinelRef={prSentinelRef} />
          ) : (
            <LoadMoreRow key="issues" pages={issuePages} sentinelRef={issueSentinelRef} />
          ))}
      </div>
    </div>
  );
};
