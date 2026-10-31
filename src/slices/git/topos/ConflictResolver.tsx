import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, RotateCcw, Save, Undo2 } from "lucide-react";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { ResultEditor, SidePane, goToHunk } from "./ConflictEditor";
import { confirmMarkResolved, confirmReset, confirmTakeSide, paneLabels, parseConflicts, unresolvedLabel } from "./conflicts";
import { CONFLICT_WORDS, type OpState } from "./operation";
import { conflictCard, type CardChoice } from "./conflictCards";
import { SidePickerCard } from "./SidePickerCard";
import { useConflictResolver, type ConflictSide } from "./useConflictResolver";
import type { HandToAgent } from "./useHandToAgent";
import type { Staging } from "./useStaging";

/** The most rows the file list renders; a note counts the rest. */
const FILE_ROWS = 200;

export interface ConflictResolverProps {
  worktreePath: string;
  /** The operation under way, whose conflicts the file list shows and whose labels name the sides. */
  op: OpState;
  path: string;
  onPath: (path: string) => void;
  onClose: () => void;
  staging: Staging;
  /** Opens a terminal in `cwd`; absent when Topos has no way to. */
  onOpenTerminal?: (cwd: string) => void;
  /** Hands files to an agent, and which files an agent holds, which the resolver doesn't write. */
  handToAgent: HandToAgent;
}

/**
 * The three-pane resolver (#352, #390), in place of the graph and the inspector: the conflicted
 * files on the left, the two sides read-only and side by side, labelled by role, over the editable
 * Result seeded from the worktree's markers. Each hunk has take-left, take-right and take-both
 * boxes, a navigator counts what is unresolved, and Save, Mark resolved, Reset file and keeping a
 * whole side each run as the worktree's one staging operation. The ones that drop the operator's
 * work confirm first, with focus on Cancel. A file it can't edit as text gets a side-picker card
 * (#391) instead of the panes. Hand to agent passes the file to an agent terminal (#392); while the
 * agent holds it, every control that writes is disabled, the backend refuses those writes too, and
 * Take back returns it. Every text here is untrusted and shown only as text.
 */
