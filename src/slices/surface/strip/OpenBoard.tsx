import { lazy, Suspense } from "react";
import type { TerminalInfo } from "../../terminal/types.ts";
import { Bar } from "../../parts/Bar.tsx";
import { LockedBand } from "../LockedBand.tsx";
import { lookOf } from "../looks/index.ts";
import { SurfaceBoundary } from "../SurfaceBoundary.tsx";
import { SurfaceFrame } from "../SurfaceFrame.tsx";
import { loadA2ui } from "../surfaceHost.ts";
import { isLive } from "../surfaceTypes.ts";
import { PROGRESS_PART } from "../typed/board.ts";
import { useDismiss } from "../useDismiss.ts";
import { useRefusal } from "../useRefusal.ts";
import { BoardClock } from "./BoardClock.tsx";
import { readBoard, type BoardRecord } from "./boardReading.ts";
import { boardState } from "./boardState.ts";

const SurfaceContent = lazy(async () => ({ default: (await loadA2ui()).SurfaceContent }));

/** A board's title, how far it is and its clock, which are Quay's and not a part of it. */
const BoardHead = ({ record }: { record: BoardRecord }) => {
  const reading = readBoard(record);
  const { words, tone, bar } = boardState(record, reading);
  // What the agent counts has a bar of its own
  const counts = record.state.createSurface.components.some(({ id }) => id === PROGRESS_PART);
  return (
    <>
      <p className="font-semibold wrap-anywhere whitespace-pre-wrap text-white">{record.board.title}</p>
      <div className="flex min-w-0 items-center gap-2">
        {words !== null && <span className={`font-medium ${tone}`}>{words}</span>}
        {!counts && reading.share !== null ? <Bar share={reading.share} tone={bar} /> : <span className="flex-1" />}
        <BoardClock run={record.board} />
      </div>
    </>
  );
};

interface OpenBoardProps {
  record: BoardRecord;
  terminal: TerminalInfo;
}

/** A board in its frame. One that is locked keeps all it showed, under a band that says how it ended. */
export const OpenBoard = ({ record, terminal }: OpenBoardProps) => {
  const { kind, KindIcon, layout } = lookOf(record.tool);
  const { setRefusal, shown: refusal, dismiss: dismissRefusal } = useRefusal(null);
  const dismiss = useDismiss(record, setRefusal);
  const band = isLive(record) ? undefined : <LockedBand record={record} />;
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} band={band} dismiss={dismiss} refusal={refusal} onDismissRefusal={dismissRefusal}>
      <div className="flex min-w-0 flex-col gap-2.5">
        <BoardHead record={record} />
        <SurfaceBoundary key={record.change}>
          <Suspense fallback={<p className="text-[#8b949e]">Loading…</p>}>
            <SurfaceContent record={record} layout={layout} />
          </Suspense>
        </SurfaceBoundary>
      </div>
    </SurfaceFrame>
  );
};
