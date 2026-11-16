import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, FileCode2, OctagonAlert, Plus, X } from "lucide-react";
import type { ArchonWorkflow, SpecTask } from "../archon/types.ts";
import { shortWorkflowName } from "../archon/workflowName.ts";
import { formatUsd } from "../machina/format.ts";
import type { FactoryLoopMode } from "../machina/types.ts";
import { hostConditionView } from "../praxis-builder/hostCondition.ts";
import { factorySpendToday, panelSections, rowOf } from "./workflowRuns.ts";
import type { Engine, RunSource, Segment, SegmentState, WorkflowRunRow } from "./workflowRuns.ts";
import { runSources, type WorkflowsData } from "./workflowsData.ts";

/** How long Halt stays armed for its second press, in ms. */
const HALT_ARMED_MS = 4000;

interface WorkflowsPanelProps {
  data: WorkflowsData;
  /** The clock the rows' Recent window and today's spend are read against, in ms since the epoch. */
  now: number;
  /** The run the Run view shows, whose row is marked. */
  pickedKey: string | null;
  /** Each new `seq` moves keyboard focus to the engine strip, as chord `f` asks. */
  engineFocus: { seq: number } | null;
  /** Shows a run or work order in the companion's Run view. */
  onPickRun: (source: RunSource) => void;
  /** Reads the engines again, as after the Factory loop changed. */
  onRefresh: () => void;
  /** Opens a Praxis run's page, where its decisions are made. */
  onOpenInBrowser: (source: RunSource) => void;
  start: StartActions;
}

/** What the Start section starts or opens. */
export interface StartActions {
  /** The pinned Archon workflows' names, in pin order. */
  pinned: readonly string[];
  onRunWorkflow: (name: string) => void;
  onPin: (name: string) => void;
  onUnpin: (name: string) => void;
  /** Hands an open spec task to a new agent. */
  onAgentTask: (task: SpecTask) => void;
  /** Every spec task and ADR. */
  onAllTasks: () => void;
  /** The Praxis Builder on a graph. */
  onOpenGraph: (id: string) => void;
  onNewWorkOrder: () => void;
  onFactoryConfig: () => void;
}

/** Start lists this many open spec tasks and recent Praxis graphs. */
const START_TOP = 3;

/**
 * The Workflows module's panel: the engine strip, then every run and work order of Archon, the
 * Machina Factory and Praxis by state (Needs you, Running, Recent), with Start between them.
 */
