// One workflow template's host state as a line of text with Check again (#363, #451), for the
// template form and the Install on host… dialog. It draws `hostStatus.ts`'s view of the host
// catalog (#449) and never calls `praxis` itself: Check again asks the catalog.
import { useEffect, useState, type FC } from "react";
import { CircleHelp, RefreshCw } from "lucide-react";
import type { TemplateHostView } from "./hostCatalog.ts";
import { BADGE_ICONS, BADGE_TONES } from "./HostList.tsx";
import { templateStatusLine } from "./hostStatus.ts";
import type { HostCondition } from "./praxisHost.ts";

/** What a view needs to show a template's host state and check it again. */
export interface TemplateHost {
  view: TemplateHostView;
  condition: HostCondition;
  /** Rereads this template only. */
  onCheckAgain: () => void;
}

/** Draws again each minute while mounted, so "checked N min ago" stays true. */
function useMinuteTick(): void {
  const [, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
}

export const HostStatusLine: FC<{ host: TemplateHost }> = ({ host }) => {
  useMinuteTick();
  const line = templateStatusLine(host.view, host.condition, Date.now());
  const Icon = line.state === "unknown" ? CircleHelp : BADGE_ICONS[line.state];
  // A muted reading loses its colour, as the list's badge does; the text still says the state.
  const tone = line.muted ? `${BADGE_TONES.muted} opacity-60` : BADGE_TONES[line.tone];
  return (
    <div className="flex items-start gap-1.5 flex-wrap text-[11px] text-[#8b949e]">
      <span role="status" className="inline-flex items-start gap-1.5 min-w-0">
        <Icon className={`w-3.5 h-3.5 mt-px shrink-0 ${tone}`} aria-hidden="true" />
        <span className="min-w-0 break-words">
          <span className="sr-only">On the host: </span>
          <span className="text-[#c9d1d9]">{line.label}</span>
          {line.reason && <>. {line.reason}</>}
          {line.checked && <> · {line.checked}</>}
        </span>
      </span>
      {line.checkAgain && (
        <button
          type="button"
          // Not `disabled`, which would drop focus while the check runs.
          aria-disabled={line.checking}
          onClick={() => !line.checking && host.onCheckAgain()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] aria-disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${line.checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {line.checking ? "Checking…" : "Check again"}
        </button>
      )}
    </div>
  );
};
