// The Machina Factory's two stage tabs (#645), New work order and Factory config, which the
// Workflows panel's Start opens now that the Factory has no overlay.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FactoryConfigPanel } from "../machina/FactoryConfigPanel.tsx";
import { WorkOrderComposer } from "../machina/WorkOrderComposer.tsx";
import type { MachinaWorkOrder, ProjectFactoryInfo } from "../machina/types.ts";

/** The active project's Factory facts, read when the project changes; only the newest answer is kept. */
function useProjectFactoryInfo(activeProject: string) {
  const [info, setInfo] = useState<ProjectFactoryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!activeProject) {
      setInfo(null);
      setError("Open a project first.");
      return;
    }
    // An answer for a project the tab has since left is dropped.
    let current = true;
    invoke<ProjectFactoryInfo>("machina_get_project_info", { projectPath: activeProject }).then(
      (answer) => {
        if (!current) return;
        setInfo(answer);
        setError(null);
      },
      (e) => {
        if (!current) return;
        setInfo(null);
        setError(String(e));
      },
    );
    return () => {
      current = false;
    };
  }, [activeProject]);
  return { info, error, setInfo };
}

const Frame = ({ children, notice }: { children: ReactNode; notice: string | null }) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-[#0d1117] text-[#c9d1d9]">
    {notice && (
      <p role="status" className="mb-3 text-xs text-[#58a6ff]">
        {notice}
      </p>
    )}
    {children}
  </div>
);

/** New work order: the composer for the active project, which closes its tab once the work order is in. */
export const NewWorkOrderTab = ({
  activeProject,
  workOrders,
  onCreated,
  onClose,
  onOpenConfig,
}: {
  activeProject: string;
  workOrders: MachinaWorkOrder[];
  onCreated: (wo: MachinaWorkOrder) => void;
  onClose: () => void;
  onOpenConfig: () => void;
}) => {
  const { info, error } = useProjectFactoryInfo(activeProject);
  return (
    <Frame notice={null}>
      <WorkOrderComposer
        activeProject={activeProject}
        projectInfo={info}
        projectError={error}
        workOrders={workOrders}
        onCreated={onCreated}
        onCancel={onClose}
        onOpenConfig={onOpenConfig}
      />
    </Frame>
  );
};

/** Factory config: the active project's `.machina/factory.json`. */
export const FactoryConfigTab = ({ activeProject }: { activeProject: string }) => {
  const { info, error, setInfo } = useProjectFactoryInfo(activeProject);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = useCallback(
    (next: ProjectFactoryInfo) => {
      setInfo(next);
      setNotice("Saved .machina/factory.json.");
    },
    [setInfo],
  );
  return (
    <Frame notice={notice}>
      <FactoryConfigPanel activeProject={activeProject} projectInfo={info} projectError={error} onSaved={saved} />
    </Frame>
  );
};
