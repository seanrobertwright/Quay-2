import { useId, useRef, useState } from "react";
import type { TerminalInfo } from "../../terminal/types.ts";
import { focusTerminal } from "../../terminal/terminalRequests.ts";
import { FoldButton } from "../FoldButton.tsx";
import { surfaceKey } from "../surfaceAttention.ts";
import { useSurfacesIn } from "../surfacePlaces.ts";
import { isLive } from "../surfaceTypes.ts";
import { useKeptFocus } from "../useKeptFocus.ts";
import { BoardLine } from "./BoardLine.tsx";
import { isBoard, type BoardRecord } from "./boardReading.ts";
import { OpenBoard } from "./OpenBoard.tsx";
import { setOpenBoard, useOpenBoard } from "./openBoards.ts";

/**
 * A terminal's boards, a line each: the live ones and the newest that finished, with the other finished
 * ones folded beneath, and the one that is open under them all. It is drawn over the terminal, in a column
 * as high as what it covers, and takes none of its room.
 */
export const BoardStrip = ({ terminal }: { terminal: TerminalInfo }) => {
  const boards = useSurfacesIn(terminal.id, "strip").filter(isBoard);
  const openKey = useOpenBoard(terminal.id);
  const [unfolded, setUnfolded] = useState(false);
  const openId = useId();
  const foldedId = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const keptFocus = useKeptFocus(terminal.id, () => {
    const next = root.current?.querySelector<HTMLElement>("button");
    if (next) next.focus();
    else focusTerminal(terminal.id);
  });
  if (boards.length === 0) return null;
  const open = boards.find((record) => surfaceKey(record) === openKey) ?? null;
  // A finished board's last change is its finish, or the last its agent sent after that
  const finished = boards.filter((record) => !isLive(record)).sort((a, b) => b.change - a.change);
  const [newest, ...rest] = finished;
  const openInRest = open !== null && rest.includes(open);
  const showsRest = unfolded || openInRest;
  const toggleRest = () => {
    setUnfolded(!showsRest);
    if (openInRest) setOpenBoard(terminal.id, null);
  };
  const line = (record: BoardRecord) => (
    <li key={surfaceKey(record)} data-board-line={record.id} className="min-w-0 @2xl:last:odd:col-span-2">
      <BoardLine record={record} open={record === open} opens={openId} onToggle={() => setOpenBoard(terminal.id, record === open ? null : record)} />
    </li>
  );
  return (
    <div ref={root} data-board-strip data-no-terminal-focus className="contents" {...keptFocus}>
      <div className="pointer-events-auto @container max-h-full shrink-0 overflow-y-auto bg-[#161b22]">
        <ul data-board-lines className="grid @2xl:grid-cols-2">
          {boards.filter(isLive).map(line)}
          {newest && line(newest)}
        </ul>
        {rest.length > 0 && (
          <FoldButton folds={foldedId} shown={showsRest} onToggle={toggleRest} className="h-6 w-full border-b border-[#30363d] px-2.5 text-[#8b949e] hover:text-white">
            {`${rest.length} finished earlier`}
          </FoldButton>
        )}
        {rest.length > 0 && showsRest && (
          <ul id={foldedId} className="grid max-h-28 overflow-y-auto @2xl:grid-cols-2">
            {rest.map(line)}
          </ul>
        )}
      </div>
      {open && (
        <div id={openId} data-open-board className="pointer-events-auto max-h-[60%] min-h-0 overflow-y-auto border-b border-[#30363d] bg-[#0d1117]/95 p-2">
          <OpenBoard key={surfaceKey(open)} record={open} terminal={terminal} />
        </div>
      )}
    </div>
  );
};
