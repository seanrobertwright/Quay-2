import { useState, useEffect, useCallback, useMemo, FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  GithubIssue,
  GithubIssueDetail,
  GithubIssueRef,
  GithubPullRequest,
  GithubRepoInfo,
} from "./types";
import { GithubIcon } from "./GithubIcon";
import { loadedCountLabel, type PagedList } from "./paging";
import { useLoadMoreSentinel, usePagedGithubList } from "./usePagedGithubList";
import { ArchonWorkflow, ArchonRun } from "../archon/types";
import { useOverlay } from "../overlay/useOverlay";
import {
  X,
  GitPullRequest,
  AlertCircle,
  RotateCw,
  Search,
  Sparkles,
  ExternalLink,
  GitBranch,
  Zap,
  Maximize2,
  Minimize2,
  Workflow,
  ChevronDown,
} from "lucide-react";

interface BlockedTagProps {
  blockedBy: GithubIssueRef[];
  openBlockerCount: number;
  repoNwo?: string | null;
  /** "compact" lists blocker numbers inline (list rows); "full" also shows titles. */
  variant: "compact" | "full";
  onSelectBlocker: (blocker: GithubIssueRef) => void;
}

/** Red BLOCKED tag plus the open issues that block this one. Renders nothing when unblocked. */
const BlockedTag: FC<BlockedTagProps> = ({
  blockedBy,
  openBlockerCount,
  repoNwo,
  variant,
  onSelectBlocker,
}) => {
  const total = Math.max(openBlockerCount, blockedBy.length);
  if (total === 0) return null;

  const refLabel = (b: GithubIssueRef) =>
    !b.repoNwo || b.repoNwo === repoNwo ? `#${b.number}` : `${b.repoNwo}#${b.number}`;
  const hidden = total - blockedBy.length;
  const tag = (
    <span
      className="shrink-0 px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/50"
      title={`Blocked by ${total} open issue${total === 1 ? "" : "s"}`}
    >
      BLOCKED
    </span>
  );

  if (variant === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-1 mt-1.5 text-[10px] font-mono">
        {tag}
        <span className="text-[#8b949e]">by</span>
        {blockedBy.map((b) => (
          <button
            key={`${b.repoNwo}#${b.number}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectBlocker(b);
            }}
            className="text-[#ff7b72] hover:text-white hover:underline"
            title={b.title}
          >
            {refLabel(b)}
          </button>
        ))}
        {hidden > 0 && <span className="text-[#8b949e]">+{hidden} more</span>}
      </div>
    );
  }

  return (
    <div className="p-2 rounded-md bg-[#f85149]/10 border border-[#f85149]/30 space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] text-[#ff7b72]">
        {tag}
        <span>
          Blocked by {total} open issue{total === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="space-y-0.5">
        {blockedBy.map((b) => (
          <li key={`${b.repoNwo}#${b.number}`}>
            <button
              type="button"
              onClick={() => onSelectBlocker(b)}
              className="w-full text-left flex items-start gap-1.5 px-1.5 py-0.5 rounded text-[11px] hover:bg-[#21262d] transition-colors"
              title={b.url}
            >
              <span className="font-mono font-bold text-[#ff7b72] shrink-0">{refLabel(b)}</span>
              <span className="text-[#c9d1d9] line-clamp-1">{b.title}</span>
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li className="px-1.5 text-[10px] text-[#8b949e]">
            +{hidden} more not listed; open the issue on GitHub to see all of them
          </li>
        )}
      </ul>
    </div>
  );
};

interface LoadMoreRowProps {
  list: PagedList<unknown>;
  isLoadingMore: boolean;
  error: string | null;
  onRetry: () => void;
  sentinelRef: (node: HTMLElement | null) => void;
}

/**
 * Bottom row of a paged list. While more pages remain it is the infinite-scroll
 * sentinel ("Loading more"); once everything is in it shows the final count.
 */
const LoadMoreRow: FC<LoadMoreRowProps> = ({ list, isLoadingMore, error, onRetry, sentinelRef }) => {
  if (list.items.length === 0 && !list.hasNextPage) return null;
  const count = loadedCountLabel(list);

  if (list.hasNextPage && error) {
    return (
      <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-[#8b949e]">
        <span className="text-[#ff7b72] line-clamp-1" title={error}>
          Couldn't load more
        </span>
        <span className="font-mono">({count})</span>
        <button
          type="button"
          onClick={onRetry}
          className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-white font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (list.hasNextPage) {
    return (
      <div
        ref={sentinelRef}
        className="flex items-center justify-center gap-2 py-3 text-[11px] text-[#8b949e]"
      >
        <RotateCw className={`w-3.5 h-3.5 text-[#58a6ff] ${isLoadingMore ? "animate-spin" : ""}`} />
        <span>Loading more</span>
        <span className="font-mono">({count})</span>
      </div>
    );
  }

  return <div className="py-3 text-center text-[11px] text-[#8b949e] font-mono">{count}</div>;
};

interface GithubCompanionDrawerProps {
  isOpen: boolean;
  repoPath: string;
  projectName: string;
  onClose: () => void;
  onImplementIssue: (issue: GithubIssue, workflowOverride?: string) => void;
  onTriageIssue: (issue: GithubIssue, workflowOverride?: string) => void;
  onCreateWorktreeForIssue: (issue: GithubIssue) => void;
  onResolvePrConflicts?: (pr: GithubPullRequest) => void;
  onOpenArchonMonitor?: () => void;
}

export const GithubCompanionDrawer: FC<GithubCompanionDrawerProps> = ({
  isOpen,
  repoPath,
  projectName,
  onClose,
  onImplementIssue,
  onTriageIssue,
  onCreateWorktreeForIssue,
  onResolvePrConflicts,
  onOpenArchonMonitor,
}) => {
  const [activeTab, setActiveTab] = useState<"issues" | "prs">("issues");
  const [repoInfo, setRepoInfo] = useState<GithubRepoInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archonWorkflows, setArchonWorkflows] = useState<ArchonWorkflow[]>([]);
  const [archonRuns, setArchonRuns] = useState<ArchonRun[]>([]);
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string>("all");
  const [issueStateFilter, setIssueStateFilter] = useState<"open" | "closed" | "all">("open");
  const [prStateFilter, setPrStateFilter] = useState<"open" | "closed" | "all">("open");

  // Issues and PRs load a page at a time; scrolling to the bottom fetches the next page
  const issuePages = usePagedGithubList<GithubIssue>("list_github_issues", repoPath, issueStateFilter);
  const prPages = usePagedGithubList<GithubPullRequest>("list_github_prs", repoPath, prStateFilter);
  const issues = issuePages.list.items;
  const prs = prPages.list.items;
  const { loadFirstPage: loadFirstIssuePage } = issuePages;
  const { loadFirstPage: loadFirstPrPage } = prPages;
  const issueSentinelRef = useLoadMoreSentinel(issuePages.loadMore, issues.length);
  const prSentinelRef = useLoadMoreSentinel(prPages.loadMore, prs.length);

  // Selected issue detail
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(null);
  const [issueDetail, setIssueDetail] = useState<GithubIssueDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch repo info, issues, and PRs
  const refreshData = useCallback(async () => {
    if (!repoPath) return;
    setIsLoading(true);
    setError(null);

    try {
      // Check repo info
      const info = await invoke<GithubRepoInfo | null>("get_github_repo_info", {
        repoPath,
      });
      setRepoInfo(info);

      // Load the first page of issues and PRs; later pages load on scroll
      await loadFirstIssuePage();
      await loadFirstPrPage();

      // Load Archon workflows & runs (best-effort)
      try {
        const [wfs, rns] = await Promise.all([
          invoke<ArchonWorkflow[]>("archon_get_workflows").catch(() => []),
          invoke<ArchonRun[]>("archon_get_runs").catch(() => []),
        ]);
        setArchonWorkflows(wfs || []);
        setArchonRuns(rns || []);
      } catch {
        // Archon not running or not installed
      }
    } catch (err: any) {
      console.error("Failed to load GitHub data:", err);
      setError(err?.toString() || "Failed to load GitHub data via gh CLI");
    } finally {
      setIsLoading(false);
    }
  }, [repoPath, loadFirstIssuePage, loadFirstPrPage]);

  useEffect(() => {
    if (isOpen) {
      refreshData();
    }
  }, [isOpen, refreshData]);

  // Fetch detailed issue description when an issue is selected
  useEffect(() => {
    if (!selectedIssueNumber || !repoPath) {
      setIssueDetail(null);
      return;
    }

    let isCancelled = false;
    setIsLoadingDetail(true);

    invoke<GithubIssueDetail>("get_github_issue", {
      repoPath,
      issueNumber: selectedIssueNumber,
    })
      .then((detail) => {
        if (!isCancelled) setIssueDetail(detail);
      })
      .catch((err) => {
        console.error("Failed to fetch issue detail:", err);
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingDetail(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedIssueNumber, repoPath]);

  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose });

  // Available label filters
  const allLabels = useMemo(() => {
    const labelSet = new Set<string>();
    issues.forEach((i) => i.labels.forEach((l) => labelSet.add(l.name)));
    return Array.from(labelSet);
  }, [issues]);

  // Filtered issues
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (selectedLabel !== "all" && !issue.labels.some((l) => l.name === selectedLabel)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNum = issue.number.toString().includes(q);
        const matchesTitle = issue.title.toLowerCase().includes(q);
        const matchesLabel = issue.labels.some((l) => l.name.toLowerCase().includes(q));
        return matchesNum || matchesTitle || matchesLabel;
      }
      return true;
    });
  }, [issues, selectedLabel, searchQuery]);

  // Filtered PRs
  const filteredPrs = useMemo(() => {
    if (!searchQuery.trim()) return prs;
    const q = searchQuery.toLowerCase();
    return prs.filter(
      (pr) =>
        pr.number.toString().includes(q) ||
        pr.title.toLowerCase().includes(q) ||
        pr.headRefName.toLowerCase().includes(q)
    );
  }, [prs, searchQuery]);

  // Active Archon run for currently selected issue
  const activeRunForIssue = useMemo(() => {
    if (!issueDetail) return null;
    const issueNumStr = issueDetail.number.toString();
    return archonRuns.find(
      (r) =>
        (r.status === "running" || r.status === "paused") &&
        (r.user_message?.includes(`#${issueNumStr}`) ||
          r.user_message?.includes(issueNumStr) ||
          r.working_path?.includes(`ticket-${issueNumStr}`) ||
          r.working_path?.includes(`issue-${issueNumStr}`))
    );
  }, [archonRuns, issueDetail]);

  if (!isOpen) return null;

  // URLs come from issue data, so only web links reach the system opener
  const handleOpenBrowser = (url: string) => {
    if (/^https?:\/\//i.test(url)) {
      openUrl(url).catch(console.error);
    }
  };

  // Same-repo blockers open in the detail panel; blockers in other repos open on GitHub
  const handleSelectBlocker = (blocker: GithubIssueRef) => {
    if (!blocker.repoNwo || blocker.repoNwo === repoInfo?.nwo) {
      setSelectedIssueNumber(blocker.number);
    } else {
      handleOpenBrowser(blocker.url);
    }
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        {...panelProps}
        aria-label="GitHub Companion"
        className={`focus:outline-hidden bg-[#0d1117] border-l border-[#30363d] shadow-2xl flex flex-col h-full transition-all duration-200 ${
          isExpanded ? "w-full" : "w-full max-w-4xl"
        }`}
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-md bg-[#21262d] text-white border border-[#30363d]">
              <GithubIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">GitHub Companion</h2>
                {repoInfo ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono font-medium">
                    {repoInfo.nwo}
                  </span>
                ) : (
                  <span className="text-xs text-[#8b949e] font-mono">{projectName}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenArchonMonitor && (
              <button
                type="button"
                onClick={onOpenArchonMonitor}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#a371f7] bg-[#a371f7]/10 hover:bg-[#a371f7]/20 border border-[#a371f7]/30 rounded font-medium transition-colors"
                title="Open Archon Run Monitor (Ctrl+Shift+B r)"
              >
                <Workflow className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Archon Monitor</span>
              </button>
            )}
            <button
              type="button"
              onClick={refreshData}
              disabled={isLoading}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors disabled:opacity-50"
              title="Refresh issues and pull requests"
            >
              <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#58a6ff]" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
              title={isExpanded ? "Restore width" : "Maximize drawer"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab & Filter Bar */}
        <div className="px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("issues")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors ${
                activeTab === "issues"
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5 text-[#3fb950]" />
              <span>Issues</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#0d1117] text-[#8b949e] font-mono">
                {issues.length}
                {issuePages.list.hasNextPage ? "+" : ""}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("prs")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors ${
                activeTab === "prs"
                  ? "bg-[#21262d] text-white shadow-xs"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              <GitPullRequest className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>Pull Requests</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#0d1117] text-[#8b949e] font-mono">
                {prs.length}
                {prPages.list.hasNextPage ? "+" : ""}
              </span>
            </button>

            <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5 ml-2">
              <button
                type="button"
                onClick={() => {
                  if (activeTab === "issues") setIssueStateFilter("open");
                  else setPrStateFilter("open");
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  (activeTab === "issues" ? issueStateFilter : prStateFilter) === "open"
                    ? "bg-[#21262d] text-white"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeTab === "issues") setIssueStateFilter("all");
                  else setPrStateFilter("all");
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  (activeTab === "issues" ? issueStateFilter : prStateFilter) === "all"
                    ? "bg-[#21262d] text-white"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                All
              </button>
            </div>
          </div>

          {/* Search box */}
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by title, #, or label..."
              className="w-full pl-8 pr-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#8b949e] focus:outline-hidden focus:border-[#58a6ff]"
            />
          </div>
        </div>

        {/* Quick Label Pills (for Issues) */}
        {activeTab === "issues" && allLabels.length > 0 && (
          <div className="px-4 py-1.5 bg-[#0d1117] border-b border-[#30363d]/60 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
            <span className="text-[#8b949e] shrink-0">Label:</span>
            <button
              type="button"
              onClick={() => setSelectedLabel("all")}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors shrink-0 ${
                selectedLabel === "all"
                  ? "bg-[#21262d] text-white font-semibold"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              All
            </button>
            {allLabels.map((lbl) => (
              <button
                key={lbl}
                type="button"
                onClick={() => setSelectedLabel(lbl)}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors shrink-0 ${
                  selectedLabel === lbl
                    ? "bg-[#21262d] text-[#58a6ff] border-[#58a6ff]/50 font-semibold"
                    : "bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-white"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-[#f85149]" />
              <div className="text-sm font-semibold text-white">GitHub CLI Communication Error</div>
              <p className="text-xs text-[#8b949e] max-w-md">{error}</p>
              <button
                type="button"
                onClick={refreshData}
                className="px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-white text-xs font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          ) : activeTab === "issues" ? (
            /* Issues Split: Left List & Right Detail */
            <div className="flex-1 flex min-h-0 divide-x divide-[#30363d]">
              {/* Issues List Column */}
              <div className="w-1/2 overflow-y-auto divide-y divide-[#30363d]/40 p-2 space-y-1">
                {filteredIssues.length === 0 ? (
                  <div className="py-16 text-center text-xs text-[#8b949e]">
                    No issues found
                  </div>
                ) : (
                  filteredIssues.map((issue) => {
                    const isSelected = issue.number === selectedIssueNumber;
                    return (
                      <div
                        key={issue.number}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedIssueNumber(issue.number)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            setSelectedIssueNumber(issue.number);
                          }
                        }}
                        className={`p-3 rounded-md cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[#21262d] border border-[#58a6ff]/40 text-white"
                            : "text-[#c9d1d9] hover:bg-[#161b22]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-bold text-[#58a6ff]">
                              #{issue.number}
                            </span>
                            <span className="text-xs font-semibold text-white line-clamp-1">
                              {issue.title}
                            </span>
                          </div>
                        </div>

                        <BlockedTag
                          blockedBy={issue.blockedBy ?? []}
                          openBlockerCount={issue.openBlockerCount ?? 0}
                          repoNwo={repoInfo?.nwo}
                          variant="compact"
                          onSelectBlocker={handleSelectBlocker}
                        />

                        {/* Labels */}
                        {issue.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {issue.labels.map((lbl) => (
                              <span
                                key={lbl.name}
                                className="px-1.5 py-0.2 rounded text-[10px] font-medium font-mono"
                                style={{
                                  backgroundColor: lbl.color ? `#${lbl.color}25` : "#30363d",
                                  color: lbl.color ? `#${lbl.color}` : "#c9d1d9",
                                  border: `1px solid ${lbl.color ? `#${lbl.color}40` : "#30363d"}`,
                                }}
                              >
                                {lbl.name}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] text-[#8b949e] mt-2 font-mono">
                          <span>by @{issue.author?.login || "unknown"}</span>
                          <span>{new Date(issue.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                <LoadMoreRow
                  list={issuePages.list}
                  isLoadingMore={issuePages.isLoadingMore}
                  error={issuePages.loadMoreError}
                  onRetry={issuePages.loadMore}
                  sentinelRef={issueSentinelRef}
                />
              </div>

              {/* Issue Detail & Action Panel */}
              <div className="w-1/2 flex flex-col bg-[#0d1117] overflow-hidden">
                {selectedIssueNumber ? (
                  isLoadingDetail && !issueDetail ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-[#8b949e]">
                      <RotateCw className="w-4 h-4 animate-spin text-[#58a6ff] mr-2" />
                      Loading issue #{selectedIssueNumber}...
                    </div>
                  ) : issueDetail ? (
                    <div className="flex-1 flex flex-col min-h-0">
                      {/* Detail Header */}
                      <div className="p-4 border-b border-[#30363d] bg-[#161b22] space-y-2 shrink-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-mono font-bold text-[#58a6ff] mr-2">
                              #{issueDetail.number}
                            </span>
                            <h3 className="text-sm font-bold text-white inline">
                              {issueDetail.title}
                            </h3>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleOpenBrowser(issueDetail.url)}
                            className="p-1 text-[#8b949e] hover:text-white rounded"
                            title="Open on GitHub"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>

                        <BlockedTag
                          blockedBy={issueDetail.blockedBy ?? []}
                          openBlockerCount={issueDetail.openBlockerCount ?? 0}
                          repoNwo={repoInfo?.nwo}
                          variant="full"
                          onSelectBlocker={handleSelectBlocker}
                        />

                        {/* Active Archon Run Status Banner */}
                        {activeRunForIssue && (
                          <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-[#a371f7]/15 border border-[#a371f7]/40 text-xs">
                            <div className="flex items-center gap-2 text-[#d2a8ff]">
                              <span className="w-2 h-2 rounded-full bg-[#3fb950] animate-pulse" />
                              <span className="font-semibold font-mono">Archon Run Active</span>
                              <span className="text-[#8b949e] font-mono text-[11px]">
                                ({activeRunForIssue.workflow_name})
                              </span>
                            </div>
                            {onOpenArchonMonitor && (
                              <button
                                type="button"
                                onClick={onOpenArchonMonitor}
                                className="flex items-center gap-1 text-[11px] text-[#58a6ff] hover:underline"
                              >
                                <span>Monitor</span>
                                <span>→</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* 1-Click Agent Action Dispatch Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => onImplementIssue(issueDetail)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold shadow-xs transition-colors"
                            title="Launch Archon implementation workflow in dedicated terminal pane"
                          >
                            <Zap className="w-3.5 h-3.5 fill-current text-white" />
                            <span>Implement with Archon</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onTriageIssue(issueDetail)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] text-xs font-medium transition-colors"
                            title="Run Archon triage workflow on this issue"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Archon Triage</span>
                          </button>

                          {/* Workflows Dropdown */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowWorkflowMenu((prev) => !prev)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] text-xs font-medium transition-colors"
                              title="Select and run any installed Archon workflow for this issue"
                            >
                              <Workflow className="w-3.5 h-3.5" />
                              <span>Workflows</span>
                              <ChevronDown className="w-3 h-3 opacity-60" />
                            </button>
                            {showWorkflowMenu && (
                              <div className="absolute left-0 mt-1 w-72 bg-[#161b22] border border-[#30363d] rounded-md shadow-2xl py-1 z-50 text-xs divide-y divide-[#30363d]/50 max-h-72 overflow-y-auto">
                                <div className="px-3 py-1.5 text-[10px] text-[#8b949e] uppercase font-mono font-bold tracking-wider">
                                  Run Workflow on #{issueDetail.number}
                                </div>
                                <div className="py-1">
                                  {archonWorkflows.length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-[#8b949e]">
                                      No workflows discovered. Is Archon running?
                                    </div>
                                  ) : (
                                    archonWorkflows.map((wf) => (
                                      <button
                                        key={wf.id || wf.name}
                                        type="button"
                                        onClick={() => {
                                          setShowWorkflowMenu(false);
                                          onImplementIssue(issueDetail, wf.id || wf.name);
                                        }}
                                        className="w-full text-left px-3 py-2 hover:bg-[#21262d] text-white flex flex-col gap-0.5 transition-colors"
                                      >
                                        <span className="font-mono text-[#58a6ff] font-medium">
                                          {wf.name}
                                        </span>
                                        {wf.description && (
                                          <span className="text-[10px] text-[#8b949e] line-clamp-2">
                                            {wf.description}
                                          </span>
                                        )}
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => onCreateWorktreeForIssue(issueDetail)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-xs font-medium transition-colors"
                            title="Create dedicated git worktree branch"
                          >
                            <GitBranch className="w-3.5 h-3.5" />
                            <span>Worktree</span>
                          </button>
                        </div>
                      </div>

                      {/* Body Markdown Preview */}
                      <div className="flex-1 overflow-y-auto p-4 text-xs text-[#c9d1d9] leading-relaxed select-text space-y-2">
                        <pre className="whitespace-pre-wrap font-sans text-xs bg-[#161b22] p-3 rounded-md border border-[#30363d] text-[#c9d1d9]">
                          {issueDetail.body || "(No description provided)"}
                        </pre>
                      </div>
                    </div>
                  ) : null
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-[#8b949e] space-y-2">
                    <AlertCircle className="w-8 h-8 text-[#30363d]" />
                    <p>Select an issue to inspect details and dispatch autonomous agents</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Pull Requests List */
            <div className="flex-1 overflow-y-auto divide-y divide-[#30363d]/40 p-3 space-y-2">
              {filteredPrs.length === 0 ? (
                <div className="py-16 text-center text-xs text-[#8b949e]">
                  No pull requests found
                </div>
              ) : (
                filteredPrs.map((pr) => {
                  const hasConflict = pr.mergeable === "CONFLICTING";
                  return (
                    <div
                      key={pr.number}
                      className="p-3 bg-[#161b22] border border-[#30363d] rounded-md space-y-2 hover:border-[#58a6ff]/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <GitPullRequest
                            className={`w-4 h-4 shrink-0 ${
                              pr.state === "OPEN" ? "text-[#3fb950]" : "text-[#8b949e]"
                            }`}
                          />
                          <span className="text-xs font-mono font-bold text-[#58a6ff]">
                            #{pr.number}
                          </span>
                          <span className="text-xs font-semibold text-white">{pr.title}</span>
                          {pr.isDraft && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#30363d] text-[#8b949e] font-mono">
                              Draft
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenBrowser(pr.url)}
                          className="p-1 text-[#8b949e] hover:text-white rounded"
                          title="Open PR on GitHub"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-mono pt-1">
                        <div className="flex items-center gap-1.5">
                          <GitBranch className="w-3 h-3 text-[#58a6ff]" />
                          <span className="text-[#c9d1d9]">{pr.headRefName}</span>
                          <span>→</span>
                          <span>{pr.baseRefName}</span>
                        </div>

                        {hasConflict && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#f85149]/20 text-[#ff7b72] font-semibold border border-[#f85149]/30">
                              CONFLICT
                            </span>
                            {onResolvePrConflicts && (
                              <button
                                type="button"
                                onClick={() => onResolvePrConflicts(pr)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#a371f7]/15 hover:bg-[#a371f7]/25 text-[#d2a8ff] hover:text-white text-[11px] font-medium border border-[#a371f7]/30 transition-colors"
                                title="Run Archon PR conflict resolution workflow"
                              >
                                <Zap className="w-3 h-3 text-[#d2a8ff]" />
                                Resolve with Archon
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <LoadMoreRow
                list={prPages.list}
                isLoadingMore={prPages.isLoadingMore}
                error={prPages.loadMoreError}
                onRetry={prPages.loadMore}
                sentinelRef={prSentinelRef}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
