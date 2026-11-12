// The host's agent picker for the builder's project (#482). It is read while the builder is
// shown and the project's host can be used, so a host that comes back is read as soon as its
// condition says so, and again when the host is checked again with Check host.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createAgentPickerReads, type AgentPicker } from "./agentPicker.ts";
import { hostConditionView } from "./hostCondition.ts";
import type { HostCondition } from "./praxisHost.ts";

export interface AgentPickerState {
  /** The project's picker, or null when it couldn't be read or hasn't been yet. */
  picker: AgentPicker | null;
  /** Reads the picker again. Does nothing while the host can't be used. */
  reread: () => void;
}

/** `projectPath`'s agent picker. `shown` says the builder is on screen. */
export function useAgentPicker(projectPath: string | null, condition: HostCondition, shown: boolean): AgentPickerState {
  const [reads] = useState(() => createAgentPickerReads());
  const readable = shown && hostConditionView(condition).usable;
  useEffect(() => {
    reads.follow(projectPath, readable);
  }, [reads, projectPath, readable]);
  // Unmounting cancels the read in flight.
  useEffect(() => () => reads.follow(null, false), [reads]);
  const picker = useSyncExternalStore(reads.subscribe, reads.current);
  const reread = useCallback(() => reads.reread(), [reads]);
  return { picker, reread };
}
