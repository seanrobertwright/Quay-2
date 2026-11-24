// The prompt of the approval gate an Archon run waits at (#713). The run list does not carry it, so
// it is read from the run's detail, and only for the run whose gate is on screen.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ArchonRunDetail } from "./types.ts";

/** How long after one read of a gate's prompt the next starts, in ms. */
const GATE_POLL_MS = 5_000;

/** What is known of an approval gate's prompt. */
export type GatePrompt =
  | { state: "reading" }
  /** `reason` is why, as the failed read gave it, or null when the run's detail held no prompt. */
  | { state: "unreadable"; reason: string | null }
  /** `gate` tells this request for approval from the run's others. */
  | { state: "read"; gate: string; prompt: string };

const READING: GatePrompt = { state: "reading" };

async function readGatePrompt(runId: string): Promise<GatePrompt> {
  try {
    const { pending_approval: pending } = await invoke<ArchonRunDetail>("archon_get_run_detail", { runId, includeHooks: false });
    if (!pending || pending.prompt.trim() === "") return { state: "unreadable", reason: null };
    return { state: "read", gate: JSON.stringify([pending.node_id, pending.requested_ms, pending.prompt]), prompt: pending.prompt };
  } catch (e) {
    return { state: "unreadable", reason: String(e) };
  }
}

/**
 * The prompt of the approval gate run `runId` waits at: read while the caller is mounted, again
 * `GATE_POLL_MS` after each read, since a run can reach its next gate without leaving the screen. A
 * prompt that can no longer be read is not kept. `readAgain` forgets what is known and reads at
 * once; a read from before it is dropped.
 */
export function useGatePrompt(runId: string): { gatePrompt: GatePrompt; readAgain: () => void } {
  const [round, setRound] = useState(0);
  const [known, setKnown] = useState<{ runId: string; round: number; gatePrompt: GatePrompt } | null>(null);
  useEffect(() => {
    let gone = false;
    let timer: number | undefined;
    const readOnce = async () => {
      const gatePrompt = await readGatePrompt(runId);
      if (gone) return;
      setKnown({ runId, round, gatePrompt });
      timer = window.setTimeout(() => void readOnce(), GATE_POLL_MS);
    };
    void readOnce();
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [runId, round]);
  const readAgain = useCallback(() => setRound((n) => n + 1), []);
  return { gatePrompt: known && known.runId === runId && known.round === round ? known.gatePrompt : READING, readAgain };
}
