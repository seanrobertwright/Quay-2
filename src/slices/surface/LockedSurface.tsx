import { useId, useState, type ReactNode } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { FoldButton } from "./FoldButton.tsx";
import { LockedBand } from "./LockedBand.tsx";
import { lookOf } from "./looks/index.ts";
import { NotSent } from "./NotSent.tsx";
import { RAW_TOOL } from "./rawTool.ts";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { useSurfacesRead } from "./surfaceHost.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { unsentIn } from "./unsent.ts";
import { wordsOf } from "./surfaceWords.ts";
import { useDismiss } from "./useDismiss.ts";

/** What was asked, folded behind `label`. */
const Folded = ({ label, children }: { label: string; children: ReactNode }) => {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="min-w-0">
      <FoldButton folds={id} shown={shown} onToggle={() => setShown(!shown)} className="min-h-6 text-[#58a6ff] hover:underline">
        {label}
      </FoldButton>
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
  /** Fills what it is in, and scrolls what it holds. */
  fills?: boolean;
  /** Why it was not dismissed from outside its frame. */
  notDismissed?: string | null;
}

/** A locked surface, in its frame: why and when, the operator's answer or what they had typed, and what was asked. */
export const LockedSurface = ({ record, terminal, fills = false, notDismissed = null }: LockedSurfaceProps) => {
  const { kind, KindIcon, Settled, Asked, askedLabel, typedIn } = lookOf(record.tool);
  const { components } = record.state.createSurface;
  const ended = record.ended_at !== null;
  const [refusal, setRefusal] = useState<string | null>(null);
  const dismiss = useDismiss(record, setRefusal);
  // What is unsent in it comes with the list
  const read = useSurfacesRead();
  const texts = ended && read ? typedIn(components, unsentIn(record)) : [];
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} band={<LockedBand record={record} />} dismiss={dismiss} refusal={refusal ?? notDismissed} fills={fills}>
      <SurfaceBoundary>
        <div className="flex min-w-0 flex-col gap-2.5">
          {(ended || record.tool === RAW_TOOL) && <p className="wrap-anywhere whitespace-pre-wrap">{wordsOf(record)}</p>}
          {!ended && Settled && <Settled answer={record.answer} components={components} />}
          {texts.length > 0 && <NotSent texts={texts} />}
          {Asked && (
            <Folded label={askedLabel}>
              <Asked components={components} record={record} />
            </Folded>
          )}
        </div>
      </SurfaceBoundary>
    </SurfaceFrame>
  );
};
