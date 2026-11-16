// Reads the three engines for the Workflows panel and the Run view (#645), while either is on
// screen: Archon's server, the Machina Factory, and the Praxis host for the builder project.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ArchonRun, ArchonServiceStatus, ArchonWorkflow, RepoSpecSummary } from "../archon/types.ts";
import type { MachinaStatus, MachinaWorkOrder } from "../machina/types.ts";
import { hostConditionView } from "../praxis-builder/hostCondition.ts";
import { outcomeMessage, praxisCall } from "../praxis-builder/praxisHost.ts";
import { GRAPH_RUNS, RUNS_FIRST_LIMIT, type RunPageLookup, type RunRow } from "../praxis-builder/runsList.ts";
import type { DefinitionList } from "../praxis-builder/types.ts";
import { useHostCondition } from "../praxis-builder/useHostCondition.ts";
import { recentGraphs as orderRecent } from "./workflowPrefs.ts";
import { EMPTY_WORKFLOWS_DATA, type WorkflowsData } from "./workflowsData.ts";

/** How often Archon and the Factory are read while the panel or Run view shows, in ms. */
const ENGINE_POLL_MS = 5_000;
/** How often the Praxis graph runs are read, in ms: the builder's own Runs list delay. */
const PRAXIS_POLL_MS = 15_000;
/** The most graph workflows whose runs the panel reads, so a project with many costs a bounded number of `praxis` calls. */
export const MAX_PRAXIS_WORKFLOWS = 5;

interface Options {
  /** True while the Workflows panel or the Run view is on screen. */
  active: boolean;
  /** The active project, whose spec tasks Start lists. */
  project: string;
  /** The Praxis Builder's project, or null when none is open. */
  praxisProject: string | null;
  /** The ids of the graphs the Praxis project opened, most recent first. */
  recentGraphs: readonly string[];
}

type ArchonPart = WorkflowsData["archon"];
type FactoryPart = WorkflowsData["factory"];
type PraxisLists = { graphs: string[]; runs: WorkflowsData["praxis"]["runs"] };

async function readArchon(project: string): Promise<ArchonPart> {
  const service = await invoke<ArchonServiceStatus>("archon_check_service").catch(() => null);
  const online = service?.running ?? false;
  const [runs, workflows, specs] = await Promise.all([
    online ? invoke<ArchonRun[]>("archon_get_runs").catch(() => []) : Promise.resolve([]),
    online ? invoke<ArchonWorkflow[]>("archon_get_workflows").catch(() => []) : Promise.resolve([]),
    project ? invoke<RepoSpecSummary>("archon_parse_repo_specs", { projectPath: project }).catch(() => null) : Promise.resolve(null),
  ]);
  return { online, runs, workflows, tasks: specs?.tasks ?? [] };
}

async function readFactory(): Promise<FactoryPart> {
  try {
    const [status, workOrders] = await Promise.all([
      invoke<MachinaStatus>("machina_get_status"),
      invoke<MachinaWorkOrder[]>("machina_list_work_orders"),
    ]);
    return { status, workOrders };
  } catch {
    return { status: null, workOrders: [] };
  }
}

const listIds = (projectPath: string, kind: string) =>
  invoke<DefinitionList>("praxis_list", { projectPath, kind }).then(
    (list) => list.entries.filter((e) => !e.problem).map((e) => e.id),
    () => [] as string[],
  );

async function readPraxis(projectPath: string, hostUsable: boolean, signal: AbortSignal): Promise<PraxisLists> {
  const [graphs, workflows] = await Promise.all([listIds(projectPath, "graphs"), listIds(projectPath, "graph-workflows")]);
  if (!hostUsable) return { graphs, runs: [] };
  const lists = await Promise.all(
    workflows.slice(0, MAX_PRAXIS_WORKFLOWS).map(async (workflow) => {
      const outcome = await praxisCall("praxis_host_graph_runs", { projectPath, name: workflow, limit: RUNS_FIRST_LIMIT }, signal);
      if (outcome.kind !== "record" || !Array.isArray(outcome.record.runs)) return [];
      return outcome.record.runs.map(GRAPH_RUNS.parseRun).filter((r): r is RunRow => r !== null).map((run) => ({ workflow, run }));
    }),
  );
  return { graphs, runs: lists.flat() };
}

/**
 * The engines' state, read when `active` turns on and every few seconds while it stays on, and
 * again when Machina says its state changed. Only the newest read of each engine is kept, so a
 * slow answer never overwrites a fresh one. `refresh` reads Archon and the Factory at once.
 */
export function useWorkflowsData({ active, project, praxisProject, recentGraphs }: Options) {
  const [archon, setArchon] = useState<ArchonPart>(EMPTY_WORKFLOWS_DATA.archon);
  const [factory, setFactory] = useState<FactoryPart>(EMPTY_WORKFLOWS_DATA.factory);
  const [praxisLists, setPraxisLists] = useState<{ project: string; lists: PraxisLists } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { condition } = useHostCondition(praxisProject, active);
  const hostUsable = hostConditionView(condition).usable;
  const engineSeq = useRef(0);

  const readEngines = useCallback(async () => {
    const seq = ++engineSeq.current;
    const [a, f] = await Promise.all([readArchon(project), readFactory()]);
    if (seq !== engineSeq.current) return;
    setArchon(a);
    setFactory(f);
    setNow(Date.now());
  }, [project]);

  useEffect(() => {
    if (!active) return;
    const seq = engineSeq;
    void readEngines();
    const timer = window.setInterval(() => void readEngines(), ENGINE_POLL_MS);
    let unlisten: (() => void) | null = null;
    let gone = false;
    void listen("machina-state-updated", () => void readEngines()).then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    });
    return () => {
      gone = true;
      window.clearInterval(timer);
      unlisten?.();
      // A read still in flight is dropped when it lands.
      seq.current++;
    };
  }, [active, readEngines]);

  useEffect(() => {
    if (!active || !praxisProject) return;
    const controller = new AbortController();
    const readOnce = async () => {
      const lists = await readPraxis(praxisProject, hostUsable, controller.signal);
      if (!controller.signal.aborted) setPraxisLists({ project: praxisProject, lists });
    };
    void readOnce();
    const timer = window.setInterval(() => void readOnce(), PRAXIS_POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [active, praxisProject, hostUsable]);

  const lists = praxisLists && praxisLists.project === praxisProject ? praxisLists.lists : { graphs: [], runs: [] };
  const data: WorkflowsData = {
    archon,
    factory,
    praxis: { condition, graphs: orderRecent(lists.graphs, recentGraphs), runs: lists.runs },
  };
  return { data, now, refresh: readEngines };
}

/** Where graph run `workOrderId`'s page is on the Praxis host, from `praxis status`, for a run whose list entry gave none. */
export async function lookupGraphRunPage(projectPath: string, workOrderId: string): Promise<RunPageLookup> {
  const outcome = await praxisCall("praxis_host_graph_status", { projectPath, workOrderId }, new AbortController().signal);
  if (outcome.kind !== "record") return { problem: outcomeMessage(outcome) };
  const address = outcome.record.runPageAddress;
  return typeof address === "string" ? { address } : { problem: "praxis gave no address for this run's page." };
}
