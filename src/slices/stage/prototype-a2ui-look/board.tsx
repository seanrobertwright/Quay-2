// PROTOTYPE (#696), throwaway. The status board: the folded strip on the pane (A live line, B one
// tick per step, C title only) and the board it opens.
import { Check, ChevronDown, ChevronUp, CircleDashed, Loader2, Shapes, X } from "lucide-react";
import type { Board, StepState } from "./content.ts";
import { Frame, type Key } from "./frame.tsx";

const TONE: Record<StepState, string> = { done: "#3fb950", active: "#58a6ff", failed: "#f85149", pending: "#484f58" };
const ICON = { done: Check, active: Loader2, failed: X, pending: CircleDashed };
const StepIcon = ({ state }: { state: StepState }) => {
  const Icon = ICON[state];
  return <Icon className={`w-3 h-3 shrink-0 mt-0.5 ${state === "active" ? "animate-spin" : ""}`} style={{ color: TONE[state] }} aria-label={state} />;
};
const tally = (b: Board) => ({ done: b.steps.filter((s) => s.state === "done").length, total: b.steps.length });
const stateTone = (b: Board) => (b.status === "failed" ? "#f85149" : b.status === "done" ? "#3fb950" : b.quiet ? "#8b949e" : "#58a6ff");
const stateWord = (b: Board) => (b.status === "done" ? "Done" : b.status === "failed" ? "Failed" : `${tally(b).done} of ${tally(b).total}`);

const LINE = "relative w-full h-7 px-2.5 flex items-center gap-2 bg-[#161b22] border-b border-[#30363d] text-xs hover:bg-[#21262d] text-left";
const Fold = ({ open }: { open: boolean }) => {
  const Icon = open ? ChevronUp : ChevronDown;
  return <Icon className="w-3.5 h-3.5 shrink-0 text-[#8b949e]" aria-hidden />;
};

export const StripLine = ({ board, look, open, onToggle }: { board: Board; look: Key; open: boolean; onToggle: () => void }) => {
  const { done, total } = tally(board);
  const now = board.steps.find((s) => s.state === "active") ?? board.steps.find((s) => s.state === "failed");
  return (
    <button type="button" aria-expanded={open} title={board.title} onClick={onToggle} className={LINE}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${board.status === "running" && !board.quiet ? "animate-pulse" : ""}`} style={{ background: stateTone(board) }} />
      <span className="truncate text-[#c9d1d9]">{board.title}</span>
      {look === "A" && now && <span className="truncate text-[#8b949e]">{now.label}</span>}
      {look === "B" && (
        <span className="flex items-center gap-px flex-1 min-w-20 max-w-64">
          {board.steps.map((s) => (
            <span key={s.label} className="h-2 flex-1 min-w-[2px] rounded-[1px]" style={{ background: TONE[s.state] }} />
          ))}
        </span>
      )}
      <span className="flex-1" />
      {look !== "C" && (
        <span className="shrink-0" style={{ color: stateTone(board) }}>
          {stateWord(board)}
        </span>
      )}
      {look !== "C" && board.quiet && <span className="shrink-0 text-[11px] text-[#e3b341]">{board.quiet}</span>}
      <span className="shrink-0 font-mono text-[11px] text-[#8b949e]">{board.elapsed}</span>
      <Fold open={open} />
      {look === "A" && <span className="absolute left-0 bottom-0 h-[2px]" style={{ width: `${(done / total) * 100}%`, background: stateTone(board) }} />}
    </button>
  );
};

/** A raw strip, folded: Quay cannot read progress out of it, so it has a title and an age. */
export const RawStripLine = ({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) => (
  <button type="button" aria-expanded={open} title={title} onClick={onToggle} className={LINE}>
    <Shapes className="w-3.5 h-3.5 shrink-0 text-[#39c5cf]" aria-hidden />
    <span className="truncate text-[#c9d1d9]">{title}</span>
    <span className="flex-1" />
    <span className="shrink-0 text-[11px] text-[#8b949e]">updated 20 s ago</span>
    <Fold open={open} />
  </button>
);

const Step = ({ s }: { s: Board["steps"][number] }) => (
  <li className="flex items-start gap-1.5 text-xs min-w-0">
    <StepIcon state={s.state} />
    <span className="min-w-0">
      <span className={`break-words ${s.state === "active" || s.state === "failed" ? "text-[#f0f6fc]" : "text-[#8b949e]"}`}>{s.label}</span>
      {s.note && <span className="block text-[11px] leading-4 text-[#8b949e] break-words">{s.note}</span>}
    </span>
  </li>
);

export const BoardBody = ({ board, onDismiss }: { board: Board; onDismiss: () => void }) => {
  const { done, total } = tally(board);
  const half = Math.ceil(total / 2);
  return (
    <Frame terminal="fix-75" cli="claude" kind="board" title={board.title} onDismiss={onDismiss}>
      <div className="@container flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium" style={{ color: stateTone(board) }}>
            {stateWord(board)}
          </span>
          <span className="flex-1 h-1.5 rounded-full bg-[#21262d] overflow-hidden">
            <span className="block h-full" style={{ width: `${(done / total) * 100}%`, background: stateTone(board) }} />
          </span>
          <span className="font-mono text-[11px] text-[#8b949e]">{board.elapsed}</span>
          {board.quiet && <span className="text-[11px] text-[#e3b341]">{board.quiet}</span>}
        </div>
        <div className="grid gap-x-5 gap-y-1 @lg:grid-cols-2">
          {[board.steps.slice(0, half), board.steps.slice(half)].map((column, i) => (
            <ul key={i === 0 ? "first" : "second"} className="flex flex-col gap-1 min-w-0">
              {column.map((s) => (
                <Step key={s.label} s={s} />
              ))}
            </ul>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {board.stats.map((s) => (
            <span key={s.label} className="px-2 py-0.5 rounded border border-[#30363d] bg-[#161b22] text-[11px]">
              <span className="text-[#f0f6fc] font-mono">{s.value}</span> <span className="text-[#8b949e]">{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
};
