import { memo, useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { LiveSurface } from "./LiveSurface.tsx";
import { LockedSurface } from "./LockedSurface.tsx";
import { isLive, type SurfaceRecord } from "./surfaceTypes.ts";
import { saveUnsentNow } from "./unsent.ts";
import { useKeptFocus } from "./useKeptFocus.ts";

interface SurfaceTabProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
  /** Whether its tab is in front. */
  inFront: boolean;
  /** Which request to open it is the latest, or 0 when there was none. Each takes the focus to it. */
  asked: number;
  /** Why closing its tab did not dismiss it. */
  notDismissed: string | null;
  /** Takes that away from what is said of `record`. */
  onForgetNotDismissed: (record: SurfaceRecord) => void;
}

/** What a surface's stage tab shows. Nothing is drawn until the tab is first in front; from then on it stays drawn. */
export const SurfaceTab = memo(({ record, terminal, inFront, asked, notDismissed, onForgetNotDismissed }: SurfaceTabProps) => {
  const [opened, setOpened] = useState(inFront);
  if (inFront && !opened) setOpened(true);
  const box = useRef<HTMLDivElement>(null);
  const focusFrame = () => box.current?.querySelector<HTMLElement>("[data-surface]")?.focus();
  useEffect(() => {
    if (asked > 0) focusFrame();
  }, [asked]);
  useEffect(() => {
    if (!inFront) saveUnsentNow(record);
  }, [inFront, record]);
  // What is decided leaves with the button that decided it
  const keptFocus = useKeptFocus(terminal.id, focusFrame);
  if (!opened) return null;
  const forget = () => onForgetNotDismissed(record);
  return (
    <div ref={box} {...keptFocus} className="flex min-h-0 flex-1 flex-col items-center p-4 select-text">
      {isLive(record) ? (
        <LiveSurface record={record} terminal={terminal} fills notDismissed={notDismissed} onForgetNotDismissed={forget} />
      ) : (
        <LockedSurface record={record} terminal={terminal} fills notDismissed={notDismissed} onForgetNotDismissed={forget} />
      )}
    </div>
  );
});
SurfaceTab.displayName = "SurfaceTab";
