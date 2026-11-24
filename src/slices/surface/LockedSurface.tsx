import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { TerminalInfo } from "../terminal/types.ts";
import { lockedState } from "./lockedState.ts";
import { lookOf } from "./looks/index.ts";
import { NotSent } from "./NotSent.tsx";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { useSurfacesRead } from "./surfaceHost.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { unsentIn } from "./unsent.ts";
import { useDismiss } from "./useDismiss.ts";
import { When } from "./When.tsx";

/** What was asked, folded. */
const Folded = ({ children }: { children: ReactNode }) => {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        onClick={() => setShown(!shown)}
        className="flex min-h-6 items-center gap-1 text-[11px] text-[#58a6ff] hover:underline"
      >
        <ChevronRight aria-hidden="true" className={`h-3 w-3 shrink-0 ${shown ? "rotate-90" : ""}`} />
        What was asked
      </button>
      {shown && (
        <div id={id} className="mt-1.5">
          {children}
        </div>
      )}
    </div>
  );
};

interface LockedSurfaceProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
}

/** A surface that is over, in its frame: why and when, the operator's answer or what they had typed, and what was asked. */
export const LockedSurface = ({ record, terminal }: LockedSurfaceProps) => {
  const { kind, KindIcon, asksFor, Settled, Asked, typedIn } = lookOf(record.tool);
  const { reason, Icon, tone, at } = lockedState(record);
  const { components } = record.state.createSurface;
  const ended = record.ended_at !== null;
  const [refusal, setRefusal] = useState<string | null>(null);
  const dismiss = useDismiss(record, setRefusal);
  // What is unsent in it comes with the list
  const read = useSurfacesRead();
  const texts = ended && read ? typedIn(components, unsentIn(record)) : [];
  const band = (
    <div className="flex flex-wrap items-center gap-x-1.5 border-b border-[#30363d] px-3 py-1.5 text-[11px] text-[#8b949e]">
      <p role="status" className={`flex items-center gap-1.5 ${tone}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {reason}
      </p>
      {at !== null && <When ms={at} />}
    </div>
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} band={band} dismiss={dismiss} refusal={refusal}>
      <SurfaceBoundary>
        <div className="flex min-w-0 flex-col gap-2.5">
          {ended && <p className="wrap-anywhere whitespace-pre-wrap">{asksFor(components)}</p>}
          {!ended && Settled && <Settled answer={record.answer} />}
          {texts.length > 0 && <NotSent texts={texts} />}
          {Asked && (
            <Folded>
              <Asked components={components} />
            </Folded>
          )}
        </div>
      </SurfaceBoundary>
    </SurfaceFrame>
  );
};
