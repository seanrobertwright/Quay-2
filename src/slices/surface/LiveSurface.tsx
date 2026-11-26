import { lazy, Suspense, useCallback } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { answerOf } from "./answerOf.ts";
import { lookOf } from "./looks/index.ts";
import { ReopenedBand } from "./ReopenedBand.tsx";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { answerSurface, loadA2ui, useSurfacesRead } from "./surfaceHost.ts";
import { SurfaceTitle } from "./SurfaceTitle.tsx";
import type { SentAction, SurfaceRecord } from "./surfaceTypes.ts";
import { useDismiss } from "./useDismiss.ts";
import { useMove } from "./useMove.ts";
import { useRefusal } from "./useRefusal.ts";

const SurfaceContent = lazy(async () => ({ default: (await loadA2ui()).SurfaceContent }));

const Loading = () => <p className="text-[#8b949e]">Loading…</p>;

interface LiveSurfaceProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
  /** Fills what it is in, and scrolls what it holds. */
  fills?: boolean;
  /** Why it was not dismissed from outside its frame. */
  notDismissed?: string | null;
  /** Takes that away, at its notice's ×. */
  onForgetNotDismissed?: () => void;
}

/** A surface the operator can act on. */
export const LiveSurface = ({ record, terminal, fills = false, notDismissed = null, onForgetNotDismissed }: LiveSurfaceProps) => {
  const { kind, KindIcon, layout } = lookOf(record.tool);
  const { setRefusal, shown: refusal, dismiss: dismissRefusal } = useRefusal(notDismissed, onForgetNotDismissed);
  // What is unsent in it comes with the list
  const read = useSurfacesRead();
  const dismiss = useDismiss(record, setRefusal);
  const move = useMove(record, setRefusal);
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
    [record, setRefusal],
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} band={<ReopenedBand record={record} />} dismiss={dismiss} move={move} refusal={refusal} onDismissRefusal={dismissRefusal} fills={fills}>
      <SurfaceTitle record={record} />
      <SurfaceBoundary revision={record.revision}>
        <Suspense fallback={<Loading />}>
          {read ? <SurfaceContent record={record} layout={layout} onAction={onAction} onRefused={setRefusal} /> : <Loading />}
        </Suspense>
      </SurfaceBoundary>
    </SurfaceFrame>
  );
};