export const WorkflowsPanel = ({ data, now, pickedKey, engineFocus, onPickRun, onRefresh, onOpenInBrowser, start }: WorkflowsPanelProps) => {
  const listed = runSources(data).map((source) => ({ source, row: rowOf(source, now) }));
  const sections = panelSections(listed.map((entry) => entry.row));
  const sourceOf = new Map(listed.map((entry) => [entry.row.key, entry.source]));
  const rows = (shown: WorkflowRunRow[], empty: string, maxRows?: number) => (
    <RunRows
      rows={shown}
      empty={empty}
      maxRows={maxRows}
      pickedKey={pickedKey}
      onPick={(row) => onPickRun(sourceOf.get(row.key)!)}
      onChip={(row) => (row.chip === "Browser" ? onOpenInBrowser : onPickRun)(sourceOf.get(row.key)!)}
    />
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col select-none text-[#c9d1d9]">
      <h2 className="h-12 shrink-0 px-4 flex items-center border-b border-[#30363d] bg-[#161b22] text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
        Workflows
      </h2>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EngineStrip data={data} now={now} focus={engineFocus} onRefresh={onRefresh} />
        <PanelSection label="Needs you">{rows(sections.needsYou, "Nothing needs you", NEEDS_YOU_ROWS)}</PanelSection>
        <PanelSection label="Running">{rows(sections.running, "Nothing is running")}</PanelSection>
        <PanelSection label="Start">
          <StartSection workflows={data.archon.workflows} tasks={data.archon.tasks} graphs={data.praxis.graphs} actions={start} />
        </PanelSection>
        <PanelSection label="Recent">{rows(sections.recent, "Nothing finished in the last 24 hours")}</PanelSection>
      </div>
    </div>
  );
};

/** Needs you grows to this many rows, then scrolls. */
const NEEDS_YOU_ROWS = 5;
/** A run row's height, in CSS px: three lines. */
const RUN_ROW_HEIGHT = 58;

const ENGINE_LETTER: Record<Engine, string> = { archon: "A", factory: "F", praxis: "P" };
const ENGINE_NAME: Record<Engine, string> = { archon: "Archon", factory: "Factory", praxis: "Praxis" };
const ENGINE_COLOUR: Record<Engine, string> = { archon: "text-[#58a6ff]", factory: "text-[#d2a8ff]", praxis: "text-[#f778ba]" };
const SEGMENT_CLASS: Record<SegmentState, string> = {
  done: "bg-[#3fb950]",
  running: "bg-[#58a6ff]",
  waiting: "bg-[#d29922]",
  failed: "bg-[#f85149]",
  pending: "bg-[#30363d]",
};

/** A row's status and spend, its second line. */
const statusLine = (row: WorkflowRunRow) => (row.spendUsd === null ? row.status : `${row.status} · ${formatUsd(row.spendUsd)}`);

/** How far a row's bar has come, in words, since its colours say it only to the eye. */
function segmentsText(segments: readonly Segment[]): string {
  if (segments.length === 0) return "";
  const states = segments.map((s) => s.state);
  const done = states.filter((s) => s === "done").length;
  const failed = states.includes("failed") ? ", one failed" : "";
  const waiting = states.includes("waiting") ? ", waiting" : "";
  return `${done} of ${segments.length} done${failed}${waiting}`;
}

/** A list of run rows, or a line saying it is empty. With `maxRows`, it grows to that many rows, then scrolls. */
const RunRows = ({
  rows,
  empty,
  maxRows,
  pickedKey,
  onPick,
  onChip,
}: {
  rows: WorkflowRunRow[];
  empty: string;
  maxRows?: number;
  pickedKey: string | null;
  onPick: (row: WorkflowRunRow) => void;
  onChip: (row: WorkflowRunRow) => void;
}) => {
  if (rows.length === 0) return <p className="px-1 py-1 text-xs text-[#8b949e]">{empty}</p>;
  return (
    <ul
      data-max-rows={maxRows}
      style={maxRows ? { maxHeight: maxRows * RUN_ROW_HEIGHT } : undefined}
      className={`space-y-0.5 ${maxRows ? "overflow-y-auto" : ""}`}
    >
      {rows.map((row) => (
        <li key={row.key} className="relative">
          <button
            type="button"
            aria-current={row.key === pickedKey ? "true" : undefined}
            aria-label={[ENGINE_NAME[row.engine], row.name, statusLine(row), segmentsText(row.segments)].filter(Boolean).join(" · ")}
            onClick={() => onPick(row)}
            style={{ minHeight: RUN_ROW_HEIGHT - 2 }}
            className={`w-full px-2 py-1.5 rounded-md text-left text-xs border ${
              row.key === pickedKey ? "border-[#58a6ff] bg-[#161b22]" : "border-transparent hover:bg-[#161b22]"
            } ${row.chip ? "pr-20" : ""}`}
          >
            <span data-line className="flex items-center gap-1.5 min-w-0">
              <span aria-hidden="true" className={`shrink-0 w-3 font-mono font-bold ${ENGINE_COLOUR[row.engine]}`}>
                {ENGINE_LETTER[row.engine]}
              </span>
              <span className="truncate text-white">{row.name}</span>
            </span>
            <span data-line className="block pl-[18px] truncate text-[11px] text-[#8b949e]">
              {statusLine(row)}
            </span>
            <span aria-hidden="true" className="mt-1 ml-[18px] flex gap-0.5">
              {row.segments.map((segment) => (
                <span key={segment.id} data-segment={segment.state} className={`h-1.5 flex-1 rounded-full ${SEGMENT_CLASS[segment.state]}`} />
              ))}
            </span>
          </button>
          {row.chip && (
            <button
              type="button"
              data-chip
              onClick={() => onChip(row)}
              aria-label={`${row.chip}: ${row.name}`}
              className="absolute right-1.5 top-1.5 h-6 min-w-14 px-2 rounded-md border border-[#d29922]/60 bg-[#d29922]/15 text-[11px] font-semibold text-[#e3b341] hover:bg-[#d29922]/30"
            >
              {row.chip}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};

/** One titled section of the panel, named by its heading. */
const PanelSection = ({ label, children }: { label: string; children: ReactNode }) => (
  <section aria-label={label} className="border-b border-[#30363d] px-2 py-2">
    <h3 className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#8b949e]">{label}</h3>
    {children}
  </section>
);

/** The panel's head: Archon online or not, the Factory switch and Halt, today's Factory spend, Praxis sign-in. */
const EngineStrip = ({
  data,
  now,
  focus,
  onRefresh,
}: {
  data: WorkflowsData;
  now: number;
  focus: { seq: number } | null;
  onRefresh: () => void;
}) => {
  const strip = useRef<HTMLElement>(null);
  const loopName = useId();
  const [haltArmed, setHaltArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const focusSeq = focus?.seq ?? null;
  useEffect(() => {
    if (focusSeq !== null) strip.current?.focus();
  }, [focusSeq]);
  useEffect(() => {
    if (!haltArmed) return;
    const timer = window.setTimeout(() => setHaltArmed(false), HALT_ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [haltArmed]);

  const setLoopMode = async (mode: FactoryLoopMode) => {
    setBusy(true);
    setProblem(null);
    try {
      await invoke("machina_set_loop_mode", { mode });
      onRefresh();
    } catch (e) {
      setProblem(`Couldn't set the Factory to ${mode.toLowerCase()}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const online = data.archon.online;
  const loopMode = data.factory.status?.loopMode ?? null;
  const praxis = hostConditionView(data.praxis.condition);
  return (
    <section
      ref={strip}
      tabIndex={-1}
      aria-label="Engines"
      className="border-b border-[#30363d] px-3 py-2 space-y-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--quay-accent)"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`w-2 h-2 rounded-full ${online === null ? "border border-[#8b949e]" : online ? "bg-[#3fb950]" : "bg-[#f85149]"}`}
        />
        <span>{online === null ? "Archon not checked yet" : online ? "Archon online" : "Archon offline"}</span>
      </div>
      <div className="flex items-center gap-2">
        {loopMode === "HALTED" ? (
          <span className="h-7 px-2 inline-flex items-center rounded bg-[#f85149] text-white font-mono font-bold">Halted</span>
        ) : null}
        <div role="radiogroup" aria-label="Factory" className="flex items-center rounded-md border border-[#30363d] p-0.5 font-mono text-[11px]">
          {(["ACTIVE", "PAUSED"] as const).map((mode) => (
            <label
              key={mode}
              className={`min-h-6 px-2 inline-flex items-center rounded cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--quay-accent) ${
                loopMode === mode
                  ? mode === "ACTIVE"
                    ? "bg-[#238636] text-white font-bold"
                    : "bg-[#d29922] text-[#0d1117] font-bold"
                  : "text-[#8b949e] hover:text-white"
              }`}
            >
              <input
                type="radio"
                name={loopName}
                value={mode}
                checked={loopMode === mode}
                disabled={busy || loopMode === null}
                onChange={() => void setLoopMode(mode)}
                className="sr-only"
              />
              {mode === "ACTIVE" ? "Active" : "Paused"}
            </label>
          ))}
        </div>
        {loopMode !== "HALTED" && (
          <button
            type="button"
            disabled={busy || loopMode === null}
            onClick={() => {
              if (haltArmed) {
                setHaltArmed(false);
                void setLoopMode("HALTED");
              } else {
                setHaltArmed(true);
              }
            }}
            title="Cancels running scaffolds and gates, sends Ctrl+C to author terminals, and refuses new work orders"
            className={`h-7 px-2 inline-flex items-center gap-1 rounded-md border font-mono font-bold disabled:opacity-50 ${
              haltArmed ? "bg-[#f85149] border-[#f85149] text-white" : "bg-[#21262d] border-[#30363d] text-[#ff7b72] hover:bg-[#f85149]/20"
            }`}
          >
            <OctagonAlert className="w-3 h-3" aria-hidden="true" />
            {haltArmed ? "Press again to halt" : "Halt"}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Factory today {formatUsd(factorySpendToday(data.factory.workOrders, now))}</span>
        <span className={praxis.tone === "ok" ? "text-[#3fb950]" : praxis.tone === "error" ? "text-[#ff7b72]" : "text-[#8b949e]"}>
          Praxis: {praxis.label}
        </span>
      </div>
      {problem && (
        <p role="alert" className="text-[#ff7b72] break-words">
          {problem}
        </p>
      )}
    </section>
  );
};

const startButton =
  "min-h-7 px-2 inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#21262d] text-[11px] text-[#c9d1d9] hover:bg-[#30363d]";

/**
 * Start: pinned Archon workflows as chips with a picker to pin more (every workflow is in the
 * palette), the top open spec tasks with an Agent button, recent Praxis graphs, and the
 * Factory's New work order and Factory config stage tabs.
 */
const StartSection = ({
  workflows,
  tasks,
  graphs,
  actions,
}: {
  workflows: readonly ArchonWorkflow[];
  tasks: readonly SpecTask[];
  graphs: readonly string[];
  actions: StartActions;
}) => {
  const pickerId = useId();
  const listed = new Set(workflows.map((w) => w.name));
  const pinned = actions.pinned.filter((name) => listed.has(name));
  const pinnable = workflows.filter((w) => !actions.pinned.includes(w.name));
  const openTasks = tasks.filter((t) => !t.completed).slice(0, START_TOP);
  return (
    <div className="space-y-2.5 text-xs">
      <div className="space-y-1.5">
        <ul aria-label="Pinned workflows" className="flex flex-wrap gap-1">
          {pinned.map((name) => (
            <li key={name} className="inline-flex items-stretch rounded-md border border-[#30363d] bg-[#21262d]">
              <button
                type="button"
                data-run-workflow
                title={`Start ${name} in a new terminal`}
                onClick={() => actions.onRunWorkflow(name)}
                className="min-h-7 px-2 text-[11px] text-[#c9d1d9] hover:bg-[#30363d] rounded-l-md"
              >
                {shortWorkflowName(name)}
              </button>
              <button
                type="button"
                aria-label={`Unpin ${shortWorkflowName(name)}`}
                onClick={() => actions.onUnpin(name)}
                className="min-h-7 min-w-6 px-1 border-l border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#30363d] rounded-r-md"
              >
                <X className="w-3 h-3 mx-auto" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {pinnable.length > 0 && (
          <div className="flex items-center gap-1.5">
            <label htmlFor={pickerId} className="shrink-0 text-[11px] text-[#8b949e]">
              Pin a workflow
            </label>
            <select
              id={pickerId}
              value=""
              onChange={(e) => {
                if (e.target.value) actions.onPin(e.target.value);
              }}
              className="min-w-0 flex-1 h-7 rounded-md border border-[#30363d] bg-[#0d1117] text-[11px] text-[#c9d1d9]"
            >
              <option value="">Choose a workflow</option>
              {pinnable.map((w) => (
                <option key={w.name} value={w.name}>
                  {shortWorkflowName(w.name)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <ul aria-label="Spec tasks" className="space-y-0.5">
          {openTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-1.5 min-h-7">
              <span data-task className="flex-1 min-w-0 truncate" title={`${task.file_name}: ${task.title}`}>
                {task.title}
              </span>
              <button type="button" aria-label={`Agent: ${task.title}`} onClick={() => actions.onAgentTask(task)} className={startButton}>
                <Bot className="w-3 h-3" aria-hidden="true" />
                Agent
              </button>
            </li>
          ))}
        </ul>
        {openTasks.length === 0 && <p className="text-[11px] text-[#8b949e]">No open spec tasks.</p>}
        <button type="button" onClick={actions.onAllTasks} className="min-h-6 text-[11px] text-[#58a6ff] hover:underline">
          All tasks and ADRs
        </button>
      </div>

      {graphs.length > 0 && (
        <ul aria-label="Recent Praxis graphs" className="flex flex-wrap gap-1">
          {graphs.slice(0, START_TOP).map((id) => (
            <li key={id}>
              <button type="button" title={`Open ${id} in the Praxis Builder`} onClick={() => actions.onOpenGraph(id)} className={startButton}>
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={actions.onNewWorkOrder} className={startButton}>
          <Plus className="w-3 h-3" aria-hidden="true" />
          New work order
        </button>
        <button type="button" onClick={actions.onFactoryConfig} className={startButton}>
          <FileCode2 className="w-3 h-3" aria-hidden="true" />
          Factory config
        </button>
      </div>
    </div>
  );
};
