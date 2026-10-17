import { useState, useEffect, useMemo, FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  RefreshCw,
  GitFork,
  CheckCircle2,
  Clock,
  Play,
  Terminal,
  Cpu,
  Layers,
  FileText,
  Workflow,
  Sparkles,
  Repeat,
  StopCircle,
  CheckSquare,
  Square,
  BookOpen,
} from "lucide-react";
import {
  ArchonServiceStatus,
  ArchonWorkflow,
  ArchonPlanNode,
  ArchonRun,
  RepoSpecSummary,
} from "./types";
import { TerminalInfo } from "../terminal/types";

interface ArchonGraphModalProps {
  isOpen: boolean;
  activeProject: string;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  onClose: () => void;
  onSelectTerminal: (id: string) => void;
  onSpawnTerminal: (request: any) => void;
  onWritePty: (terminalId: string, data: string) => void;
}

type TabType = "dag" | "sdd" | "adrs" | "runs";

export const ArchonGraphModal: FC<ArchonGraphModalProps> = ({
  isOpen,
  activeProject,
  terminals,
  activeTerminalId,
  onClose,
  onSelectTerminal,
  onSpawnTerminal,
  onWritePty,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("dag");
  const [serviceStatus, setServiceStatus] = useState<ArchonServiceStatus | null>(null);
  const [workflows, setWorkflows] = useState<ArchonWorkflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ArchonRun[]>([]);
  const [repoSpecs, setRepoSpecs] = useState<RepoSpecSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [targetTerminalId, setTargetTerminalId] = useState<string>(activeTerminalId || "");
  const [dispatchSuccessMsg, setDispatchSuccessMsg] = useState<string | null>(null);

  // Sync target terminal (prefer live non-exited terminals)
  useEffect(() => {
    const activeTerm = terminals.find((t) => t.id === activeTerminalId);
    if (activeTerm && activeTerm.claude_status !== "exited") {
      setTargetTerminalId(activeTerm.id);
    } else {
      const live = [...terminals].reverse().find((t) => t.claude_status !== "exited");
      if (live) {
        setTargetTerminalId(live.id);
      } else if (terminals.length > 0) {
        setTargetTerminalId(terminals[terminals.length - 1].id);
      }
    }
  }, [activeTerminalId, terminals]);

  // Load Archon and repo data when modal opens + live poll runs every 2.5s
  useEffect(() => {
    if (!isOpen) return;
    refreshData();
    const timer = setInterval(async () => {
      try {
        const runsList = await invoke<ArchonRun[]>("archon_get_runs");
        setRuns(runsList);
      } catch {
        // ignore transient poll error
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [isOpen, activeProject]);

  const refreshData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // 1. Check Service
      const status = await invoke<ArchonServiceStatus>("archon_check_service");
      setServiceStatus(status);

      // 2. Load Workflows
      try {
        const wfList = await invoke<ArchonWorkflow[]>("archon_get_workflows");
        setWorkflows(wfList);
        if (wfList.length > 0 && !selectedWorkflowId) {
          // Default to first workflow with plan if available, or first in list
          const withPlan = wfList.find((w) => w.plan && w.plan.nodes && w.plan.nodes.length > 0);
          setSelectedWorkflowId(withPlan ? withPlan.id : wfList[0].id);
        }
      } catch (err: any) {
        console.warn("Could not load workflows:", err);
      }

      // 3. Load Runs
      try {
        const runsList = await invoke<ArchonRun[]>("archon_get_runs");
        setRuns(runsList);
      } catch (err: any) {
        console.warn("Could not load runs:", err);
      }

      // 4. Load Repo Specs & ADRs
      try {
        const specs = await invoke<RepoSpecSummary>("archon_parse_repo_specs", {
          projectPath: activeProject,
        });
        setRepoSpecs(specs);
      } catch (err: any) {
        console.warn("Could not load repo specs:", err);
      }
    } catch (err: any) {
      setErrorMsg(typeof err === "string" ? err : err.message || "Failed to query Archon");
    } finally {
      setIsLoading(false);
    }
  };

  // Selected Workflow
  const currentWorkflow = useMemo(() => {
    return workflows.find((w) => w.id === selectedWorkflowId) || workflows[0] || null;
  }, [workflows, selectedWorkflowId]);

  // Latest run for the selected workflow (or any currently running workflow)
  const latestWorkflowRun = useMemo(() => {
    if (!currentWorkflow) return runs[0] || null;
    return (
      runs.find((r) => r.workflow_name === currentWorkflow.name) ||
      runs.find((r) => r.status === "running") ||
      null
    );
  }, [runs, currentWorkflow]);

  // Layout Computation for Workflow DAG
  const dagLayout = useMemo(() => {
    if (!currentWorkflow || !currentWorkflow.plan || !currentWorkflow.plan.nodes) {
      return { nodesWithCoords: [], edges: [], width: 700, height: 400 };
    }

    const nodes = currentWorkflow.plan.nodes;
    const nodeMap = new Map<string, ArchonPlanNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // Calculate topological depth (layer index)
    const layerMap = new Map<string, number>();

    const getDepth = (id: string, visited = new Set<string>()): number => {
      if (layerMap.has(id)) return layerMap.get(id)!;
      if (visited.has(id)) return 0;
      visited.add(id);

      const n = nodeMap.get(id);
      if (!n || !n.depends_on || n.depends_on.length === 0) {
        layerMap.set(id, 0);
        return 0;
      }

      let maxParentDepth = 0;
      for (const parentId of n.depends_on) {
        maxParentDepth = Math.max(maxParentDepth, getDepth(parentId, new Set(visited)) + 1);
      }
      layerMap.set(id, maxParentDepth);
      return maxParentDepth;
    };

    nodes.forEach((n) => getDepth(n.id));

    // Group nodes by layer
    const layers: string[][] = [];
    nodes.forEach((n) => {
      const l = layerMap.get(n.id) || 0;
      while (layers.length <= l) {
        layers.push([]);
      }
      layers[l].push(n.id);
    });

    // Compute coordinate positions
    const NODE_WIDTH = 210;
    const NODE_HEIGHT = 80;
    const HORIZONTAL_GAP = 90;
    const VERTICAL_GAP = 30;
    const START_X = 40;
    const START_Y = 40;

    const coords = new Map<string, { x: number; y: number }>();
    let maxLayerHeight = 0;

    layers.forEach((layerNodes, layerIdx) => {
      const layerHeight = layerNodes.length * NODE_HEIGHT + (layerNodes.length - 1) * VERTICAL_GAP;
      maxLayerHeight = Math.max(maxLayerHeight, layerHeight);

      layerNodes.forEach((nodeId, rowIdx) => {
        const x = START_X + layerIdx * (NODE_WIDTH + HORIZONTAL_GAP);
        const y = START_Y + rowIdx * (NODE_HEIGHT + VERTICAL_GAP);
        coords.set(nodeId, { x, y });
      });
    });

    const nodesWithCoords = nodes.map((node) => {
      const pt = coords.get(node.id) || { x: 0, y: 0 };
      return {
        ...node,
        x: pt.x,
        y: pt.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
    });

    // Compute cubic Bezier edge curves
    const edges: { fromId: string; toId: string; path: string }[] = [];
    nodes.forEach((node) => {
      if (node.depends_on) {
        const toPt = coords.get(node.id);
        if (toPt) {
          node.depends_on.forEach((parent) => {
            const fromPt = coords.get(parent);
            if (fromPt) {
              const x1 = fromPt.x + NODE_WIDTH;
              const y1 = fromPt.y + NODE_HEIGHT / 2;
              const x2 = toPt.x;
              const y2 = toPt.y + NODE_HEIGHT / 2;
              const cx1 = x1 + (x2 - x1) / 2;
              const cy1 = y1;
              const cx2 = x1 + (x2 - x1) / 2;
              const cy2 = y2;
              const path = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
              edges.push({ fromId: parent, toId: node.id, path });
            }
          });
        }
      }
    });

    const totalWidth = START_X * 2 + layers.length * (NODE_WIDTH + HORIZONTAL_GAP);
    const totalHeight = Math.max(START_Y * 2 + maxLayerHeight, 420);

    return { nodesWithCoords, edges, width: totalWidth, height: totalHeight };
  }, [currentWorkflow]);

  // Selected Node details
  const selectedNode = useMemo(() => {
    if (!currentWorkflow || !currentWorkflow.plan || !selectedNodeId) return null;
    return currentWorkflow.plan.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [currentWorkflow, selectedNodeId]);

  // 1-Click: Assign Task or Workflow Step to Agent
  const handleAssignToAgent = (title: string, promptText: string) => {
    let target = targetTerminalId;
    if (!target && terminals.length > 0) {
      target = terminals[0].id;
    }

    if (target) {
      onWritePty(target, promptText + "\r");
      onSelectTerminal(target);
      setDispatchSuccessMsg(`Assigned to terminal pane "${terminals.find((t) => t.id === target)?.name || target}"!`);
      setTimeout(() => setDispatchSuccessMsg(null), 3500);
    } else {
      // Spawn new terminal and dispatch
      onSpawnTerminal({
        project_path: activeProject,
        run_kind: "claude",
        name: `archon-${title.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        custom_flags: "",
      });
      setDispatchSuccessMsg(`Spawning new Claude terminal to run task...`);
      setTimeout(() => setDispatchSuccessMsg(null), 3500);
    }
  };

  // 1-Click: Execute real Archon Workflow Run in a Shell ConPTY Pane
  const handleRunArchonWorkflow = (workflowName: string, message: string) => {
    const liveTerminals = [...terminals].reverse().filter((t) => t.claude_status !== "exited");
    // Prefer a live PowerShell / command shell terminal pane so archon.exe CLI executes directly
    const shellTerm =
      liveTerminals.find(
        (t) =>
          t.run_kind === "powershell" ||
          t.run_kind === "command" ||
          t.name.toLowerCase().includes("test") ||
          t.name.toLowerCase().includes("shell") ||
          t.name.toLowerCase().includes("runner")
      ) ||
      liveTerminals.find((t) => t.id === targetTerminalId) ||
      liveTerminals[0] ||
      terminals[terminals.length - 1];

    const safeMsg = message.replace(/"/g, "'");
    const cmd = `archon workflow run "${workflowName}" --cwd "${activeProject}" --no-worktree --model medium=haiku "${safeMsg}"`;

    if (shellTerm) {
      onWritePty(shellTerm.id, cmd + "\r\n");
      onSelectTerminal(shellTerm.id);
      setDispatchSuccessMsg(
        `Launched Archon workflow "${workflowName}" in terminal "${shellTerm.name}" — live-polling Archon :3090 runs...`
      );
      setTimeout(() => setDispatchSuccessMsg(null), 6000);
    } else {
      onSpawnTerminal({
        project_path: activeProject,
        run_kind: "powershell",
        name: "archon-runner",
        custom_flags: "",
      });
      setDispatchSuccessMsg(`Spawned archon-runner shell pane for "${workflowName}"`);
      setTimeout(() => setDispatchSuccessMsg(null), 4000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="flex flex-col w-[94vw] h-[90vh] max-w-[1440px] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-[#c9d1d9]">
        {/* Top Header */}
        <div className="h-14 px-6 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#58a6ff]/15 border border-[#58a6ff]/30 flex items-center justify-center">
              <GitFork className="w-4 h-4 text-[#58a6ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Archon & SDD Graph Inspector</h2>
                {serviceStatus?.running ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#238636]/20 border border-[#238636]/40 text-[#3fb950]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse" />
                    Online (Port {serviceStatus.port})
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#f85149]/15 border border-[#f85149]/30 text-[#f85149]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f85149]" />
                    Service Offline (CLI Available)
                  </span>
                )}
                {serviceStatus?.version && (
                  <span className="text-xs text-[#8b949e] font-mono">{serviceStatus.version}</span>
                )}
              </div>
              <p className="text-xs text-[#8b949e]">
                Spec-Driven Development task graphs, Archon workflow DAGs, and ADR decision trails
              </p>
            </div>
          </div>

          {/* Tab Switcher & Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[#0d1117] border border-[#30363d] p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("dag")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === "dag"
                    ? "bg-[#21262d] text-white shadow-xs"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <Workflow className="w-3.5 h-3.5 text-[#58a6ff]" />
                <span>Workflow DAGs</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("sdd")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === "sdd"
                    ? "bg-[#21262d] text-white shadow-xs"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#3fb950]" />
                <span>SDD Spec Tasks ({repoSpecs?.tasks.length || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("adrs")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === "adrs"
                    ? "bg-[#21262d] text-white shadow-xs"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-[#a855f7]" />
                <span>ADRs ({repoSpecs?.adrs.length || 0})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("runs")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === "runs"
                    ? "bg-[#21262d] text-white shadow-xs"
                    : "text-[#8b949e] hover:text-[#c9d1d9]"
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-[#e3b341]" />
                <span>Runs History ({runs.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={refreshData}
              disabled={isLoading}
              title="Refresh Archon & Specs"
              className="p-1.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-[#21262d] text-[#8b949e] hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error Notification Banner */}
        {errorMsg && (
          <div className="bg-[#f85149]/15 border-b border-[#f85149]/30 px-6 py-2 text-xs text-[#ff7b72] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StopCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-[#8b949e] hover:text-white p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Dispatch Notification Banner */}
        {dispatchSuccessMsg && (
          <div className="bg-[#238636]/20 border-b border-[#238636]/40 px-6 py-2 text-xs text-[#3fb950] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{dispatchSuccessMsg}</span>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* TAB 1: WORKFLOW DAG GRAPH */}
          {activeTab === "dag" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Workflow Selector Bar */}
              <div className="h-12 px-6 border-b border-[#30363d] bg-[#161b22]/70 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#8b949e]">Workflow:</span>
                  <select
                    data-testid="archon-workflow-select"
                    value={selectedWorkflowId}
                    onChange={(e) => {
                      setSelectedWorkflowId(e.target.value);
                      setSelectedNodeId(null);
                    }}
                    className="px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs font-mono text-white focus:outline-hidden focus:border-[#58a6ff] min-w-[280px]"
                  >
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name} {wf.plan?.nodes ? `(${wf.plan.nodes.length} nodes)` : ""}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    data-testid="archon-run-workflow-btn"
                    onClick={() =>
                      handleRunArchonWorkflow(
                        currentWorkflow?.name || "archon-validate",
                        `Run governed workflow ${currentWorkflow?.name || "archon-validate"} on ${activeProject} and verify all unit tests and SPEC.md requirements.`
                      )
                    }
                    className="px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run in Archon</span>
                  </button>

                  {currentWorkflow?.description && (
                    <span className="text-xs text-[#8b949e] truncate max-w-[360px]" title={currentWorkflow.description}>
                      {currentWorkflow.description}
                    </span>
                  )}
                </div>

                {/* Target Terminal Dispatcher */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8b949e]">Target Pane:</span>
                  <select
                    value={targetTerminalId}
                    onChange={(e) => setTargetTerminalId(e.target.value)}
                    className="px-2.5 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white"
                  >
                    {terminals.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.run_kind})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Live Archon Run Telemetry Strip */}
              {latestWorkflowRun && (
                <div className="px-6 py-2 border-b border-[#30363d] bg-[#0d1117] flex items-center justify-between text-xs shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[#8b949e] font-medium">Latest Archon Run:</span>
                    <span className="font-mono text-[#58a6ff] font-semibold">
                      {latestWorkflowRun.id.slice(0, 8)}
                    </span>
                    <span className="font-mono text-white font-semibold">
                      {latestWorkflowRun.workflow_name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1.5 ${
                        latestWorkflowRun.status === "completed"
                          ? "bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40"
                          : latestWorkflowRun.status === "running"
                          ? "bg-[#1f6feb]/25 text-[#58a6ff] border border-[#58a6ff]/50 animate-pulse"
                          : "bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/40"
                      }`}
                    >
                      {latestWorkflowRun.status === "running" && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff] animate-ping" />
                      )}
                      {latestWorkflowRun.status}
                    </span>
                    {latestWorkflowRun.outcome && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262d] text-[#3fb950] border border-[#30363d]">
                        outcome: {latestWorkflowRun.outcome}
                      </span>
                    )}
                    {latestWorkflowRun.current_step_name && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1f6feb]/15 text-[#58a6ff] border border-[#1f6feb]/30">
                        active node: {latestWorkflowRun.current_step_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-[11px] font-mono text-[#8b949e]">
                    {latestWorkflowRun.codebase_name && (
                      <span className="text-[#c9d1d9]">{latestWorkflowRun.codebase_name}</span>
                    )}
                    {latestWorkflowRun.nodes_total != null && (
                      <span className="text-[#3fb950]">
                        {latestWorkflowRun.nodes_completed ?? 0}/{latestWorkflowRun.nodes_total} nodes
                      </span>
                    )}
                    {latestWorkflowRun.total_cost_usd != null && (
                      <span className="text-[#e3b341] font-bold">
                        ${latestWorkflowRun.total_cost_usd.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Main SVG Graph & Node Detail Inspector */}
              <div className="flex-1 flex overflow-hidden">
                {/* SVG Graph View */}
                <div className="flex-1 overflow-auto p-6 bg-[#090d13] relative select-none">
                  {dagLayout.nodesWithCoords.length > 0 ? (
                    <div
                      className="relative"
                      style={{ width: `${dagLayout.width}px`, height: `${dagLayout.height}px` }}
                    >
                      {/* SVG Canvas for Connecting Arrows */}
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        width={dagLayout.width}
                        height={dagLayout.height}
                      >
                        <defs>
                          <marker
                            id="arrow"
                            viewBox="0 0 10 10"
                            refX="7"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 1 L 10 5 L 0 9 z" fill="#58a6ff" />
                          </marker>
                        </defs>
                        {dagLayout.edges.map((edge, idx) => {
                          const isHighlighted =
                            selectedNodeId === edge.fromId || selectedNodeId === edge.toId;
                          return (
                            <path
                              key={idx}
                              d={edge.path}
                              fill="none"
                              stroke={isHighlighted ? "#58a6ff" : "#30363d"}
                              strokeWidth={isHighlighted ? 2.5 : 1.75}
                              strokeDasharray={isHighlighted ? undefined : "4,2"}
                              markerEnd="url(#arrow)"
                              className="transition-all duration-200"
                            />
                          );
                        })}
                      </svg>

                      {/* Render Nodes */}
                      {dagLayout.nodesWithCoords.map((node) => {
                        const isSelected = selectedNodeId === node.id;
                        const isDependent =
                          selectedNode?.depends_on?.includes(node.id) || false;
                        const kind = node.kind || "agent";
                        const isLiveRunning =
                          latestWorkflowRun?.workflow_name === currentWorkflow?.name &&
                          latestWorkflowRun?.status === "running" &&
                          (latestWorkflowRun.current_step_name === node.id ||
                            latestWorkflowRun.active_nodes?.includes(node.id));
                        const isRunCompleted =
                          latestWorkflowRun?.workflow_name === currentWorkflow?.name &&
                          latestWorkflowRun?.status === "completed";

                        return (
                          <div
                            key={node.id}
                            onClick={() => setSelectedNodeId(node.id)}
                            style={{
                              position: "absolute",
                              left: `${node.x}px`,
                              top: `${node.y}px`,
                              width: `${node.width}px`,
                              height: `${node.height}px`,
                            }}
                            className={`p-3 rounded-lg border cursor-pointer transition-all flex flex-col justify-between ${
                              isLiveRunning
                                ? "bg-[#1c2128] border-[#e3b341] shadow-lg ring-2 ring-[#e3b341]/50 -translate-y-0.5"
                                : isSelected
                                ? "bg-[#1c2128] border-[#58a6ff] shadow-lg ring-2 ring-[#58a6ff]/40 -translate-y-0.5"
                                : isDependent
                                ? "bg-[#161b22] border-[#388bfd] shadow-sm"
                                : isRunCompleted
                                ? "bg-[#161b22] border-[#238636]/70 hover:border-[#3fb950]"
                                : "bg-[#161b22] border-[#30363d] hover:border-[#8b949e] hover:bg-[#21262d]"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {kind === "agent" && <Cpu className="w-3.5 h-3.5 text-[#58a6ff]" />}
                                {kind === "exec" && <Terminal className="w-3.5 h-3.5 text-[#3fb950]" />}
                                {(kind === "loop_group" || kind === "loop") && (
                                  <Repeat className="w-3.5 h-3.5 text-[#e3b341]" />
                                )}
                                {kind === "halt" && <StopCircle className="w-3.5 h-3.5 text-[#ff7b72]" />}
                                <span className="font-mono text-xs font-semibold text-white truncate max-w-[115px]">
                                  {node.id}
                                </span>
                              </div>
                              {isLiveRunning ? (
                                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#e3b341]/20 text-[#e3b341] border border-[#e3b341]/50 animate-pulse">
                                  RUNNING
                                </span>
                              ) : isRunCompleted ? (
                                <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
                                  {kind} ✓
                                </span>
                              ) : (
                                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
                                  {kind}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-[#8b949e] pt-1 border-t border-[#30363d]/50">
                              <span className="truncate">
                                {node.provider ? `${node.provider}/${node.model || "default"}` : node.model ? `claude/${node.model}` : "native task"}
                              </span>
                              {node.depends_on && node.depends_on.length > 0 && (
                                <span className="text-[10px] font-mono text-[#58a6ff]">
                                  {node.depends_on.length} dep{node.depends_on.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#8b949e]">
                      <Workflow className="w-10 h-10 text-[#30363d] mb-3" />
                      <h3 className="text-sm font-semibold text-white mb-1">
                        Workflow Definition Available
                      </h3>
                      <p className="text-xs max-w-md mb-4">
                        This workflow does not declare an explicit static DAG graph, but can be launched directly with Archon CLI.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handleRunArchonWorkflow(
                            currentWorkflow?.name || "archon-validate",
                            `Run workflow ${currentWorkflow?.name} on ${activeProject}`
                          )
                        }
                        className="px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-xs font-semibold flex items-center gap-2"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Run "{currentWorkflow?.name}" in Archon</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Node Detail Inspector Drawer */}
                {selectedNode && (
                  <div className="w-[360px] border-l border-[#30363d] bg-[#161b22] p-5 flex flex-col justify-between shrink-0 overflow-y-auto animate-in slide-in-from-right-4 duration-150">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-[#30363d]">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-[#58a6ff]" />
                          <h3 className="text-sm font-bold text-white font-mono">{selectedNode.id}</h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedNodeId(null)}
                          className="text-[#8b949e] hover:text-white p-1 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Kind & Provider Info */}
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between py-1 border-b border-[#30363d]/50">
                          <span className="text-[#8b949e]">Kind:</span>
                          <span className="font-mono text-white uppercase">{selectedNode.kind || "agent"}</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-[#30363d]/50">
                          <span className="text-[#8b949e]">Provider / Tier:</span>
                          <span className="font-mono text-white">
                            {selectedNode.provider || "claude"} / {selectedNode.model || "large"}
                          </span>
                        </div>
                        {selectedNode.when && (
                          <div className="py-1 border-b border-[#30363d]/50">
                            <span className="text-[#8b949e] block mb-1">Condition (`when`):</span>
                            <code className="text-[11px] text-[#e3b341] bg-[#0d1117] p-1.5 rounded block font-mono break-all">
                              {selectedNode.when}
                            </code>
                          </div>
                        )}
                      </div>

                      {/* Dependencies */}
                      <div>
                        <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                          Dependencies ({selectedNode.depends_on?.length || 0})
                        </h4>
                        {selectedNode.depends_on && selectedNode.depends_on.length > 0 ? (
                          <div className="space-y-1.5">
                            {selectedNode.depends_on.map((dep) => (
                              <div
                                key={dep}
                                onClick={() => setSelectedNodeId(dep)}
                                className="p-2 bg-[#0d1117] border border-[#30363d] rounded text-xs flex items-center justify-between cursor-pointer hover:border-[#58a6ff]"
                              >
                                <span className="font-mono text-[#58a6ff]">{dep}</span>
                                <span className="text-[10px] text-[#3fb950] font-medium">Ready</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[#8b949e] italic">No prior dependencies (Entry Root Node)</p>
                        )}
                      </div>

                      {/* Skills */}
                      {selectedNode.skills && selectedNode.skills.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mb-2">
                            Assigned Skills
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedNode.skills.map((skill) => (
                              <span
                                key={skill}
                                className="px-2 py-0.5 rounded text-[11px] bg-[#388bfd]/15 text-[#58a6ff] border border-[#388bfd]/30 font-mono"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-4 border-t border-[#30363d] space-y-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleAssignToAgent(
                            selectedNode.id,
                            `Execute Archon workflow node "${selectedNode.id}" from workflow "${currentWorkflow?.name}". Requirements and skills: ${
                              selectedNode.skills?.join(", ") || "standard"
                            }.`
                          )
                        }
                        className="w-full py-2 bg-[#1f6feb] hover:bg-[#388bfd] text-white rounded-md text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Assign Node to Agent Pane</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleRunArchonWorkflow(
                            currentWorkflow?.name || "archon-validate",
                            `Run governed workflow ${currentWorkflow?.name} on ${activeProject}`
                          )
                        }
                        className="w-full py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Run Full Workflow in Archon</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SPEC-DRIVEN DEVELOPMENT (SDD) TASK BOARD */}
          {activeTab === "sdd" && (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#30363d]">
                <div>
                  <h3 className="text-sm font-semibold text-white">Repository Specification Tasks</h3>
                  <p className="text-xs text-[#8b949e]">
                    Parsed automatically from {repoSpecs?.spec_files_found.join(", ") || "SPEC.md / CONTEXT.md"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#8b949e]">
                    Completed:{" "}
                    <strong className="text-[#3fb950]">
                      {repoSpecs?.tasks.filter((t) => t.completed).length || 0}
                    </strong>{" "}
                    / {repoSpecs?.tasks.length || 0}
                  </span>
                </div>
              </div>

              {repoSpecs && repoSpecs.tasks.length > 0 ? (
                <div className="space-y-4">
                  {/* Group tasks by section */}
                  {Array.from(new Set(repoSpecs.tasks.map((t) => t.section))).map((section) => (
                    <div key={section} className="space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#58a6ff] flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        <span>{section}</span>
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {repoSpecs.tasks
                          .filter((t) => t.section === section)
                          .map((task) => (
                            <div
                              key={task.id}
                              className={`p-3 rounded-lg border flex items-start justify-between gap-3 transition-colors ${
                                task.completed
                                  ? "bg-[#161b22]/50 border-[#30363d]/60 opacity-80"
                                  : "bg-[#161b22] border-[#30363d] hover:border-[#8b949e]"
                              }`}
                            >
                              <div className="flex items-start gap-2.5">
                                {task.completed ? (
                                  <CheckSquare className="w-4 h-4 text-[#3fb950] shrink-0 mt-0.5" />
                                ) : (
                                  <Square className="w-4 h-4 text-[#8b949e] shrink-0 mt-0.5" />
                                )}
                                <div>
                                  <p
                                    className={`text-xs ${
                                      task.completed ? "line-through text-[#8b949e]" : "text-[#c9d1d9] font-medium"
                                    }`}
                                  >
                                    {task.title}
                                  </p>
                                  <span className="text-[10px] text-[#8b949e] font-mono">
                                    {task.file_name}:{task.line_number}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {!task.completed && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAssignToAgent(
                                        task.title,
                                        `Implement task from ${task.file_name}:${task.line_number}: "${task.title}" using test-driven development.`
                                      )
                                    }
                                    className="px-2 py-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] rounded text-[11px] font-medium flex items-center gap-1 transition-colors"
                                  >
                                    <Sparkles className="w-3 h-3 text-[#58a6ff]" />
                                    <span>Agent</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  data-testid={`archon-sdd-run-${task.line_number}`}
                                  onClick={() =>
                                    handleRunArchonWorkflow(
                                      "archon-validate",
                                      `Validate SDD specification task ${task.file_name}:${task.line_number}: ${task.title}`
                                    )
                                  }
                                  className="px-2.5 py-1 bg-[#238636] hover:bg-[#2ea043] text-white rounded text-[11px] font-semibold flex items-center gap-1 transition-colors shadow-xs"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Run in Archon</span>
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-[#8b949e]">
                  <FileText className="w-10 h-10 text-[#30363d] mb-3" />
                  <h4 className="text-sm font-semibold text-white mb-1">No Spec Checklist Items Found</h4>
                  <p className="text-xs max-w-sm">
                    Add standard markdown checklists (`- [ ] task name`) in `SPEC.md`, `CONTEXT.md`, or `IDEAS.md` to see actionable cards here.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ARCHITECTURE DECISION RECORDS (ADRs) */}
          {activeTab === "adrs" && (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="pb-4 mb-4 border-b border-[#30363d]">
                <h3 className="text-sm font-semibold text-white">Architecture Decision Records (ADRs)</h3>
                <p className="text-xs text-[#8b949e]">
                  Discovered from `docs/adr/*.md` in active repository
                </p>
              </div>

              {repoSpecs && repoSpecs.adrs.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {repoSpecs.adrs.map((adr) => (
                    <div
                      key={adr.id}
                      className="p-4 bg-[#161b22] border border-[#30363d] rounded-lg flex flex-col justify-between hover:border-[#8b949e] transition-colors"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-[#58a6ff]">ADR {adr.number}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                              adr.status.toLowerCase().includes("accepted")
                                ? "bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40"
                                : adr.status.toLowerCase().includes("super")
                                ? "bg-[#a855f7]/20 text-[#c084fc] border border-[#a855f7]/40"
                                : "bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40"
                            }`}
                          >
                            {adr.status}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-white leading-snug">{adr.title}</h4>
                        {adr.summary && (
                          <p className="text-xs text-[#8b949e] line-clamp-3">{adr.summary}</p>
                        )}
                      </div>

                      {adr.date && (
                        <div className="pt-3 mt-3 border-t border-[#30363d]/50 text-[10px] text-[#8b949e] font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Decided {adr.date}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-[#8b949e]">
                  <BookOpen className="w-10 h-10 text-[#30363d] mb-3" />
                  <h4 className="text-sm font-semibold text-white mb-1">No ADRs Found</h4>
                  <p className="text-xs max-w-sm">
                    Store Architecture Decision Records in `docs/adr/0001-example.md` to track architectural governance.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ARCHON RUNS HISTORY */}
          {activeTab === "runs" && (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="pb-4 mb-4 border-b border-[#30363d] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Archon Workflow Runs</h3>
                  <p className="text-xs text-[#8b949e]">Governed execution logs and spend history from Archon (:3090 / archon.db)</p>
                </div>
                <span className="text-xs text-[#8b949e] font-mono">{runs.length} runs loaded</span>
              </div>

              {runs.length > 0 ? (
                <div className="space-y-2.5">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="p-3.5 bg-[#161b22] border border-[#30363d] rounded-lg flex items-center justify-between hover:border-[#8b949e] transition-colors"
                    >
                      <div className="space-y-1 max-w-[70%]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-white">{run.workflow_name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              run.status === "completed"
                                ? "bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40"
                                : run.status === "running"
                                ? "bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 animate-pulse"
                                : "bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/40"
                            }`}
                          >
                            {run.status}
                          </span>
                          {run.outcome && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262d] text-[#3fb950] border border-[#30363d]">
                              {run.outcome}
                            </span>
                          )}
                          {run.codebase_name && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#388bfd]/15 text-[#58a6ff] border border-[#388bfd]/30">
                              {run.codebase_name}
                            </span>
                          )}
                          {run.nodes_total != null && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262d] text-[#c9d1d9] border border-[#30363d]">
                              {run.nodes_completed ?? 0}/{run.nodes_total} nodes
                            </span>
                          )}
                        </div>

                        {run.user_message && (
                          <p className="text-xs text-[#8b949e] truncate" title={run.user_message}>
                            "{run.user_message}"
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-[10px] text-[#8b949e] font-mono">
                          <span>Run ID: {run.id}</span>
                          {run.working_path && <span>Path: {run.working_path}</span>}
                          {run.current_step_name && (
                            <span className="text-[#e3b341]">Step: {run.current_step_name}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right space-y-1">
                        {run.total_cost_usd !== undefined && run.total_cost_usd !== null && (
                          <span className="text-xs font-bold text-[#e3b341] font-mono block">
                            ${run.total_cost_usd.toFixed(4)}
                          </span>
                        )}
                        {run.started_at && (
                          <span className="text-[10px] text-[#8b949e] block">
                            {new Date(run.started_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-[#8b949e]">
                  <Clock className="w-10 h-10 text-[#30363d] mb-3" />
                  <h4 className="text-sm font-semibold text-white mb-1">No Past Runs Recorded</h4>
                  <p className="text-xs max-w-sm">
                    Workflow executions initiated via `archon workflow run` will be displayed here.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
