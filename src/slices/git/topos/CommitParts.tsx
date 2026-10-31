// The commit-message fields and the streamed-output panel (#388), shared by the commit composer
// and the operation banner's Continue (#389).

import React, { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { isCommitKey, summaryHint, type MessageFields } from "./composer";

/** The counter's color for each level; its text says the same without the color. */
const COUNTER_CLASS = { ok: "text-[#8b949e]", long: "text-[#d29922]", tooLong: "text-[#f85149]" } as const;

export interface OutputPanelProps {
  /** The panel's name, such as "Hook output". */
  label: string;
  running: boolean;
  /** At most 64 KiB of plain text. */
  output: string;
  /** A failure whose output the operator needs: the panel opens to show it. */
  keepOpen: boolean;
}

/**
 * A disclosure over the streamed output of a commit or an operation step (#388, #389). It shows
 * once something runs or has printed, opens while it runs and on a failure with output, and renders
 * the output as plain text, never as markup.
 */
export const OutputPanel: React.FC<OutputPanelProps> = ({ label, running, output, keepOpen }) => {
  const outputId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);
  useEffect(() => {
    if (keepOpen) setOpen(true);
  }, [keepOpen]);
  if (!running && output === "") return null;
  return (
    <div className="border-t border-[#30363d]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={outputId}
        onClick={() => setOpen(!open)}
        className="w-full h-7 px-3 flex items-center gap-1.5 text-[11px] text-[#8b949e] hover:text-white"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
        {label}
        {running && <span className="ml-1">(running)</span>}
      </button>
      {open && (
        // Output is untrusted: it is rendered as text, never as markup. It scrolls, so it takes
        // focus for keyboard scrolling.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
        <pre tabIndex={0}
          id={outputId}
          aria-label={label}
          className="max-h-40 overflow-auto px-3 pb-2 text-[11px] leading-4 font-mono text-[#c9d1d9] whitespace-pre-wrap break-words outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]"
        >
          {output === "" ? "Waiting for output…" : output}
        </pre>
      )}
    </div>
  );
};

export interface MessageInputsProps {
  fields: MessageFields;
  setFields: (fields: MessageFields) => void;
  /** `Ctrl+Enter` in either field. */
  onSubmit: () => void;
  readOnly: boolean;
  /** Ids of notes that describe the summary, beside its counter. */
  describedBy?: string;
}

/**
 * A commit message's Summary, with its length hint, and Description (#388), shared by the composer
 * and the operation banner's Continue (#389).
 */
export const MessageInputs: React.FC<MessageInputsProps> = ({ fields, setFields, onSubmit, readOnly, describedBy }) => {
  const summaryId = useId();
  const counterId = useId();
  const descriptionId = useId();
  const hint = summaryHint(fields.summary);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isCommitKey(e)) return;
    e.preventDefault();
    onSubmit();
  };
  const inputClass =
    "w-full px-2 py-1 rounded border border-[#30363d] bg-[#010409] text-xs text-[#c9d1d9] placeholder-[#6e7681] outline-none focus:border-[#58a6ff] disabled:opacity-60";
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={summaryId} className="text-[11px] text-[#8b949e]">
          Summary
        </label>
        <span id={counterId} className={`text-[11px] tabular-nums ${COUNTER_CLASS[hint.level]}`}>
          <span aria-hidden="true">{hint.text}</span>
          <span className="sr-only">{hint.spoken}</span>
        </span>
      </div>
      <input
        id={summaryId}
        type="text"
        value={fields.summary}
        onChange={(e) => setFields({ ...fields, summary: e.target.value })}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        aria-describedby={[counterId, describedBy].filter(Boolean).join(" ")}
        placeholder="Say what the commit does"
        className={inputClass}
      />
      <label htmlFor={descriptionId} className="text-[11px] text-[#8b949e]">
        Description
      </label>
      <textarea
        id={descriptionId}
        value={fields.description}
        onChange={(e) => setFields({ ...fields, description: e.target.value })}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        rows={3}
        placeholder="Why, and anything a reviewer should know"
        className={`${inputClass} resize-y min-h-[3rem] max-h-48`}
      />
    </>
  );
};
