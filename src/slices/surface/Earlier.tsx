import { useId, useRef, useState } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { FoldButton } from "./FoldButton.tsx";
import { LockedSurface } from "./LockedSurface.tsx";
import { lockedState } from "./lockedState.ts";
import { lookOf } from "./looks/index.ts";
import { surfaceKey } from "./surfaceAttention.ts";
import { dismissLocked } from "./surfaceHost.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { When } from "./When.tsx";

interface LockedLineProps {
  record: SurfaceRecord;
  open: boolean;
  onToggle: () => void;
}

/** A locked surface in a line that opens it: its state, what was answered or asked, and when it locked. */
const LockedLine = ({ record, open, onToggle }: LockedLineProps) => {
  const { asksFor, answerInLine } = lookOf(record.tool);
  const { word, Icon, tone, at } = lockedState(record);
  const asked = asksFor(record.state.createSurface.components);
  const answer = record.ended_at === null ? answerInLine(record.answer) : null;
  return (
    <button
      type="button"
      aria-expanded={open}
      title={asked}
      onClick={onToggle}
      className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-[#161b22]"
    >
      <span className={`flex w-21 shrink-0 items-center gap-1 text-[11px] ${tone}`}>
        <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
        {word}
        <span className="sr-only">: </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-[#8b949e]">
        {answer === null ? asked : <span className="sr-only">{asked} </span>}
        {answer}
      </span>
      {at !== null && (
        <span className="shrink-0 text-[10px] text-[#8b949e]">
          <span className="sr-only">, </span>
          <When ms={at} />
        </span>
      )}
    </button>
  );
};

interface EarlierProps {
  terminal: TerminalInfo;
  /** The terminal's locked surfaces, newest first. There is one at least. */
  locked: readonly SurfaceRecord[];
}

/** The button that dismisses every surface of `locked`. `onRefusal` gets why they stay, and null while it is tried. */
const DismissAll = ({ terminal, locked, onRefusal }: EarlierProps & { onRefusal: (why: string | null) => void }) => {
  // A second click can come before the first is answered.
  const running = useRef(false);
  const dismiss = async () => {
    if (running.current) return;
    running.current = true;
    onRefusal(null);
    try {
      await dismissLocked(
        terminal.id,
        locked.map(({ id }) => id),
      );
    } catch (error) {
      onRefusal(String(error));
    } finally {
      running.current = false;
    }
  };
  return (
    <button
      type="button"
      title="Dismiss all. No agent is told: there is nothing left to answer"
      onClick={() => void dismiss()}
      className="min-h-6 shrink-0 px-1 text-[11px] text-[#58a6ff] hover:underline"
    >
      Dismiss all
    </button>
  );
};

/** The fold a terminal's locked surfaces are under. One of them may be open in its place. */
export const Earlier = ({ terminal, locked }: EarlierProps) => {
  const listId = useId();
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div data-earlier className="border-t border-[#30363d] pt-1">
      <div className="flex items-center">
        <FoldButton folds={listId} shown={shown} onToggle={() => setShown(!shown)} className="min-h-7 flex-1 px-1 text-left text-[#8b949e] hover:text-white">
          {`Earlier (${locked.length})`}
        </FoldButton>
        {shown && <DismissAll terminal={terminal} locked={locked} onRefusal={setRefusal} />}
      </div>
      {refusal && (
        <p role="alert" className="px-1 text-[11px] wrap-anywhere text-[#ff7b72]">
          {refusal}
        </p>
      )}
      {shown && (
        <ul id={listId} className="flex flex-col gap-1">
          {locked.map((record) => {
            const key = surfaceKey(record);
            const isOpen = key === open;
            return (
              <li key={key} data-locked={record.id} className="flex flex-col gap-1">
                <LockedLine record={record} open={isOpen} onToggle={() => setOpen(isOpen ? null : key)} />
                {isOpen && <LockedSurface record={record} terminal={terminal} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
