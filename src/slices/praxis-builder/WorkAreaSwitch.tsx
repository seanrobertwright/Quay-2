// The switch above a record's work area that shows either the record's form or its runs on the
// host: Template | Runs on a workflow template (#452), Workflow | Runs on a graph workflow (#464).
// Exactly one view is always shown, so it is a radio group, not toggle buttons and not tabs: one
// tab stop on the shown view, and the arrow keys move to the other view and show it.
import { useRef, type KeyboardEvent } from "react";

export type WorkAreaView = "record" | "runs";

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

export function WorkAreaSwitch({
  recordLabel,
  shown,
  onShow,
}: {
  /** The first choice's label: what the record is, such as "Template" or "Workflow". */
  recordLabel: string;
  shown: WorkAreaView;
  onShow: (view: WorkAreaView) => void;
}) {
  const choices: { view: WorkAreaView; label: string }[] = [
    { view: "record", label: recordLabel },
    { view: "runs", label: "Runs" },
  ];
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + choices.length) % choices.length;
    onShow(choices[next].view);
    buttons.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Show" className="max-w-3xl mx-auto px-6 pt-4 flex gap-1">
      {choices.map(({ view, label }, index) => (
        <button
          key={view}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={shown === view}
          tabIndex={shown === view ? 0 : -1}
          onClick={() => onShow(view)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className="px-2.5 py-1 rounded-md border border-[#30363d] text-xs text-[#c9d1d9] hover:bg-[#21262d] aria-checked:bg-[#30363d] aria-checked:text-white"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
