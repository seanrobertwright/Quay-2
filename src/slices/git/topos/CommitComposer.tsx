import React, { useEffect, useId, useState } from "react";
import { AlertTriangle, ArrowUp, ChevronDown, ChevronRight, GitCommitHorizontal, Loader2, Square } from "lucide-react";
import { isCommitKey, summaryHint, type ComposerView, type MessageFields } from "./composer";
import type { Commit } from "./useCommit";

/** The counter's color for each level; its text says the same without the color. */
const COUNTER_CLASS = { ok: "text-[#8b949e]", long: "text-[#d29922]", tooLong: "text-[#f85149]" } as const;

export interface CommitComposerProps {
  commit: Commit;
  /** Whether a staging operation other than this commit is running. */
  stagingBusy: boolean;
  /** Moves focus to the operation banner's Continue, for the pointer that stands in during a rebase, cherry-pick or revert. */
  onGoToContinue: () => void;
}

/**
 * The commit composer pinned at the bottom of the staging inspector (#366, #388): a one-line
 * Summary with its length hint, a Description, Amend and Sign off, and Commit, which `Ctrl+Enter`
 * also does. Hooks always run; their output streams into a panel as plain text, and Cancel stops
 * them. During a rebase, cherry-pick or revert a pointer to the banner's Continue stands in its
 * place. Success and failure are announced through the inspector's live region.
 */
export const CommitComposer: React.FC<CommitComposerProps> = ({ commit, stagingBusy, onGoToContinue }) => {
  const headingId = useId();
  const { context, view, running, output, failure } = commit;

  return (
    <section aria-labelledby={headingId} className="shrink-0 border-t border-[#30363d] bg-[#0d1117]">
      <h4 id={headingId} className="h-8 px-3 flex items-center gap-1.5 bg-[#161b22] text-[11px] font-semibold uppercase tracking-wide text-[#8b949e]">
        <GitCommitHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
        Commit
      </h4>
      {context.state === "loading" || view === null ? (
        context.state === "failed" ? (
          <p className="px-3 py-2 text-xs text-[#ff7b72] break-words">Couldn't read the commit state: {context.message}</p>
        ) : (
          <p role="status" className="px-3 py-2 text-xs text-[#8b949e]">
            Reading the commit state…
          </p>
        )
      ) : view.kind === "pointer" ? (
        <div className="px-3 py-2 flex flex-col items-start gap-1.5 text-xs text-[#c9d1d9]">
          <p>{view.text}</p>
          <button
            type="button"
            onClick={onGoToContinue}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d]"
          >
            <ArrowUp className="w-3 h-3" aria-hidden="true" />
            Go to Continue
          </button>
        </div>
      ) : (
        <Fields view={view} commit={commit} disabled={stagingBusy && !running} />
      )}
      {failure && (
        <p className="px-3 pb-2 text-[11px] text-[#ff7b72] break-words">
          <AlertTriangle className="inline w-3 h-3 mr-1 align-[-2px]" aria-hidden="true" />
          {failure.message}
        </p>
      )}
      <OutputPanel label="Hook output" running={running} output={output} keepOpen={Boolean(failure?.output)} />
    </section>
  );
};

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

interface FieldsProps {
  view: Extract<ComposerView, { kind: "composer" }>;
  commit: Commit;
  /** Another staging operation holds the worktree. */
  disabled: boolean;
}

const Fields: React.FC<FieldsProps> = ({ view, commit, disabled }) => {
  const blockedId = useId();
  const notesId = useId();
  const { fields, setFields, amend, setAmend, signoff, setSignoff, running, commit: onCommit, cancel: onCancel } = commit;
  const describedBy = [view.blockedBy !== null ? blockedId : null, view.notes.length > 0 ? notesId : null].filter((id) => id !== null).join(" ");

  return (
    <div className="px-3 py-2 flex flex-col gap-1.5">
      {view.notes.length > 0 && (
        <ul id={notesId} className="flex flex-col gap-1">
          {view.notes.map((note) => (
            <li key={note.kind} className="flex items-start gap-1.5 text-[11px] text-[#d29922]">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              {note.text}
            </li>
          ))}
        </ul>
      )}
      <MessageInputs fields={fields} setFields={setFields} onSubmit={onCommit} readOnly={running} describedBy={describedBy} />
      <div className="flex items-center gap-3 text-[11px] text-[#c9d1d9]">
        <label className={`inline-flex items-center gap-1.5 ${view.amendAvailable ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={amend}
            disabled={!view.amendAvailable || running}
            onChange={(e) => setAmend(e.target.checked)}
          />
          Amend
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={signoff} disabled={running} onChange={(e) => setSignoff(e.target.checked)} />
          Sign off
        </label>
        <span className="ml-auto text-[10px] text-[#6e7681]">Ctrl+Enter</span>
      </div>
      {view.blockedBy !== null && (
        <p id={blockedId} className="text-[11px] text-[#8b949e]">
          {view.blockedBy}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCommit}
          disabled={!view.canCommit || running || disabled}
          aria-busy={running}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {running ? "Committing…" : view.button}
        </button>
        {running && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel the commit and stop its hooks"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#f85149]/40 text-xs text-[#ff7b72] hover:bg-[#f85149]/10"
          >
            <Square className="w-3 h-3" aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
