import { ChevronDown, ChevronUp } from "lucide-react";
import { lookOf } from "../looks/index.ts";
import { lockedState } from "../lockedState.ts";
import { isLive } from "../surfaceTypes.ts";
import { BoardClock } from "./BoardClock.tsx";
import { readBoard, type BoardRecord } from "./boardReading.ts";
import { boardState } from "./boardState.ts";

interface BoardLineProps {
  record: BoardRecord;
  open: boolean;
  /** The id of what it opens. */
  opens: string;
  onToggle: () => void;
}

/** A board in a line that opens it over the terminal and folds it again. */
export const BoardLine = ({ record, open, opens, onToggle }: BoardLineProps) => {
  const reading = readBoard(record);
  const { words, tone, bar } = boardState(record, reading);
  const Icon = isLive(record) ? lookOf(record.tool).KindIcon : lockedState(record).Icon;
  const Chevron = open ? ChevronUp : ChevronDown;
  const { title } = record.board;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? opens : undefined}
      title={title}
      onClick={onToggle}
      className="relative flex h-7 w-full items-center gap-2 border-b border-[#30363d] bg-[#161b22] px-2.5 text-left text-xs hover:bg-[#21262d]"
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="min-w-0 truncate text-[#c9d1d9]">
        <span className="sr-only">Board: </span>
        {title}
      </span>
      {reading.current !== null && <span className="min-w-0 truncate text-[#8b949e]">{reading.current}</span>}
      <span className="flex-1" />
      {words !== null && <span className={`${record.ended_at === null ? "shrink-0" : "min-w-0 truncate"} ${tone}`}>{words}</span>}
      <BoardClock run={record.board} unnamed />
      <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
      {reading.share !== null && <span aria-hidden="true" data-bar className={`absolute bottom-0 left-0 h-0.5 ${bar}`} style={{ width: `${reading.share * 100}%` }} />}
    </button>
  );
};
