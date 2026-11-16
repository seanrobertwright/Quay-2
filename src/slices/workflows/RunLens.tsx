import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lens } from "../lens/Lens.tsx";
import { focusTerminal } from "../terminal/terminalRequests.ts";
import { ArchonRunMonitor } from "../archon/ArchonRunMonitor.tsx";
import type { ArchonWorkflow } from "../archon/types.ts";
import { WorkOrderDetail, type RunAction } from "../machina/WorkOrderDetail.tsx";
import type { MachinaWorkOrder } from "../machina/types.ts";
import { GraphRunDetail } from "../praxis-builder/GraphRunDetail.tsx";
import type { SpawnTerminalRequest, TerminalInfo } from "../terminal/types.ts";
import { lookupGraphRunPage } from "./useWorkflowsData.ts";
import { rowOf, type RunSource } from "./workflowRuns.ts";

interface RunLensProps {
  source: RunSource;
  now: number;
  /** The selected terminal, which takes keyboard focus back when the lens closes. */
  terminalId: string;
  /** The project a Praxis run's graph workflow belongs to. */
  projectPath: string;
  archonOnline: boolean;
  /** Archon's workflows, whose plans draw an Archon run's graph. */
  workflows: ArchonWorkflow[];
  terminals: TerminalInfo[];
  /** Called after an action in the lens went through, so the engines are read again. */
  onChanged: () => void;
  onSelectTerminal: (id: string) => void;
  onSpawnTerminal: (request: SpawnTerminalRequest) => Promise<unknown>;
  replyStrip: ReactNode;
  onClose: () => void;
}

/**
 * The run lens: a run's full graph and log over the stage, closing like every lens. An Archon run
 * shows its node graph and event log, a work order its stages, gate report and events, and a
 * Praxis run its run canvas.
 */
export const RunLens = ({ source, now, terminalId, replyStrip, onClose, ...rest }: RunLensProps) => {
  const row = rowOf(source, now);
  return (
    <Lens label="Run lens" title={`Run · ${row.name}`} terminalId={terminalId} onClose={onClose} replyStrip={replyStrip}>
      <RunLensBody
        source={source}
        now={now}
        {...rest}
        onClose={() => {
          onClose();
          focusTerminal(terminalId);
        }}
      />
    </Lens>
  );
};

const RunLensBody = ({
  source,
  now,
  projectPath,
  archonOnline,
  workflows,
  terminals,
  onChanged,
  onSelectTerminal,
  onSpawnTerminal,
  onClose,
}: Omit<RunLensProps, "terminalId" | "replyStrip">) => {
  switch (source.engine) {
    case "archon":
      return (
        <ArchonRunMonitor
          runs={[source.run]}
          workflows={workflows}
          selectedRunId={source.run.id}
          onSelectRun={() => {}}
          serviceOnline={archonOnline}
          showRunList={false}
        />
      );
    case "factory":
      return (
        <WorkOrderLensBody
          wo={source.workOrder}
          now={now}
          terminals={terminals}
          onChanged={onChanged}
          onSelectTerminal={onSelectTerminal}
          onSpawnTerminal={onSpawnTerminal}
        />
      );
    case "praxis": {
      const { workflow, run } = source;
      const runPage = (workOrderId: string) => lookupGraphRunPage(projectPath, workOrderId);
      return (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <GraphRunDetail projectPath={projectPath} workflow={workflow} workOrderId={run.workOrderId} row={run} unlisted="complete" shown runPage={runPage} onClose={onClose} />
        </div>
      );
    }
  }
};

/** A work order's stages, gate report and events, with the actions the Factory overlay offered. */
const WorkOrderLensBody = ({
  wo,
  now,
  terminals,
  onChanged,
  onSelectTerminal,
  onSpawnTerminal,
}: {
  wo: MachinaWorkOrder;
  now: number;
  terminals: TerminalInfo[];
  onChanged: () => void;
  onSelectTerminal: (id: string) => void;
  onSpawnTerminal: (request: SpawnTerminalRequest) => Promise<unknown>;
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const run: RunAction = async (label, fn, success) => {
    setBusy(label);
    try {
      await fn();
      if (success) setNotice({ kind: "info", text: success });
      onChanged();
    } catch (e) {
      setNotice({ kind: "error", text: `${label} failed: ${String(e)}` });
    } finally {
      setBusy(null);
    }
  };
  const launchAuthor = (order: MachinaWorkOrder) =>
    run(
      "Launch author",
      async () => {
        const terminalId = `machina-${order.id.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
        await onSpawnTerminal({ id: terminalId, project_path: order.worktreePath, run_kind: order.authorAgent, name: `${order.id} author` });
        await invoke("machina_bind_author_terminal", { workOrderId: order.id, terminalId });
      },
      `Launched the author for ${order.id}. Once the agent is ready, send it the brief.`,
    );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 text-[#c9d1d9]">
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mb-3 text-xs ${notice.kind === "error" ? "text-[#ff7b72]" : "text-[#58a6ff]"}`}>
          {notice.text}
        </p>
      )}
      <WorkOrderDetail
        wo={wo}
        now={now}
        terminals={terminals}
        busy={busy}
        run={run}
        onLaunchAuthor={(order) => void launchAuthor(order)}
        onOpenTerminal={onSelectTerminal}
      />
    </div>
  );
};
