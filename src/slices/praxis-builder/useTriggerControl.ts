// The trigger control model (#477) for the shown project's trigger host model: made with it, and
// made again when the project or its model changes. It holds no calls to dispose.
import { useMemo } from "react";
import { createTriggerControl, type TriggerControl } from "./triggerControl.ts";
import type { TriggerHost } from "./triggerHost.ts";

/** The control model for `projectPath`'s trigger host model; null without either. */
export function useTriggerControl(projectPath: string | null, triggers: TriggerHost | null): TriggerControl | null {
  return useMemo(() => (projectPath && triggers ? createTriggerControl({ projectPath, triggers }) : null), [projectPath, triggers]);
}
