import { lookOf } from "../looks/index.ts";
import { lockedState } from "../lockedState.ts";
import { isLive } from "../surfaceTypes.ts";
import { BoardClock } from "./BoardClock.tsx";
import { readBoard, type BoardRecord } from "./boardReading.ts";
import { boardState } from "./boardState.ts";
import { StripLine } from "./StripLine.tsx";

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
  const { kind, KindIcon } = lookOf(record.tool);
  const Icon = isLive(record) ? KindIcon : lockedState(record).Icon;
  return (
    <StripLine Icon={Icon} tone={tone} kind={kind} title={record.board.title} open={open} opens={opens} onToggle={onToggle}>
      {reading.current !== null && <span className="min-w-0 truncate text-[#8b949e]">{reading.current}</span>}
      <span className="flex-1" />
      {words !== null && <span className={`${record.ended_at === null ? "shrink-0" : "min-w-0 truncate"} ${tone}`}>{words}</span>}
      <BoardClock run={record.board} unnamed />
      {reading.share !== null && <span aria-hidden="true" data-bar className={`absolute bottom-0 left-0 h-0.5 ${bar}`} style={{ width: `${reading.share * 100}%` }} />}
    </StripLine>
  );
};
