import { useEffect, useRef } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { Earlier } from "./Earlier.tsx";
import { LiveSurface } from "./LiveSurface.tsx";
import { QueueLine } from "./QueueLine.tsx";
import { surfaceKey } from "./surfaceAttention.ts";
import { isLive, type SurfaceRecord } from "./surfaceTypes.ts";
import { useKeptFocus } from "./useKeptFocus.ts";
import { useSurfaceQueue } from "./useSurfaceQueue.ts";

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
 * the rest are lines, and the locked ones are folded beneath. The one `focus` names is brought into
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
  const keptFocus = useKeptFocus(terminal.id, (left) => {
    const list = listRef.current;
    // What was in Earlier is off the page by now, with no more of Earlier around it than left with it
    const wasLocked = left.closest("[data-locked], [data-earlier]") !== null;
    const next = queue.open && !wasLocked ? regionOf(queue.open.id) : null;
    (next ?? list?.querySelector<HTMLElement>("[data-earlier] button") ?? list)?.focus();
  });
  useEffect(() => {
    if (!focus) return;
    const region = regionOf(focus.surfaceId);
    region?.scrollIntoView?.({ block: "start" });
    // What asked for it may have left the screen with the focus, as the tab it was sent back from has
    if (document.activeElement === null || document.activeElement === document.body) region?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <div ref={listRef} data-surface-view tabIndex={-1} {...keptFocus} className="flex flex-col gap-2 p-2">
      {queue.waiting === MOST_WAITING && <p className="px-1 text-[11px] text-[#8b949e]">{MOST_WAITING} questions waiting, the most one terminal may have.</p>}
      {surfaces.filter(isLive).map((record) => {
        // Not by revision: why an answer to an older one was not taken is said over the newer one
        const key = surfaceKey(record);
        if (!record.asks || record === queue.open) return <LiveSurface key={key} record={record} terminal={terminal} />;
        return <QueueLine key={key} record={record} terminal={terminal} onOpen={() => open(record)} />;
      })}
      {locked.length > 0 && <Earlier key={terminal.id} terminal={terminal} locked={locked} />}
    </div>
  );
};
