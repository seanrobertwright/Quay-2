import React, { useEffect, useId, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitCommitHorizontal, Loader2, Square } from "lucide-react";
import { isCommitKey, summaryHint, type ComposerView } from "./composer";
import type { Commit } from "./useCommit";

/** The counter's color for each level; its text says the same without the color. */
const COUNTER_CLASS = { ok: "text-[#8b949e]", long: "text-[#d29922]", tooLong: "text-[#f85149]" } as const;

/** The id #389's operation banner can point back at, and that this pointer names. */
export const CONTINUE_POINTER_ID = "topos-operation-continue-pointer";

export interface CommitComposerProps {
  commit: Commit;
  /** Whether a staging operation other than this commit is running. */
  stagingBusy: boolean;
}

/**
 * The commit composer pinned at the bottom of the staging inspector (#366, #388): a one-line
 * Summary with its length hint, a Description, Amend and Sign off, and Commit, which `Ctrl+Enter`
 * also does. Hooks always run; their output streams into a panel as plain text, and Cancel stops
 * them. During a rebase, cherry-pick or revert a pointer to the banner's Continue stands in its
 * place. Success and failure are announced through the inspector's live region.
 */
export const CommitComposer: React.FC<CommitComposerProps> = ({ commit, stagingBusy }) => {
  const headingId = useId();
  const summaryId = useId();
  const counterId = useId();
  const descriptionId = useId();
  const blockedId = useId();
  const notesId = useId();
  const outputId = useId();
  const [showOutput, setShowOutput] = useState(false);
  const { context, view, fields, setFields, amend, setAmend, signoff, setSignoff, running, output, failure } = commit;

  // The panel opens while hooks run and stays open on a failure, so its output is in view.
  useEffect(() => {
    if (running) setShowOutput(true);
  }, [running]);
  useEffect(() => {
    if (failure?.output) setShowOutput(true);
  }, [failure]);

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
        <p id={CONTINUE_POINTER_ID} data-operation={view.operation} className="px-3 py-2 text-xs text-[#c9d1d9]">
          {view.text}
        </p>
      ) : (
        <Fields
          view={view}
          ids={{ summaryId, counterId, descriptionId, blockedId, notesId }}
          fields={fields}
          setFields={setFields}
          amend={amend}
          setAmend={setAmend}
          signoff={signoff}
          setSignoff={setSignoff}
          running={running}
          disabled={stagingBusy && !running}
          onCommit={commit.commit}
          onCancel={commit.cancel}
        />
      )}
      {failure && (
        <p className="px-3 pb-2 text-[11px] text-[#ff7b72] break-words">
          <AlertTriangle className="inline w-3 h-3 mr-1 align-[-2px]" aria-hidden="true" />
          {failure.message}
        </p>
      )}
      {(running || output !== "") && (
        <div className="border-t border-[#30363d]">
          <button
            type="button"
            aria-expanded={showOutput}
            aria-controls={outputId}
            onClick={() => setShowOutput(!showOutput)}
            className="w-full h-7 px-3 flex items-center gap-1.5 text-[11px] text-[#8b949e] hover:text-white"
          >
            {showOutput ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            Hook output
            {running && <span className="ml-1">(running)</span>}
          </button>
          {showOutput && (
            // Hook output is untrusted: it is rendered as text, never as markup. It scrolls, so it
            // takes focus for keyboard scrolling.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
            <pre tabIndex={0}
              id={outputId}
              aria-label="Hook output"
              className="max-h-40 overflow-auto px-3 pb-2 text-[11px] leading-4 font-mono text-[#c9d1d9] whitespace-pre-wrap break-words outline-none focus-visible:ring-1 focus-visible:ring-[#58a6ff]"
            >
              {output === "" ? "Waiting for output…" : output}
            </pre>
          )}
        </div>
      )}
    </section>
  );
};

interface FieldsProps {
  view: Extract<ComposerView, { kind: "composer" }>;
  ids: { summaryId: string; counterId: string; descriptionId: string; blockedId: string; notesId: string };
  fields: Commit["fields"];
  setFields: Commit["setFields"];
  amend: boolean;
  setAmend: Commit["setAmend"];
  signoff: boolean;
  setSignoff: Commit["setSignoff"];
  running: boolean;
  /** Another staging operation holds the worktree. */
  disabled: boolean;
  onCommit: () => void;
  onCancel: () => void;
}

const Fields: React.FC<FieldsProps> = ({ view, ids, fields, setFields, amend, setAmend, signoff, setSignoff, running, disabled, onCommit, onCancel }) => {
  const hint = summaryHint(fields.summary);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isCommitKey(e)) return;
    e.preventDefault();
    onCommit();
  };
  const describedBy = [ids.counterId, view.blockedBy !== null ? ids.blockedId : null, view.notes.length > 0 ? ids.notesId : null]
    .filter((id) => id !== null)
    .join(" ");
  const inputClass =
    "w-full px-2 py-1 rounded border border-[#30363d] bg-[#010409] text-xs text-[#c9d1d9] placeholder-[#6e7681] outline-none focus:border-[#58a6ff] disabled:opacity-60";

  return (
    <div className="px-3 py-2 flex flex-col gap-1.5">
      {view.notes.length > 0 && (
        <ul id={ids.notesId} className="flex flex-col gap-1">
          {view.notes.map((note) => (
            <li key={note.kind} className="flex items-start gap-1.5 text-[11px] text-[#d29922]">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              {note.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={ids.summaryId} className="text-[11px] text-[#8b949e]">
          Summary
        </label>
        <span id={ids.counterId} className={`text-[11px] tabular-nums ${COUNTER_CLASS[hint.level]}`}>
          <span aria-hidden="true">{hint.text}</span>
          <span className="sr-only">{hint.spoken}</span>
        </span>
      </div>
      <input
        id={ids.summaryId}
        type="text"
        value={fields.summary}
        onChange={(e) => setFields({ ...fields, summary: e.target.value })}
        onKeyDown={onKeyDown}
        readOnly={running}
        aria-describedby={describedBy}
        placeholder="Say what the commit does"
        className={inputClass}
      />
      <label htmlFor={ids.descriptionId} className="text-[11px] text-[#8b949e]">
        Description
      </label>
      <textarea
        id={ids.descriptionId}
        value={fields.description}
        onChange={(e) => setFields({ ...fields, description: e.target.value })}
        onKeyDown={onKeyDown}
        readOnly={running}
        rows={3}
        placeholder="Why, and anything a reviewer should know"
        className={`${inputClass} resize-y min-h-[3rem] max-h-48`}
      />
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
        <p id={ids.blockedId} className="text-[11px] text-[#8b949e]">
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
