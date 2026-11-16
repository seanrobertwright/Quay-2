// What the Workflows panel and the Run view read from the three engines (#645).
import type { ArchonRun, ArchonWorkflow, SpecTask } from "../archon/types.ts";
import type { MachinaStatus, MachinaWorkOrder } from "../machina/types.ts";
import type { HostCondition } from "../praxis-builder/praxisHost.ts";
import type { RunRow } from "../praxis-builder/runsList.ts";
import type { RunSource } from "./workflowRuns.ts";

/** The engines' state as last read. */
export interface WorkflowsData {
  archon: {
    /** Whether the Archon server answers; null before the first check. */
    online: boolean | null;
    runs: ArchonRun[];
    workflows: ArchonWorkflow[];
    /** The active project's spec tasks, in file order. */
    tasks: SpecTask[];
  };
  factory: {
    /** Null before the first read, or while Machina can't be read. */
    status: MachinaStatus | null;
    workOrders: MachinaWorkOrder[];
  };
  praxis: {
    condition: HostCondition;
    /** The builder project's graph ids, most recently opened first. */
    graphs: string[];
    /** Runs of the builder project's graph workflows. */
    runs: { workflow: string; run: RunRow }[];
  };
}

/** The engines' state before anything was read. */
export const EMPTY_WORKFLOWS_DATA: WorkflowsData = {
  archon: { online: null, runs: [], workflows: [], tasks: [] },
  factory: { status: null, workOrders: [] },
  praxis: { condition: { state: "notCheckedYet" }, graphs: [], runs: [] },
};

/** Every run and work order in `data`, as its engine reports it. */
export function runSources(data: WorkflowsData): RunSource[] {
  return [
    ...data.archon.runs.map((run): RunSource => ({ engine: "archon", run })),
    ...data.factory.workOrders.map((workOrder): RunSource => ({ engine: "factory", workOrder })),
    ...data.praxis.runs.map(({ workflow, run }): RunSource => ({ engine: "praxis", workflow, run })),
  ];
}
