// Open in browser for a Runs view (#452, #466): a run's page from the list, a created run's or a
// blocking run's from Run's outcome, and the notice that says why one didn't open. The template
// and graph Runs views open pages through here.
import { useState } from "react";
import { openRunPageOf } from "./runPage.ts";
import type { RunPageLookup, RunRow, RunsList } from "./runsList.ts";

export interface RunPages {
  /** Why the last page didn't open; null once one opened or the notice was cleared. */
  notice: string | null;
  clearNotice(): void;
  /** Opens run `label`'s page at `address`, or looks it up by `workOrderId` when praxis gave none. */
  openPage(label: string, address: string | null, workOrderId: string | null): void;
  /** Opens a listed run's page. */
  openInBrowser(row: RunRow): void;
}

/** The pages of `list`'s runs; nothing opens until the list is made. */
export function useRunPages(list: RunsList | null): RunPages {
  const [notice, setNotice] = useState<string | null>(null);
  const open = async (label: string, address: string | null, lookup: (list: RunsList) => Promise<RunPageLookup>) => {
    if (!list) return;
    setNotice(null);
    setNotice(await openRunPageOf(label, address, () => lookup(list)));
  };
  return {
    notice,
    clearNotice: () => setNotice(null),
    openPage(label, address, workOrderId) {
      void open(label, address, (l) => (workOrderId === null ? Promise.resolve({ problem: "praxis named no run." }) : l.runPage(workOrderId)));
    },
    openInBrowser(row) {
      void open(row.runId, row.runPageAddress, (l) => l.runPage(row.workOrderId));
    },
  };
}
