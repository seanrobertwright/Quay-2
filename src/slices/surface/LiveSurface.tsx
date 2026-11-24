import { lazy, Suspense, useCallback, useState } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { answerOf } from "./answerOf.ts";
import { lookOf } from "./looks/index.ts";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { answerSurface, loadA2ui, useSurfacesRead } from "./surfaceHost.ts";
import { SurfaceTitle } from "./SurfaceTitle.tsx";
import type { SentAction, SurfaceRecord } from "./surfaceTypes.ts";
import { useDismiss } from "./useDismiss.ts";

const SurfaceContent = lazy(async () => ({ default: (await loadA2ui()).SurfaceContent }));

const Loading = () => <p className="text-[#8b949e]">Loading…</p>;

interface LiveSurfaceProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
  /** Fills what it is in, and scrolls what it holds. */
  fills?: boolean;
  /** Why it was not dismissed from outside its frame. */
  notDismissed?: string | null;
}

/** A surface the operator can act on. */
export const LiveSurface = ({ record, terminal, fills = false, notDismissed = null }: LiveSurfaceProps) => {
  const { kind, KindIcon, layout } = lookOf(record.tool);
  const [refusal, setRefusal] = useState<string | null>(null);
  // What is unsent in it comes with the list
  const read = useSurfacesRead();
  const dismiss = useDismiss(record, setRefusal);
  const onAction = useCallback(
    async (action: SentAction) => {
      const answer = answerOf(record.tool, action);
      if (answer === null) {
        setRefusal("Not sent: Quay cannot send an answer to this kind of surface.");
        return;
      }
      setRefusal(null);
      try {
        await answerSurface(record, answer);
      } catch (error) {
        setRefusal(String(error));
      }
    },
    [record],
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} dismiss={dismiss} refusal={refusal ?? notDismissed} fills={fills}>
      <SurfaceTitle record={record} />
      <SurfaceBoundary key={record.revision}>
        <Suspense fallback={<Loading />}>
          {read ? <SurfaceContent record={record} layout={layout} onAction={onAction} /> : <Loading />}
        </Suspense>
      </SurfaceBoundary>
    </SurfaceFrame>
  );
};
