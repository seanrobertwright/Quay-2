import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { Earlier } from "./Earlier.tsx";
import { lookOf } from "./looks/index.ts";
import { QueueLine } from "./QueueLine.tsx";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { answerSurface, loadA2ui, useSurfacesRead } from "./surfaceHost.ts";
import { isLive, type SurfaceAction, type SurfaceRecord } from "./surfaceTypes.ts";
import { typedTool } from "./typed/index.ts";
import { useDismiss } from "./useDismiss.ts";
import { useKeptFocus } from "./useKeptFocus.ts";
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
 * the rest are lines, and those that are over are folded beneath. The one `focus` names is brought into
 * view.
 */
export const SurfaceView = ({ terminal, surfaces, focus = null }: SurfaceViewProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const queue = useSurfaceQueue(surfaces, focus);
  // A locked surface changes no more, so its last change is its locking
  const locked = surfaces.filter((record) => !isLive(record)).sort((a, b) => b.change - a.change);
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
  const keptFocus = useKeptFocus(terminal.id, () => {
    const list = listRef.current;
    const next = queue.open && regionOf(queue.open.id);
    (next ?? list?.querySelector<HTMLElement>("[data-earlier]") ?? list)?.focus();
  });
  useEffect(() => {
    if (!focus) return;
    regionOf(focus.surfaceId)?.scrollIntoView?.({ block: "start" });
  }, [focus]);
  return (
    <div ref={listRef} tabIndex={-1} {...keptFocus} className="flex flex-col gap-2 p-2 focus:outline-none">
      {queue.waiting === MOST_WAITING && <p className="px-1 text-[11px] text-[#8b949e]">{MOST_WAITING} questions waiting, the most one terminal may have.</p>}
      {surfaces.filter(isLive).map((record) => {
        // Not by revision: why an answer to an older one was not taken is said over the newer one
        const key = `${record.terminal_id} ${record.id}`;
        if (!record.asks || record === queue.open) return <LiveSurface key={key} record={record} terminal={terminal} />;
        return <QueueLine key={key} record={record} terminal={terminal} onOpen={() => open(record)} />;
      })}
      {locked.length > 0 && <Earlier key={terminal.id} terminal={terminal} locked={locked} />}
    </div>
  );
};
