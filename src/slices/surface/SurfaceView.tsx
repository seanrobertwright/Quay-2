import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { formatClock, formatDateTime, formatUtcTimestamp } from "../../lib/dates.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { lookOf } from "./looks/index.ts";
import { QueueLine } from "./QueueLine.tsx";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { answerSurface, loadA2ui, useSurfacesRead } from "./surfaceHost.ts";
import { isLive, type SurfaceAction, type SurfaceRecord } from "./surfaceTypes.ts";
import { typedTool } from "./typed/index.ts";
import { useDismiss } from "./useDismiss.ts";
import { useSurfaceQueue } from "./useSurfaceQueue.ts";

const SurfaceContent = lazy(async () => ({ default: (await loadA2ui()).SurfaceContent }));

const Loading = () => <p className="text-[#8b949e]">Loading…</p>;

interface SurfaceProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
}

/** A surface the operator can act on. */
const LiveSurface = ({ record, terminal }: SurfaceProps) => {
  const { kind, KindIcon, layout } = lookOf(record.tool);
  const [refusal, setRefusal] = useState<string | null>(null);
  // What is unsent in it comes with the list
  const read = useSurfacesRead();
  const dismiss = useDismiss(record, setRefusal);
  const onAction = useCallback(
    async (action: SurfaceAction) => {
      const typed = typedTool(record.tool);
      if (!typed) {
        setRefusal("Not sent: Quay cannot send an answer to this kind of surface.");
        return;
      }
      setRefusal(null);
      try {
        await answerSurface(record, typed.collapse(action));
      } catch (error) {
        setRefusal(String(error));
      }
    },
    [record],
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} dismiss={dismiss} refusal={refusal}>
      <SurfaceBoundary key={record.revision}>
        <Suspense fallback={<Loading />}>
          {read ? <SurfaceContent record={record} layout={layout} onAction={onAction} /> : <Loading />}
        </Suspense>
      </SurfaceBoundary>
    </SurfaceFrame>
  );
};

/** A surface whose one answer has been given. */
const SettledSurface = ({ record, terminal }: SurfaceProps) => {
  const { kind, KindIcon, Settled } = lookOf(record.tool);
  const [refusal, setRefusal] = useState<string | null>(null);
  const dismiss = useDismiss(record, setRefusal);
  const band = (
    <div className="flex flex-wrap items-center gap-x-1.5 border-b border-[#30363d] px-3 py-1.5 text-[11px] text-[#8b949e]">
      <p role="status" className="flex items-center gap-1.5 text-[#3fb950]">
        <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        Answered and sent to the agent.
      </p>
      {record.answered_at !== null && (
        <time dateTime={formatUtcTimestamp(record.answered_at)} title={formatDateTime(record.answered_at)}>
          {formatClock(record.answered_at)}
        </time>
      )}
    </div>
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} band={band} dismiss={dismiss} refusal={refusal}>
      <SurfaceBoundary>{Settled && <Settled answer={record.answer} />}</SurfaceBoundary>
    </SurfaceFrame>
  );
};

/** The most questions one terminal may have waiting. Mirrors `MOST_LIVE`, which Rust holds all its live companion surfaces to. */
const MOST_WAITING = 4;

/** The surface a request asked to show. Each request has a `seq` of its own. */
export interface SurfaceFocus {
  surfaceId: string;
  seq: number;
}

interface SurfaceViewProps {
  terminal: TerminalInfo;
  surfaces: readonly SurfaceRecord[];
  focus?: SurfaceFocus | null;
}

/**
 * The Surface view: a terminal's companion surfaces, oldest first. Of those that ask one is open and
 * the rest are lines. The one `focus` names is brought into view.
 */
export const SurfaceView = ({ terminal, surfaces, focus = null }: SurfaceViewProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const queue = useSurfaceQueue(surfaces, focus);
  const regionOf = (id: string) =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-surface]") ?? [])].find((region) => region.dataset.surface === id);
  // The one a click opened. Its line leaves the screen, and would take the focus with it.
  const clicked = useRef<string | null>(null);
  useEffect(() => {
    if (clicked.current !== null) regionOf(clicked.current)?.focus();
    clicked.current = null;
  }, [queue.open]);
  const open = (record: SurfaceRecord) => {
    clicked.current = record.id;
    queue.choose(record);
  };
  useEffect(() => {
    if (!focus) return;
    regionOf(focus.surfaceId)?.scrollIntoView?.({ block: "start" });
  }, [focus]);
  return (
    <div ref={listRef} className="flex flex-col gap-2 p-2">
      {queue.waiting === MOST_WAITING && <p className="px-1 text-[11px] text-[#8b949e]">{MOST_WAITING} questions waiting, the most one terminal may have.</p>}
      {surfaces.map((record) => {
        // Not by revision: why an answer to an older one was not taken is said over the newer one
        const key = `${record.terminal_id} ${record.id}`;
        if (!isLive(record)) return <SettledSurface key={key} record={record} terminal={terminal} />;
        if (!record.asks || record === queue.open) return <LiveSurface key={key} record={record} terminal={terminal} />;
        return <QueueLine key={key} record={record} terminal={terminal} onOpen={() => open(record)} />;
      })}
    </div>
  );
};
