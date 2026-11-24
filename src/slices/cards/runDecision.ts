import type { HoldCard } from "../machina/types.ts";

/** A decision a run or work order waits on, with what its Quay card shows and sends. */
export type RunDecision =
  /** Archon approval gate: Approve or Reject. */
  | { kind: "archon-approval"; runId: string }
  /** Failed Archon run: Resume or Abandon. */
  | { kind: "archon-failed"; runId: string }
  /** Factory hold: the hold's own options. */
  | { kind: "factory-hold"; workOrderId: string; hold: HoldCard }
  /** Factory work order whose gate passed: Accept: squash-merge. */
  | { kind: "factory-accept"; workOrderId: string; baseBranch: string; repoPath: string }
  /** Failed work order, or with `failed` false an interrupted one: Resume. */
  | { kind: "factory-resume"; workOrderId: string; failed: boolean }
  /** Praxis decisions are made on the host's page in the browser. */
  | { kind: "praxis-browser" };
