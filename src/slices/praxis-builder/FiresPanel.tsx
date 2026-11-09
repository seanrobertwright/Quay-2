// A graph trigger's Fires panel on its form (#469, #478): the trigger's fires on the Praxis host,
// newest first, each with when the host received it, its disposition and its reason code, and for
// a fire that created a graph run, a link to that run in the target graph workflow's Runs view.
// The panel opens on demand and reads at once, then every 15 s while it is open and shown, through
// the fires list model (`firesList.ts`). While the host can't be used, the last list stays, dimmed,
// with its read time. There is no fire, admit, reject or enable control: those aren't Quay's.
import { useId, useState, type FC } from "react";
import { ChevronDown, ChevronRight, CircleArrowRight } from "lucide-react";
import { formatClock, formatDateTime } from "../../lib/dates.ts";
import { ADMITTED, FIRES_MAX_LIMIT, type FireRow } from "./firesList.ts";
import { hintClass, Section } from "./RecordFields.tsx";
import type { GraphTriggerHost } from "./TriggerHostPanel.tsx";
import { useFiresList } from "./useFiresList.ts";

/** What the trigger form needs from the builder for its Fires panel. */
export interface TriggerFires {
  /** True while the builder is shown. It is only hidden when it closes, so the panel stops by this. */
  shown: boolean;
  /** The graph workflow the trigger starts, from its saved target; null without one. */
  workflow: string | null;
  /** Shows run `workOrderId` in graph workflow `workflow`'s Runs view. */
  onShowRun: (workflow: string, workOrderId: string) => void;
}

const buttonClass = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-[#c9d1d9]";

export const FiresPanel: FC<{ projectPath: string; name: string; host: GraphTriggerHost; fires: TriggerFires }> = ({ projectPath, name, host, fires }) => {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  // Quay never sends praxis a name the host refuses.
  const readable = host.view.state.kind !== "nameRefused";
  const { list, view } = useFiresList(projectPath, name, open && fires.shown && readable);
  const readAt = view.readAt === null ? null : formatClock(view.readAt);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Section title="Fires">
      <p className={hintClass}>What the host did with each occurrence of this trigger, newest first.</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((o) => !o)} className={buttonClass}>
          <Chevron className="w-3.5 h-3.5" aria-hidden="true" />
          {open ? "Hide fires" : "Show fires"}
        </button>
        {open && readable && (
          <button type="button" onClick={() => list?.refresh()} className={buttonClass}>
            Read again
          </button>
        )}
      </div>
      {open && (
        <div id={bodyId} className="space-y-2">
          {!readable ? (
            <p className={hintClass}>Quay doesn&apos;t send praxis a name the host refuses.</p>
          ) : (
            <>
              <div role="status" className="text-[11px] text-[#8b949e] space-y-1">
                {view.fires === null && view.problem === null && <p>Reading the fires of {name}…</p>}
                {view.dimmed && (
                  <p className="text-[#f85149]">
                    The host can&apos;t be used, so this list may be out of date{readAt ? `: it was read at ${readAt}` : ""}. {view.problem}
                  </p>
                )}
                {!view.dimmed && view.problem && <p className="text-[#f85149]">{view.problem}</p>}
                {!view.dimmed && readAt && <p>Read at {readAt}.</p>}
              </div>
              {view.fires !== null && view.fires.length === 0 && <p className="text-xs text-[#8b949e]">The host has no fires of {name}.</p>}
              {view.fires !== null && view.fires.length > 0 && (
                <ul aria-label="Fires" className={`divide-y divide-[#21262d] border border-[#30363d] rounded-md ${view.dimmed ? "opacity-50" : ""}`}>
                  {view.fires.map((fire) => (
                    <FireItem key={fire.fireId} fire={fire} workflow={fires.workflow} onShowRun={fires.onShowRun} />
                  ))}
                </ul>
              )}
              {view.canShowMore && (
                <button type="button" onClick={() => list?.showMore()} className={buttonClass}>
                  Show more
                </button>
              )}
              {view.atCap && (
                <p className={hintClass}>
                  Showing the newest {FIRES_MAX_LIMIT} fires, the most the host gives at once. Older fires aren&apos;t shown.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
};

const FireItem: FC<{ fire: FireRow; workflow: string | null; onShowRun: TriggerFires["onShowRun"] }> = ({ fire, workflow, onShowRun }) => {
  const run = fire.disposition === ADMITTED ? fire.workOrderId : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-[#c9d1d9]">
      <span className="text-[#8b949e]">
        <span className="sr-only">Received </span>
        {fire.receivedAt === null ? fire.receivedAtText : formatDateTime(fire.receivedAt)}
      </span>
      <span data-chip="disposition" className="px-1.5 py-px rounded-full border border-[#30363d] bg-[#21262d] text-[10px]">
        {fire.disposition}
      </span>
      {fire.reason !== null && (
        <span className="font-mono text-[#8b949e]">
          <span className="sr-only">Reason </span>
          {fire.reason}
        </span>
      )}
      {fire.skippedCount !== null && <span className="text-[#8b949e]">{fire.skippedCount === 1 ? "1 slot" : `${fire.skippedCount} slots`}</span>}
      {run !== null && workflow !== null && (
        <button
          type="button"
          aria-label={`Show the run fire ${fire.fireId} created in the Runs of ${workflow}`}
          onClick={() => onShowRun(workflow, run)}
          className="ml-auto inline-flex items-center gap-1 text-[#58a6ff] hover:underline"
        >
          <CircleArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          Show run
        </button>
      )}
    </li>
  );
};
