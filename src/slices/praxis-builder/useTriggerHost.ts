// Each project's trigger host model (#475) for the builder's session: one `TriggerHost` per
// project, kept in memory while the builder is mounted and disposed, with its calls and timers, on
// unmount. It feeds the model the project's listed graph triggers, the triggers with a saved Starts
// target, and the host condition, tells it when the Triggers group is shown, and which trigger's
// form is on screen, so a pending candidate is polled only while its form is. The views that draw
// graph trigger host states read them from here.
import { useEffect, useState } from "react";
import type { HostCondition } from "./praxisHost.ts";
import { createTriggerHost, type LocalGraphTrigger, type TriggerHost } from "./triggerHost.ts";
import type { DefinitionEntry } from "./types.ts";
import { useDocumentVisible } from "./useDocumentVisible.ts";
import { useProjectModels } from "./useProjectModels.ts";

const newTriggerHost = (projectPath: string) => createTriggerHost({ projectPath });

/** The listed triggers that are graph triggers: those with a saved Starts target. */
export function localGraphTriggers(entries: readonly DefinitionEntry[]): LocalGraphTrigger[] {
  return entries.flatMap((e) =>
    e.target === undefined ? [] : [{ name: e.id, target: e.target, enabled: e.enabled ?? null, nameProblem: e.nameProblem ?? null }],
  );
}

export interface TriggerHostModel {
  /** The shown project's model; null without a project. */
  triggers: TriggerHost | null;
  /** Bumped on every change to the shown model, so views that read it draw again. */
  version: number;
}

/**
 * `projectPath`'s trigger host model. `entries` is the project's listed triggers, or undefined
 * until they are listed; `groupShown` says the Triggers group is on screen, and `onScreen` names
 * the trigger whose form is, or is null.
 */
export function useTriggerHost(
  projectPath: string | null,
  entries: readonly DefinitionEntry[] | undefined,
  condition: HostCondition,
  groupShown: boolean,
  onScreen: string | null,
): TriggerHostModel {
  const { model: triggers } = useProjectModels(projectPath, newTriggerHost);
  const [version, setVersion] = useState(0);

  useEffect(() => triggers?.subscribe(() => setVersion((v) => v + 1)), [triggers]);

  useEffect(() => {
    if (triggers && entries) triggers.setLocal(localGraphTriggers(entries));
  }, [triggers, entries]);

  useEffect(() => {
    triggers?.setCondition(condition);
  }, [triggers, condition]);

  // The first read waits for the listing, so the shows cover the project's own graph triggers.
  const listed = entries !== undefined;
  useEffect(() => {
    if (triggers && groupShown && listed) void triggers.groupShown();
  }, [triggers, groupShown, listed]);

  // The candidate poll stops whenever the form leaves the screen, the window included.
  const visible = useDocumentVisible();
  const watched = visible ? onScreen : null;
  useEffect(() => {
    if (!triggers) return;
    triggers.watch(watched);
    return () => triggers.watch(null);
  }, [triggers, watched]);

  return { triggers, version };
}
