import { useState, useEffect, useMemo, useRef, useId, FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock,
  Cpu,
  ListTree,
  MessageSquare,
  Play,
  Repeat,
  RotateCw,
  ShieldQuestion,
  StopCircle,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  User,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import {
  ArchonChatMessage,
  ArchonLogEntry,
  ArchonNodeState,
  ArchonPlanNode,
  ArchonRun,
  ArchonRunAction,
  ArchonRunDetail,
  ArchonWorkflow,
} from "./types";
import { computeDagLayout, COMPACT_DAG_SIZING } from "./dagLayout";
import { formatClock, formatDateTime, formatDuration, formatRelative } from "../../lib/dates";

const POLL_MS = 3000;
const ACTIVE_STATUSES = new Set(["running", "pending", "paused"]);

interface ArchonRunMonitorProps {
  runs: ArchonRun[];
  workflows: ArchonWorkflow[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  serviceOnline: boolean;
}

type LogFilter = "all" | "node" | "tool" | "task" | "issues";

const LOG_FILTERS: { key: LogFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "node", label: "Nodes" },
  { key: "tool", label: "Tools" },
  { key: "task", label: "Tasks" },
  { key: "issues", label: "Issues" },
];

/** Status chip styles. Each state also carries a text label, so color is never the only cue. */
const STATUS_STYLE: Record<string, { chip: string; dot: string; label: string }> = {
  running: { chip: "bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]/50", dot: "bg-[#58a6ff] animate-pulse", label: "Running" },
  pending: { chip: "bg-[#30363d] text-[#c9d1d9] border-[#484f58]", dot: "bg-[#8b949e]", label: "Pending" },
  paused: { chip: "bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/50", dot: "bg-[#e3b341] animate-pulse", label: "Awaiting approval" },
  completed: { chip: "bg-[#238636]/20 text-[#3fb950] border-[#238636]/50", dot: "bg-[#3fb950]", label: "Completed" },
  failed: { chip: "bg-[#f85149]/15 text-[#ff7b72] border-[#f85149]/50", dot: "bg-[#f85149]", label: "Failed" },
  cancelled: { chip: "bg-[#30363d] text-[#8b949e] border-[#484f58]", dot: "bg-[#6e7681]", label: "Cancelled" },
};
const statusStyle = (status: string) =>
  STATUS_STYLE[status] ?? { chip: "bg-[#30363d] text-[#c9d1d9] border-[#484f58]", dot: "bg-[#8b949e]", label: status };

/** Node card styles keyed by node run state; `undefined` means not reached yet. */
const NODE_STYLE: Record<string, { card: string; badge: string; label: string }> = {
  running: {
    card: "bg-[#1c2128] border-[#e3b341] ring-2 ring-[#e3b341]/40 shadow-lg",
    badge: "bg-[#e3b341]/20 text-[#e3b341] border-[#e3b341]/50 animate-pulse",
    label: "RUNNING",
  },
  completed: { card: "bg-[#161b22] border-[#238636]", badge: "bg-[#238636]/20 text-[#3fb950] border-[#238636]/40", label: "DONE" },
  failed: { card: "bg-[#161b22] border-[#f85149] ring-1 ring-[#f85149]/40", badge: "bg-[#f85149]/20 text-[#ff7b72] border-[#f85149]/40", label: "FAILED" },
  skipped: { card: "bg-[#0d1117] border-dashed border-[#30363d] opacity-60", badge: "bg-[#21262d] text-[#8b949e] border-[#30363d]", label: "SKIPPED" },
  cancelled: { card: "bg-[#0d1117] border-[#484f58] opacity-75", badge: "bg-[#21262d] text-[#8b949e] border-[#30363d]", label: "STOPPED" },
};
const PENDING_NODE = { card: "bg-[#0d1117] border-[#30363d]", badge: "bg-[#21262d] text-[#6e7681] border-[#30363d]", label: "WAITING" };

/** "owner/lril-sdlc:implement" -> "lril-sdlc:implement" */
const shortWorkflow = (name: string) => name.split("/").pop() || name;

const formatTokens = (n?: number | null) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export const ArchonRunMonitor: FC<ArchonRunMonitorProps> = ({
  runs,
  workflows,
  selectedRunId,
  onSelectRun,
  serviceOnline,
}) => {
  const [detail, setDetail] = useState<ArchonRunDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [includeHooks, setIncludeHooks] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [nodeFilter, setNodeFilter] = useState<string | null>(null);
  const [followLog, setFollowLog] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [actionBusy, setActionBusy] = useState<ArchonRunAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalComment, setApprovalComment] = useState("");
  const requestSeq = useRef(0);
  const approvalInputId = useId();
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Running runs first, then newest first
  const sortedRuns = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const aActive = ACTIVE_STATUSES.has(a.status) ? 1 : 0;
        const bActive = ACTIVE_STATUSES.has(b.status) ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return (b.started_ms ?? 0) - (a.started_ms ?? 0);
      }),
    [runs]
  );

  // Re-fetch when the run list reports a status change (e.g. resumed elsewhere)
  const listedStatus = runs.find((r) => r.id === selectedRunId)?.status;

  // Poll the selected run while it is active; a finished run is fetched once.
  // Requests are chained (never overlapping) and stale responses are dropped.
  useEffect(() => {
    if (!selectedRunId || !serviceOnline) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const seq = ++requestSeq.current;
    setDetail((prev) => (prev?.run.id === selectedRunId ? prev : null));
    setLoadError(null);

    const tick = async () => {
      try {
        const d = await invoke<ArchonRunDetail>("archon_get_run_detail", {
          runId: selectedRunId,
          includeHooks,
        });
        if (cancelled || seq !== requestSeq.current) return;
        setDetail(d);
        setLoadError(null);
        if (ACTIVE_STATUSES.has(d.run.status)) timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled || seq !== requestSeq.current) return;
        setLoadError(String(err));
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selectedRunId, includeHooks, refreshNonce, listedStatus, serviceOnline]);

  // Reset per-run view state when switching runs
  useEffect(() => {
    setNodeFilter(null);
    setActionError(null);
    setApprovalComment("");
    setFollowLog(true);
  }, [selectedRunId]);

  const run = detail?.run.id === selectedRunId ? detail.run : runs.find((r) => r.id === selectedRunId) ?? null;
  const isActive = run ? ACTIVE_STATUSES.has(run.status) : false;

  // Graph: the workflow's plan when known, else the nodes the run reported
  const planNodes: ArchonPlanNode[] = useMemo(() => {
    const wf = workflows.find((w) => w.name === run?.workflow_name);
    if (wf?.plan?.nodes?.length) return wf.plan.nodes;
    return (detail?.nodes ?? [])
      .filter((n) => !n.node_id.includes("."))
      .map((n) => ({ id: n.node_id }));
  }, [workflows, run?.workflow_name, detail?.nodes]);

  const layout = useMemo(() => computeDagLayout(planNodes, 120, COMPACT_DAG_SIZING), [planNodes]);
  const graphRef = useRef<HTMLDivElement>(null);
  const nodeStates = useMemo(() => {
    const m = new Map<string, ArchonNodeState>();
    (detail?.nodes ?? []).forEach((n) => m.set(n.node_id, n));
    return m;
  }, [detail?.nodes]);
  const childStates = (id: string) => (detail?.nodes ?? []).filter((n) => n.node_id.startsWith(`${id}.`));

  // Keep "where we are" in view: the running node, else the node that failed. Jump
  // instantly on a newly opened run and glide as a live run advances.
  const focusKey = useMemo(() => {
    if (detail?.run.id !== selectedRunId) return "";
    const running = detail?.active_nodes ?? [];
    if (running.length > 0) return running.join(",");
    return (detail?.nodes ?? []).filter((n) => n.state === "failed").map((n) => n.node_id).join(",");
  }, [detail, selectedRunId]);
  const scrolledRunRef = useRef<string | null>(null);
  useEffect(() => {
    const el = graphRef.current;
    if (!el || !selectedRunId || detail?.run.id !== selectedRunId) return;
    const firstVisit = scrolledRunRef.current !== selectedRunId;
    scrolledRunRef.current = selectedRunId;
    const ids = focusKey ? focusKey.split(",") : [];
    const target = layout.nodesWithCoords.find((n) => ids.includes(n.id));
    if (!target) {
      if (firstVisit) el.scrollTo({ left: 0, top: 0 });
      return;
    }
    const left = target.x + target.width / 2 - el.clientWidth / 2;
    const top = target.y + target.height / 2 - el.clientHeight / 2;
    el.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: firstVisit ? "auto" : "smooth" });
  }, [focusKey, layout, selectedRunId, detail?.run.id]);

  const visibleLogs = useMemo(() => {
    const logs = detail?.logs ?? [];
    return logs.filter((l) => {
      if (nodeFilter && !(l.node_id === nodeFilter || l.node_id?.startsWith(`${nodeFilter}.`))) return false;
      if (logFilter === "all") return true;
      if (logFilter === "issues") return l.status === "failed" || l.kind === "error" || l.kind === "warning";
      return l.kind === logFilter;
    });
  }, [detail?.logs, logFilter, nodeFilter]);

  // Keep the log pinned to the newest entry while following
  useEffect(() => {
    if (followLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visibleLogs, followLog]);

  // Chat sticks to the bottom unless the reader scrolled up
  const chatPinned = useRef(true);
  useEffect(() => {
    if (chatPinned.current && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [detail?.messages]);

  const runAction = async (action: ArchonRunAction) => {
    if (!run) return;
    if (action === "cancel" && !window.confirm(`Cancel run ${run.id.slice(0, 8)} (${shortWorkflow(run.workflow_name)})?`)) return;
    if (action === "abandon" && !window.confirm(`Abandon run ${run.id.slice(0, 8)}? It cannot be resumed afterwards.`)) return;
    setActionBusy(action);
    setActionError(null);
    try {
      await invoke("archon_run_action", {
        runId: run.id,
        action,
        text: action === "approve" || action === "reject" ? approvalComment : null,
      });
      setApprovalComment("");
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionBusy(null);
    }
  };

  if (!serviceOnline) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[#8b949e]">
        <StopCircle className="w-10 h-10 text-[#30363d] mb-3" />
        <h3 className="text-sm font-semibold text-white mb-1">Archon web server is offline</h3>
        <p className="text-xs max-w-md">
          The live run monitor reads the Archon server (default port 3090). Start it with{" "}
          <code className="font-mono text-[#c9d1d9]">archon serve</code>, then refresh.
        </p>
      </div>
    );
  }

  const elapsedMs =
    run?.started_ms != null ? (run.completed_ms ?? (isActive ? Date.now() : detail?.last_activity_ms ?? Date.now())) - run.started_ms : null;

  return (
    <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
      {/* Run list */}
      <aside className="w-[280px] shrink-0 border-r border-[#30363d] bg-[#0d1117] flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-[#30363d] text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] flex items-center justify-between">
          <span>Runs</span>
          <span className="font-mono normal-case">{runs.length} recent</span>
        </div>
        <nav aria-label="Archon runs" className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {sortedRuns.length === 0 && (
            <p className="p-3 text-xs text-[#8b949e]">No runs yet. Start one from the Workflow DAGs tab.</p>
          )}
          {sortedRuns.map((r) => {
            const st = statusStyle(r.status);
            const selected = r.id === selectedRunId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRun(r.id)}
                aria-current={selected ? "true" : undefined}
                className={`w-full text-left p-2 rounded-md border transition-colors ${
                  selected ? "bg-[#161b22] border-[#58a6ff]/50" : "border-transparent hover:bg-[#161b22]"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} aria-hidden="true" />
                  <span className="font-mono text-[11px] font-semibold text-white truncate">
                    {shortWorkflow(r.workflow_name)}
                  </span>
                  <span className="ml-auto text-[10px] text-[#8b949e] shrink-0">{st.label}</span>
                </div>
                {r.user_message && (
                  <p className="mt-0.5 text-[11px] text-[#8b949e] line-clamp-2" title={r.user_message}>
                    {r.user_message}
                  </p>
                )}
                <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-[#6e7681]">
                  <span>{r.started_ms != null ? formatRelative(r.started_ms) : r.id.slice(0, 8)}</span>
                  {r.nodes_total != null && (
                    <span>
                      {r.nodes_completed ?? 0}/{r.nodes_total}
                    </span>
                  )}
                  {r.total_cost_usd != null && <span className="text-[#c9d1d9]">${r.total_cost_usd.toFixed(2)}</span>}
                </div>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Run detail */}
      {!run ? (
        <div className="flex-1 flex items-center justify-center text-xs text-[#8b949e]">
          Select a run to watch its graph, log and conversation.
        </div>
      ) : (
        <section className="flex-1 flex flex-col min-w-0 min-h-0" aria-label={`Run ${run.id}`}>
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-[#30363d] bg-[#161b22] flex items-start justify-between gap-4 shrink-0">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-mono text-sm font-bold text-white truncate">{run.workflow_name}</h3>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusStyle(run.status).chip}`}>
                  {statusStyle(run.status).label}
                </span>
                {run.outcome && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262d] text-[#c9d1d9] border border-[#30363d]">
                    outcome: {run.outcome}
                  </span>
                )}
                {isActive && detail && detail.active_nodes.length > 0 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#e3b341]/15 text-[#e3b341] border border-[#e3b341]/40">
                    at: {detail.active_nodes.join(", ")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-[#8b949e] flex-wrap">
                <span title={run.id}>#{run.id.slice(0, 8)}</span>
                {run.codebase_name && <span className="text-[#c9d1d9]">{run.codebase_name}</span>}
                {run.started_ms != null && (
                  <span title={formatDateTime(run.started_ms)}>
                    <Clock className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                    started {formatRelative(run.started_ms)}
                  </span>
                )}
                {elapsedMs != null && <span>{isActive ? "running" : "took"} {formatDuration(elapsedMs)}</span>}
                {run.nodes_total != null && (
                  <span>
                    {run.nodes_completed ?? 0}/{run.nodes_total} nodes
                  </span>
                )}
                {detail?.tokens_out != null && (
                  <span>
                    {formatTokens(detail.tokens_in)} in · {formatTokens(detail.tokens_out)} out
                  </span>
                )}
                {run.total_cost_usd != null && <span className="text-white font-semibold">${run.total_cost_usd.toFixed(2)}</span>}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {isActive && (
                <button
                  type="button"
                  onClick={() => runAction("cancel")}
                  disabled={actionBusy !== null}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#21262d] hover:bg-[#f85149]/20 text-[#ff7b72] border border-[#30363d] disabled:opacity-50 transition-colors"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>{actionBusy === "cancel" ? "Cancelling…" : "Cancel"}</span>
                </button>
              )}
              {run.status === "failed" && (
                <>
                  <button
                    type="button"
                    onClick={() => runAction("resume")}
                    disabled={actionBusy !== null}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white disabled:opacity-50 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{actionBusy === "resume" ? "Resuming…" : "Resume"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction("abandon")}
                    disabled={actionBusy !== null}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] border border-[#30363d] disabled:opacity-50 transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Abandon</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setRefreshNonce((n) => n + 1)}
                aria-label="Refresh run"
                title={detail ? `Updated ${formatClock(detail.fetched_at_ms)}` : "Refresh run"}
                className="p-1.5 rounded-md text-[#8b949e] hover:text-white hover:bg-[#21262d] transition-colors"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isActive ? "text-[#58a6ff]" : ""}`} />
              </button>
            </div>
          </div>

          {/* Banners */}
          {detail?.pending_approval && (
            <div className="px-4 py-2.5 border-b border-[#d29922]/40 bg-[#d29922]/10 shrink-0 space-y-2" role="region" aria-label="Approval gate">
              <div className="flex items-start gap-2 text-xs text-[#e3b341]">
                <ShieldQuestion className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-semibold">
                    Waiting for approval{detail.pending_approval.node_id ? ` at ${detail.pending_approval.node_id}` : ""}
                  </p>
                  <p className="text-[#c9d1d9] whitespace-pre-wrap">{detail.pending_approval.prompt}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={approvalInputId} className="sr-only">
                  Comment for the approval decision
                </label>
                <input
                  id={approvalInputId}
                  type="text"
                  value={approvalComment}
                  onChange={(e) => setApprovalComment(e.target.value)}
                  placeholder="Optional comment"
                  maxLength={4000}
                  className="flex-1 px-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#6e7681] focus:outline-hidden focus:border-[#e3b341]"
                />
                <button
                  type="button"
                  onClick={() => runAction("approve")}
                  disabled={actionBusy !== null}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white disabled:opacity-50"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  <span>Approve</span>
                </button>
                <button
                  type="button"
                  onClick={() => runAction("reject")}
                  disabled={actionBusy !== null}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[#21262d] hover:bg-[#f85149]/20 text-[#ff7b72] border border-[#30363d] disabled:opacity-50"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>
              </div>
            </div>
          )}
          {(actionError || loadError) && (
            <div className="px-4 py-1.5 border-b border-[#f85149]/30 bg-[#f85149]/10 text-[11px] text-[#ff7b72] flex items-center justify-between shrink-0">
              <span className="truncate">{actionError || loadError}</span>
              {actionError && (
                <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error" className="p-0.5 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          {detail?.error && (
            <div className="px-4 py-1.5 border-b border-[#f85149]/30 bg-[#0d1117] text-[11px] text-[#ff7b72] shrink-0 max-h-20 overflow-y-auto whitespace-pre-wrap font-mono">
              {detail.error}
            </div>
          )}

          {/* Graph */}
          <div
            ref={graphRef}
            className="shrink-0 overflow-auto bg-[#090d13] border-b border-[#30363d] relative select-none"
            style={{ height: detail ? Math.min(layout.height + 20, 300) : 140 }}
          >
            {!detail ? (
              <div className="h-full flex items-center justify-center text-xs text-[#8b949e]">
                <RotateCw className="w-4 h-4 animate-spin text-[#58a6ff] mr-2" />
                Loading run…
              </div>
            ) : (
              <div className="relative m-2" style={{ width: layout.width, height: layout.height }}>
                <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden="true">
                  <defs>
                    <marker id="run-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#484f58" />
                    </marker>
                  </defs>
                  {layout.edges.map((edge) => {
                    const fromDone = nodeStates.get(edge.fromId)?.state === "completed";
                    const toState = nodeStates.get(edge.toId)?.state;
                    const hot = fromDone && toState === "running";
                    return (
                      <path
                        key={`${edge.fromId}->${edge.toId}`}
                        d={edge.path}
                        fill="none"
                        stroke={hot ? "#e3b341" : fromDone && toState ? "#2ea043" : "#30363d"}
                        strokeWidth={hot ? 2.5 : 1.75}
                        strokeDasharray={toState ? undefined : "4,3"}
                        markerEnd="url(#run-arrow)"
                      />
                    );
                  })}
                </svg>
                {layout.nodesWithCoords.map((node) => {
                  const st = nodeStates.get(node.id);
                  const style = (st && NODE_STYLE[st.state]) || PENDING_NODE;
                  const children = childStates(node.id);
                  const isFiltered = nodeFilter === node.id;
                  const kind = node.kind || "agent";
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setNodeFilter(isFiltered ? null : node.id)}
                      aria-pressed={isFiltered}
                      title={st?.detail ?? undefined}
                      style={{ position: "absolute", left: node.x, top: node.y, width: node.width, height: node.height }}
                      className={`px-2 py-1.5 rounded-md border text-left flex flex-col justify-between transition-all ${style.card} ${
                        isFiltered ? "outline outline-2 outline-[#58a6ff] outline-offset-2" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {kind === "exec" ? (
                            <Terminal className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
                          ) : kind === "loop_group" || kind === "loop" ? (
                            <Repeat className="w-3.5 h-3.5 text-[#e3b341] shrink-0" />
                          ) : (
                            <Cpu className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />
                          )}
                          <span className="font-mono text-xs font-semibold text-white truncate">{node.id}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${style.badge}`}>{style.label}</span>
                      </div>
                      <div className="text-[10px] font-mono text-[#8b949e] flex items-center justify-between gap-1 pt-1 border-t border-[#30363d]/50">
                        <span className="truncate">
                          {st?.state === "running" && st.started_ms != null
                            ? `for ${formatDuration(Date.now() - st.started_ms)}`
                            : st?.duration_ms != null && st.state !== "skipped"
                            ? formatDuration(st.duration_ms)
                            : st?.state === "skipped"
                            ? st.detail ?? "skipped"
                            : kind}
                          {children.length > 0 &&
                            ` · ${children.map((c) => `${c.node_id.slice(node.id.length + 1)} ${c.state === "completed" ? "✓" : c.state}`).join(", ")}`}
                        </span>
                        {st?.cost_usd != null && st.cost_usd > 0 && <span className="text-[#c9d1d9] shrink-0">${st.cost_usd.toFixed(2)}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Log + chat */}
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {/* Log */}
            <div className="flex flex-col min-h-0 border-r border-[#30363d]">
              <div className="px-3 py-1.5 border-b border-[#30363d] bg-[#161b22] flex items-center gap-2 text-[11px] shrink-0 flex-wrap">
                <span className="flex items-center gap-1 font-semibold text-white">
                  <ListTree className="w-3.5 h-3.5 text-[#58a6ff]" />
                  Log
                </span>
                <div role="radiogroup" aria-label="Log filter" className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5">
                  {LOG_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      role="radio"
                      aria-checked={logFilter === f.key}
                      onClick={() => setLogFilter(f.key)}
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        logFilter === f.key ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-[#c9d1d9]"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {nodeFilter && (
                  <button
                    type="button"
                    onClick={() => setNodeFilter(null)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 font-mono text-[10px]"
                    aria-label={`Clear node filter ${nodeFilter}`}
                  >
                    {nodeFilter}
                    <X className="w-3 h-3" />
                  </button>
                )}
                <label className="ml-auto flex items-center gap-1 text-[#8b949e] cursor-pointer">
                  <input type="checkbox" checked={includeHooks} onChange={(e) => setIncludeHooks(e.target.checked)} className="accent-[#58a6ff]" />
                  hooks
                </label>
                <button
                  type="button"
                  aria-pressed={followLog}
                  onClick={() => setFollowLog((f) => !f)}
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                    followLog ? "bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]/40" : "text-[#8b949e] border-[#30363d]"
                  }`}
                >
                  Follow
                </button>
              </div>
              <div
                ref={logRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                  if (!atBottom && followLog) setFollowLog(false);
                  if (atBottom && !followLog) setFollowLog(true);
                }}
                className="flex-1 overflow-y-auto font-mono text-[11px] select-text"
              >
                {detail && (detail.logs_truncated || detail.hidden_hook_events > 0) && (
                  <p className="px-3 py-1 text-[10px] text-[#6e7681] border-b border-[#30363d]/40">
                    {detail.logs_truncated && `Showing the latest ${detail.logs.length} of ${detail.total_events} events. `}
                    {detail.hidden_hook_events > 0 && `${detail.hidden_hook_events} hook events hidden.`}
                  </p>
                )}
                {visibleLogs.length === 0 && detail && (
                  <p className="p-3 text-[#8b949e]">No log entries match this filter.</p>
                )}
                {visibleLogs.map((l) => (
                  <LogRow key={l.id} entry={l} />
                ))}
              </div>
            </div>

            {/* Chat */}
            <div className="flex flex-col min-h-0">
              <div className="px-3 py-1.5 border-b border-[#30363d] bg-[#161b22] flex items-center gap-1.5 text-[11px] shrink-0">
                <MessageSquare className="w-3.5 h-3.5 text-[#a371f7]" />
                <span className="font-semibold text-white">Chat</span>
                <span className="text-[#8b949e]">{detail ? `${detail.messages.length} messages` : ""}</span>
              </div>
              <div
                ref={chatRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  chatPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }}
                className="flex-1 overflow-y-auto p-2.5 space-y-2 select-text"
              >
                {detail && detail.messages.length === 0 && (
                  <p className="text-xs text-[#8b949e]">No conversation messages for this run.</p>
                )}
                {(detail?.messages ?? []).map((m) => (
                  <ChatBubble key={m.id} message={m} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

const LOG_ICON: Record<string, FC<{ className?: string }>> = {
  node: CircleDot,
  tool: Wrench,
  task: Activity,
  loop: Repeat,
  approval: ShieldQuestion,
  system: Play,
  warning: AlertTriangle,
  error: XCircle,
  hook: ListTree,
};

const LOG_STATUS: Record<string, { text: string; label: string }> = {
  running: { text: "text-[#e3b341]", label: "…" },
  ok: { text: "text-[#3fb950]", label: "ok" },
  failed: { text: "text-[#ff7b72]", label: "failed" },
  skipped: { text: "text-[#8b949e]", label: "skipped" },
};

const LogRow: FC<{ entry: ArchonLogEntry }> = ({ entry }) => {
  const Icon = LOG_ICON[entry.kind] ?? MessageSquare;
  const status = entry.status ? LOG_STATUS[entry.status] : null;
  const emphasis =
    entry.kind === "node" || entry.kind === "system" || entry.kind === "approval" ? "text-white font-semibold" : "text-[#c9d1d9]";
  return (
    <div
      className={`px-3 py-1 border-b border-[#30363d]/30 flex items-start gap-2 hover:bg-[#161b22] ${
        entry.status === "failed" || entry.kind === "error" ? "bg-[#f85149]/5" : ""
      }`}
    >
      <span className="text-[#6e7681] shrink-0 w-[56px]">{entry.ts_ms != null ? formatClock(entry.ts_ms) : ""}</span>
      <Icon className="w-3 h-3 mt-0.5 shrink-0 text-[#8b949e]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={emphasis}>{entry.label}</span>
          {entry.kind !== "node" && entry.node_id && <span className="text-[#6e7681] truncate">@{entry.node_id}</span>}
          {status && <span className={`ml-auto shrink-0 ${status.text}`}>{status.label}</span>}
          {entry.duration_ms != null && <span className="shrink-0 text-[#6e7681]">{formatDuration(entry.duration_ms)}</span>}
        </div>
        {entry.detail && (
          <p className="text-[#8b949e] whitespace-pre-wrap [overflow-wrap:anywhere] line-clamp-3" title={entry.detail}>
            {entry.detail}
          </p>
        )}
      </div>
    </div>
  );
};

const CATEGORY_LABEL: Record<string, string> = {
  workflow_dispatch_status: "dispatch",
  workflow_status: "status",
  workflow_result: "result",
};

/** Pretty-prints JSON message bodies (node outputs); other text is shown as written. */
const prettyContent = (content: string): { text: string; isJson: boolean } => {
  const t = content.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), isJson: true };
    } catch {
      // not JSON after all
    }
  }
  return { text: content, isJson: false };
};

const ChatBubble: FC<{ message: ArchonChatMessage }> = ({ message }) => {
  const isUser = message.role === "user";
  const { text, isJson } = prettyContent(message.content);
  const category = message.category ? CATEGORY_LABEL[message.category] ?? message.category : null;
  return (
    <div className={`flex gap-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className="w-5 h-5 rounded-full bg-[#21262d] border border-[#30363d] flex items-center justify-center shrink-0 mt-0.5">
        {isUser ? <User className="w-3 h-3 text-[#58a6ff]" /> : <Bot className="w-3 h-3 text-[#a371f7]" />}
      </div>
      <div
        className={`min-w-0 max-w-[88%] rounded-lg border px-2.5 py-1.5 text-[11px] ${
          isUser ? "bg-[#1f6feb]/10 border-[#1f6feb]/30" : "bg-[#161b22] border-[#30363d]"
        }`}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-[#6e7681] mb-0.5">
          <span>{isUser ? "You" : "Archon"}</span>
          {category && <span className="px-1 rounded bg-[#21262d] text-[#8b949e]">{category}</span>}
          {category === "result" && <CheckCircle2 className="w-3 h-3 text-[#3fb950]" />}
          {message.ts_ms != null && <span className="ml-auto">{formatClock(message.ts_ms)}</span>}
        </div>
        {isJson ? (
          <pre className="font-mono text-[10px] text-[#c9d1d9] whitespace-pre-wrap [overflow-wrap:anywhere] max-h-48 overflow-y-auto">{text}</pre>
        ) : (
          <p className="text-[#c9d1d9] whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
        )}
      </div>
    </div>
  );
};
