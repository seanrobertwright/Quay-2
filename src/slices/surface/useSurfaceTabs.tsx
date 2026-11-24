// The stage tabs of the surfaces that are drawn in one. Which tab is in front is the stage's to say:
// nothing here brings one in front but the operator opening it.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { WAITING_ON_YOU } from "../../lib/waiting.ts";
import { isSamePath } from "../../utils/paths.ts";
import type { StageTool } from "../stage/stageTools.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { EarlierTabs } from "./EarlierTabs.tsx";
import { lookOf } from "./looks/index.ts";
import { everySurfaceIn, keptSurface } from "./surfacePlaces.ts";
import { surfaceKey } from "./surfaceAttention.ts";
import { dismissSurface, subscribeToSurfaces } from "./surfaceHost.ts";
import { SurfaceTab } from "./SurfaceTab.tsx";
import { drawnIn, isLive, newestLockedFirst, type SurfaceKey, type SurfaceRecord } from "./surfaceTypes.ts";

const PREFIX = "surface:";

/** A tab's id, which a surface that is opened again keeps. A terminal may use a surface's id again, and the later surface's tab has another. */
const tabId = (record: SurfaceRecord) => `${PREFIX}${surfaceKey({ ...record, order: record.began })}`;

/** A surface that has a tab, and its terminal. */
interface Tabbed {
  id: string;
  record: SurfaceRecord;
  terminal: TerminalInfo;
}

/** A tab's label: its surface's title, which its agent wrote. */
const titleOf = ({ record }: Tabbed) => lookOf(record.tool).asksFor(record);

interface SurfaceTabsOptions {
  terminals: readonly TerminalInfo[];
  /** The project whose terminals' tabs show. */
  activeProject: string;
  /** The stage tab in front, or null while the terminals are. */
  frontId: string | null;
  onFront: (id: string | null) => void;
  /** Selects `terminal`, which makes its project the active one. */
  onSelectTerminal: (terminal: TerminalInfo) => void;
}

export interface SurfaceTabs {
  /** A tab for each live surface, oldest first by terminal, and for a locked one while it is in front. */
  tools: StageTool[];
  /** The menu the other locked ones are folded under, or null when there is none. */
  earlier: ReactNode;
  /** Selects a surface's terminal and brings its tab in front, at the operator's click. `false` when it has no tab. */
  open: (key: SurfaceKey) => boolean;
  /** Brings the tab `id` in front and the focus to it, at the operator's click. `false` when it is no surface's tab. */
  select: (id: string) => boolean;
  /** Closes the tab `id`, which dismisses its surface. `false` when it is no surface's tab. */
  close: (id: string) => boolean;
}

/** The active project's surface tabs. */
export function useSurfaceTabs({ terminals, activeProject, frontId, onFront, onSelectTerminal }: SurfaceTabsOptions): SurfaceTabs {
  // A surface elsewhere, such as a board that its agent updates, renders nothing again
  const inTabs = useSyncExternalStore(subscribeToSurfaces, () => everySurfaceIn("tab"));
  const tabbed = useMemo(
    () =>
      terminals
        .filter((terminal) => isSamePath(terminal.project_path, activeProject))
        .flatMap((terminal) => inTabs.filter(({ terminal_id }) => terminal_id === terminal.id).map((record): Tabbed => ({ id: tabId(record), record, terminal }))),
    [terminals, activeProject, inTabs],
  );
  // The latest request to open a tab. Each has a `seq` of its own.
  const [asked, setAsked] = useState<{ id: string; seq: number } | null>(null);
  /** Why closing a tab did not dismiss its surface, by the surface as it was then. */
  const [refusals, setRefusals] = useState<ReadonlyMap<SurfaceRecord, string>>(new Map());

  // A tab that has gone, or whose project is no longer active, has been left
  const frontIsGone = frontId !== null && frontId.startsWith(PREFIX) && !tabbed.some(({ id }) => id === frontId);
  useEffect(() => {
    if (frontIsGone) onFront(null);
  }, [frontIsGone, onFront]);

  const bring = useCallback(
    (id: string) => {
      setAsked((before) => ({ id, seq: (before?.seq ?? 0) + 1 }));
      onFront(id);
    },
    [onFront],
  );
  const open = (key: SurfaceKey): boolean => {
    const record = keptSurface(key);
    if (!record || drawnIn(record) !== "tab") return false;
    const terminal = terminals.find(({ id }) => id === record.terminal_id);
    if (!terminal) return false;
    onSelectTerminal(terminal);
    bring(tabId(record));
    return true;
  };
  const select = (id: string): boolean => {
    if (!tabbed.some((tab) => tab.id === id)) return false;
    bring(id);
    return true;
  };
  const close = (id: string): boolean => {
    if (!id.startsWith(PREFIX)) return false;
    const record = tabbed.find((tab) => tab.id === id)?.record;
    if (!record) return true;
    const refuse = (why: string | null) =>
      setRefusals((before) => {
        const after = new Map(before);
        if (why === null) after.delete(record);
        else after.set(record, why);
        return after;
      });
    refuse(null);
    dismissSurface(record).catch((error) => refuse(String(error)));
    return true;
  };

  const tools = tabbed
    .filter(({ id, record }) => isLive(record) || id === frontId)
    .map((tab): StageTool => {
      const { id, record, terminal } = tab;
      const { kind, KindIcon } = lookOf(record.tool);
      const label = titleOf(tab);
      const waits = isLive(record) && record.asks;
      const name = `${label}, ${kind.toLowerCase()} from ${terminal.name}`;
      return {
        id,
        label,
        name: waits ? `${name}, ${WAITING_ON_YOU}` : name,
        waits,
        icon: <KindIcon className="h-3.5 w-3.5 text-[#d29922]" />,
        content: (
          <SurfaceTab
            record={record}
            terminal={terminal}
            inFront={id === frontId}
            asked={asked?.id === id ? asked.seq : 0}
            notDismissed={refusals.get(record) ?? null}
          />
        ),
      };
    });
  const folded = tabbed
    .filter(({ id, record }) => !isLive(record) && id !== frontId)
    .sort((a, b) => newestLockedFirst(a.record, b.record))
    .map((tab) => ({ id: tab.id, record: tab.record, title: titleOf(tab), terminalName: tab.terminal.name }));
  return { tools, earlier: folded.length > 0 ? <EarlierTabs tabs={folded} onOpen={bring} /> : null, open, select, close };
}