export const ConflictResolver: React.FC<ConflictResolverProps> = ({ worktreePath, op, path, onPath, onClose, staging, onOpenTerminal, handToAgent }) => {
  const titleId = useId();
  const listId = useId();
  const resolver = useConflictResolver(worktreePath, path, staging);
  const { read, text, setText, dirty, failure } = resolver;
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const view = useRef<EditorView | null>(null);
  const onView = useCallback((v: EditorView | null) => {
    view.current = v;
  }, []);
  const labels = paneLabels(op);
  const names = useMemo(() => ({ left: labels.left.text, right: labels.right.text }), [labels.left.text, labels.right.text]);
  const file = read?.state === "done" ? read.file : null;
  const parsed = useMemo(() => (file !== null && text !== null ? parseConflicts(text, file.markerSize) : null), [file, text]);
  const card = useMemo(() => (file !== null ? conflictCard(file, names, op.conflicts) : null), [file, names, op.conflicts]);
  const held = handToAgent.held.get(path) ?? null;
  const heldWords = held === null ? null : `With ${held.agentName}. Take it back to change it here.`;
  const busy = staging.busy !== null;
  const saving = staging.busy?.action === "resolve";

  // A file staged elsewhere, by the inspector or an agent, leaves the list; move to the next one.
  const conflictPaths = op.conflicts.map((c) => c.path);
  const listed = conflictPaths.includes(path);
  const first = conflictPaths[0] ?? null;
  useEffect(() => {
    if (listed) return;
    if (first !== null) onPath(first);
    else onClose();
  }, [listed, first, onPath, onClose]);

  /** Runs `go` now, or after a confirm when it would drop unsaved edits. */
  const leaving = (title: string, go: () => void) => {
    if (!dirty) {
      go();
      return;
    }
    setConfirm({
      title,
      detail: `${path} has edits that aren't saved. Leaving drops them; the file keeps what was last saved.`,
      confirmLabel: "Drop my edits",
      onConfirm: go,
    });
  };

  const askReset = () => {
    const request = confirmReset(path, dirty);
    setConfirm({ ...request, onConfirm: resolver.reset });
  };
  const askTakeSide = (side: ConflictSide) => {
    const request = confirmTakeSide(path, labels[side].text);
    setConfirm({ ...request, onConfirm: () => resolver.takeSide(side) });
  };
  const askMarkResolved = () => {
    const request = parsed === null ? null : confirmMarkResolved(path, parsed);
    if (request === null) resolver.markResolved();
    else setConfirm({ ...request, onConfirm: resolver.markResolved });
  };
  /** Runs a card's choice, after its confirm when it drops work. */
  const choose = (choice: CardChoice) => {
    const { action } = choice;
    const run = () => {
      switch (action.kind) {
        case "stage":
          return resolver.markResolved();
        case "takeSide":
          return resolver.takeSide(action.side);
        case "remove":
          return resolver.remove();
        case "openTerminal":
          return onOpenTerminal?.(worktreePath);
        case "handToAgent":
          return askHand();
      }
    };
    if (choice.confirm === null) run();
    else setConfirm({ ...choice.confirm, onConfirm: run });
  };
  /** Opens the agent picker for this file, after a confirm when it would drop unsaved edits. */
  const askHand = () =>
    leaving(`Hand ${path} to an agent?`, () => {
      if (dirty) resolver.reopen();
      handToAgent.hand?.([path]);
    });
  const takeBack = () => {
    handToAgent.takeBack(path);
    // The agent may have changed the file meanwhile.
    resolver.reopen();
  };
  const handWhy = heldWords ?? handToAgent.unavailable;
  const unavailable = {
    ...(onOpenTerminal === undefined ? { openTerminal: "Quay can't open a terminal from here." } : {}),
    ...(handWhy !== null ? { handToAgent: handWhy } : {}),
    ...(heldWords !== null ? { stage: heldWords, takeSide: heldWords, remove: heldWords } : {}),
  };
  const locked = busy || held !== null;
  const move = (direction: 1 | -1) => {
    if (view.current === null) return;
    const index = goToHunk(view.current, direction);
    if (index !== null && parsed !== null) staging.announce(`Conflict ${index + 1} of ${parsed.hunks.length}`);
  };

  const buttonClass =
    "inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50 disabled:cursor-not-allowed";
  const shownFiles = op.conflicts.slice(0, FILE_ROWS);
  const moreFiles = op.conflictsTotal - shownFiles.length;

  return (
    <section aria-labelledby={titleId} className="absolute inset-0 z-20 flex min-h-0 bg-[#0d1117]">
      <nav aria-labelledby={listId} className="w-60 shrink-0 flex flex-col min-h-0 border-r border-[#30363d]">
        <div className="h-9 px-3 shrink-0 flex items-center gap-2 border-b border-[#30363d] bg-[#161b22]">
          <button type="button" onClick={() => leaving("Leave the resolver?", onClose)} aria-label="Back to the graph" title="Back to the graph" className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d]">
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <h4 id={listId} className="text-[11px] font-semibold uppercase tracking-wide text-[#ff7b72]">
            Conflicts
            <span className="ml-1.5 normal-case font-normal tabular-nums">{op.conflictsTotal.toLocaleString()}</span>
          </h4>
        </div>
        <ul className="flex-1 overflow-y-auto min-h-0 py-0.5">
          {shownFiles.map((c) => (
            <li key={c.path}>
              <button
                type="button"
                aria-current={c.path === path ? "true" : undefined}
                onClick={() => c.path !== path && leaving(`Open ${c.path}?`, () => onPath(c.path))}
                title={`${c.path}: ${CONFLICT_WORDS[c.kind]}`}
                className={`w-full h-7 px-3 flex items-center gap-2 text-xs text-left ${c.path === path ? "bg-[#06B6D4]/15 text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"}`}
              >
                <span className="w-5 shrink-0 font-mono text-[11px] text-[#f85149]" aria-hidden="true">
                  {c.xy}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  {c.path}
                  <span className="sr-only">, {CONFLICT_WORDS[c.kind]}</span>
                </span>
                {handToAgent.held.has(c.path) && (
                  <span className="shrink-0 max-w-[45%] truncate text-[10px] text-[#d2a8ff]">With {handToAgent.held.get(c.path)?.agentName}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {moreFiles > 0 && <p className="px-3 py-1 text-[11px] text-[#8b949e]">and {moreFiles.toLocaleString()} more conflicted files</p>}
      </nav>

      <div className="relative flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-3 py-1.5 shrink-0 flex flex-wrap items-center gap-2 border-b border-[#30363d] bg-[#161b22]">
          <h3 id={titleId} className="text-xs font-semibold text-white truncate min-w-0 max-w-[40%]" title={path}>
            {path}
            {dirty && <span className="ml-1.5 font-normal text-[#d29922]">(unsaved)</span>}
          </h3>
          {parsed !== null && (
            <div className="flex items-center gap-1" role="group" aria-label="Conflict navigator">
              <button type="button" onClick={() => move(-1)} disabled={parsed.hunks.length === 0} aria-label="Previous conflict" className={buttonClass}>
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className={`text-xs tabular-nums ${parsed.hunks.length > 0 || parsed.unterminated !== null ? "text-[#e3b341]" : "text-[#3fb950]"}`}>
                {unresolvedLabel(parsed)}
              </span>
              <button type="button" onClick={() => move(1)} disabled={parsed.hunks.length === 0} aria-label="Next conflict" className={buttonClass}>
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {file?.editable && (
              <button type="button" onClick={() => void resolver.save()} disabled={!dirty || locked} aria-busy={saving} className={buttonClass}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
                Save
              </button>
            )}
            {file?.editable && (
              <>
                <button type="button" onClick={() => askTakeSide("left")} disabled={locked} title={labels.left.tooltip} className={buttonClass}>
                  Keep {labels.left.text} whole
                </button>
                <button type="button" onClick={() => askTakeSide("right")} disabled={locked} title={labels.right.tooltip} className={buttonClass}>
                  Keep {labels.right.text} whole
                </button>
              </>
            )}
            {file?.editable && (
              <>
                <button type="button" onClick={askReset} disabled={locked} title="Put the file back to git's conflict markers (git checkout -m)" className={buttonClass}>
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Reset file
                </button>
                <button
                  type="button"
                  onClick={askMarkResolved}
                  disabled={locked}
                  title="Stage the file as resolved (git add), saving it first"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Mark resolved
                </button>
              </>
            )}
            {file?.editable && held === null && (
              <button
                type="button"
                onClick={askHand}
                disabled={handToAgent.hand === null}
                title={handToAgent.unavailable ?? "Ask an agent terminal in this worktree to resolve and stage this file"}
                className={buttonClass}
              >
                <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                Hand to agent
              </button>
            )}
          </div>
        </div>

        {held !== null && (
          <div role="status" className="px-3 py-1.5 shrink-0 flex items-center gap-2 text-[11px] text-[#d2a8ff] bg-[#8957e5]/10 border-b border-[#8957e5]/30">
            <Bot className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0 break-words">
              With {held.agentName}. Read-only here until {held.agentName} stages it or you take it back.
            </span>
            <button type="button" onClick={() => leaving(`Reopen ${path}?`, resolver.reopen)} className={buttonClass}>
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Reopen
            </button>
            <button type="button" onClick={takeBack} className={buttonClass}>
              <Undo2 className="w-3 h-3" aria-hidden="true" />
              Take back
            </button>
          </div>
        )}

        {failure && (
          <div role="alert" className="px-3 py-1.5 shrink-0 flex items-center gap-2 text-[11px] text-[#ff7b72] bg-[#f85149]/10 border-b border-[#f85149]/30">
            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0 break-words">{failure.message}</span>
            {failure.stale && (
              <button type="button" onClick={() => leaving(`Reopen ${path}?`, resolver.reopen)} className={buttonClass}>
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                Reopen
              </button>
            )}
          </div>
        )}

        {read === null || read.state === "loading" ? (
          <p role="status" className="flex-1 flex items-center justify-center text-sm text-[#8b949e]">
            Opening {path}…
          </p>
        ) : read.state === "failed" ? (
          <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-white">Couldn't open {read.path}</p>
            <p className="text-xs text-[#8b949e] max-w-md break-words">{read.message}</p>
            <button type="button" onClick={resolver.reopen} className={buttonClass}>
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : card !== null ? (
          <SidePickerCard card={card} busy={busy} unavailable={unavailable} onChoose={choose} />
        ) : read.file.left === null || read.file.right === null || text === null ? (
          <p role="alert" className="flex-1 flex items-center justify-center p-6 text-sm text-[#8b949e]">
            Topos couldn't read {path} as text.
          </p>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="h-[45%] min-h-0 flex border-b border-[#30363d]">
              {(["left", "right"] as const).map((side) => (
                <div key={side} className={`flex-1 min-w-0 flex flex-col ${side === "left" ? "border-r border-[#30363d]" : ""}`}>
                  <h4 title={labels[side].tooltip} className="h-7 px-3 shrink-0 flex items-center text-[11px] font-semibold text-[#c9d1d9] bg-[#161b22] border-b border-[#30363d] truncate">
                    {labels[side].text}
                  </h4>
                  <div className="flex-1 min-h-0">
                    <SidePane text={read.file[side] ?? ""} ariaLabel={`${labels[side].text}, read-only`} />
                  </div>
                </div>
              ))}
            </div>
            <h4 className="h-7 px-3 shrink-0 flex items-center gap-2 text-[11px] font-semibold text-white bg-[#161b22] border-b border-[#30363d]">
              Result
              <span className="font-normal text-[#8b949e]">
                Tick L, R or B beside a conflict to take {labels.left.text}, {labels.right.text} or both, or edit freely.
              </span>
            </h4>
            <div className="flex-1 min-h-0">
              <ResultEditor
                key={read.file.path}
                text={text}
                markerSize={read.file.markerSize}
                names={names}
                ariaLabel={`Result for ${path}, ${held !== null ? `read-only while with ${held.agentName}` : "editable"}`}
                readOnly={locked}
                onChange={setText}
                onView={onView}
              />
            </div>
          </div>
        )}
        <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />
      </div>
    </section>
  );
};
