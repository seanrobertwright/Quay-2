// Each project's graph host model (#461) for the builder's session: one `GraphHost` per project,
// kept in memory while the builder is mounted and disposed, with its calls and timers, on unmount.
// It feeds the model the project's listed graph workflows and host condition, tells it when the
// Graph workflows group is shown, and which graph workflow's form is on screen, so a pending
// candidate is polled only while its form is. The views that draw host states read them from here.
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePath } from "../../utils/paths.ts";
import { createGraphHost, type GraphHost, type LocalGraphWorkflow } from "./graphHost.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { DefinitionEntry } from "./types.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";

export interface GraphHostModel {
  /** The shown project's model; null without a project. */
  graphs: GraphHost | null;
  /** Bumped on every change to the shown model, so views that read it draw again. */
  version: number;
}

/**
 * `projectPath`'s graph host model. `workflows` is the project's listed graph workflows, or
 * undefined until they are listed; `groupShown` says the Graph workflows group is on screen, and
 * `onScreen` names the graph workflow whose form is, or is null.
 */
export function useGraphHost(
  projectPath: string | null,
  workflows: readonly DefinitionEntry[] | undefined,
  condition: HostCondition,
  groupShown: boolean,
  onScreen: string | null,
): GraphHostModel {
  const models = useRef(new Map<string, GraphHost>());
  const [version, setVersion] = useState(0);

  // Counts mounts, so a remount (as StrictMode does) makes fresh models after the cleanup
  // disposed the old ones. No model exists before the first mount.
  const [mounts, setMounts] = useState(0);
  useEffect(() => {
    setMounts((n) => n + 1);
    const all = models.current;
    return () => {
      for (const m of all.values()) m.dispose();
      all.clear();
    };
  }, []);

  const graphs = useMemo(() => {
    if (mounts === 0 || !projectPath) return null;
    const key = normalizePath(projectPath);
    let model = models.current.get(key);
    if (!model) {
      model = createGraphHost({ projectPath });
      models.current.set(key, model);
    }
    return model;
  }, [mounts, projectPath]);

  useEffect(() => graphs?.subscribe(() => setVersion((v) => v + 1)), [graphs]);

  useEffect(() => {
    if (!graphs || !workflows) return;
    const local: LocalGraphWorkflow[] = workflows.map((w) => ({
      name: w.id,
      bundleDigest: w.bundleDigest ?? null,
      nameProblem: w.nameProblem ?? null,
    }));
    graphs.setLocal(local);
  }, [graphs, workflows]);

  useEffect(() => {
    graphs?.setCondition(condition);
  }, [graphs, condition]);

  // The first read waits for the listing, so the shows cover the project's own graph workflows.
  const listed = workflows !== undefined;
  useEffect(() => {
    if (graphs && groupShown && listed) void graphs.groupShown();
  }, [graphs, groupShown, listed]);

  // The candidate poll stops whenever the form leaves the screen, the window included.
  const visible = useDocumentVisible();
  const watched = visible ? onScreen : null;
  useEffect(() => {
    if (!graphs) return;
    graphs.watch(watched);
    return () => graphs.watch(null);
  }, [graphs, watched]);

  return { graphs, version };
}
