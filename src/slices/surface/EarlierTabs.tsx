import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatClock } from "../../lib/dates.ts";
import { ContextMenu, type ContextMenuItem, type MenuPoint } from "../overlay/ContextMenu.tsx";
import { lockedState } from "./lockedState.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** A locked surface whose tab has been left. */
export interface EarlierTab {
  /** Its tab's id. */
  id: string;
  record: SurfaceRecord;
  title: string;
  terminalName: string;
}

const menuItem = ({ id, record, title, terminalName }: EarlierTab, onOpen: (id: string) => void): ContextMenuItem => {
  const { word, reason, at } = lockedState(record);
  return {
    id,
    name: title,
    enabled: true,
    group: "earlier",
    hint: at === null ? word : `${word}, ${formatClock(at)}`,
    title: `${title}, from ${terminalName}. ${reason}`,
    onChoose: () => onOpen(id),
  };
};

interface EarlierTabsProps {
  /** Newest first. There is one at least. */
  tabs: readonly EarlierTab[];
  onOpen: (id: string) => void;
}

/** The tab bar's menu of finished surface tabs, each with its state. One opens in front again. */
export const EarlierTabs = ({ tabs, onOpen }: EarlierTabsProps) => {
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<MenuPoint | null>(null);
  const close = useCallback((refocus: boolean) => {
    setAt(null);
    if (refocus) button.current?.focus({ preventScroll: true });
  }, []);
  const toggle = () => {
    const box = button.current?.getBoundingClientRect();
    setAt(at === null && box ? { x: box.left, y: box.bottom } : null);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-controls={at !== null ? menuId : undefined}
        onClick={toggle}
        className="flex shrink-0 items-center gap-1 px-3 text-[#8b949e] hover:bg-[#21262d] hover:text-white"
      >
        {`Earlier (${tabs.length})`}
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
      </button>
      {at && <ContextMenu label="Earlier" id={menuId} items={tabs.map((tab) => menuItem(tab, onOpen))} at={at} onClose={close} anchorRef={button} />}
    </>
  );
};
