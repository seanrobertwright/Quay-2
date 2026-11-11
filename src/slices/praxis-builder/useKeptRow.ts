// The row a Runs view keeps for the run whose detail it shows (#579). A run's row leaves the Runs
// list once newer runs push it off, but its detail still draws what the row gave: a graph run's
// revision and times, which its own view doesn't give, and the fallback for any field a run's view
// lacks. So the detail is given the last row that named its run, and the newest while it is listed.
import { useState } from "react";
import type { RunRow } from "./runsList.ts";

/**
 * The row of run `workOrderId` in `runs`, the Runs list's last read, or once the list no longer
 * names the run, the last row that did. The row kept is one run's: another run starts with none.
 */
export function useKeptRow(runs: readonly RunRow[] | null, workOrderId: string | null): RunRow | null {
  const listed = runs?.find((r) => r.workOrderId === workOrderId) ?? null;
  const [kept, setKept] = useState(listed);
  if (listed !== null && listed !== kept) setKept(listed);
  return listed ?? (kept?.workOrderId === workOrderId ? kept : null);
}
