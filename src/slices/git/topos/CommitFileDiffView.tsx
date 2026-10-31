import React, { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Columns2, RefreshCw } from "lucide-react";
import { usePopupLayer } from "../../overlay/useOverlay";
import { DiffEditor } from "./DiffEditor";
import { splitDoc, unifiedDoc, type FileDiff } from "./diffDoc";
import { diffBody, modeLabel, sizeLabel } from "./diffView";
import type { DiffMode } from "./FileDiffView";
import { shortOid } from "./graphStore";
import type { CommitDiffState, OpenCommitFile } from "./useCommitDetails";

export interface CommitFileDiffViewProps {
  file: OpenCommitFile;
  reader: { diff: CommitDiffState; loadedLarge: boolean; loadLarge: () => void; reload: () => void };
  mode: DiffMode;
  onMode: (mode: DiffMode) => void;
  /** Steps to the previous or next file of the commit, or null at either end. */
  onStep: ((direction: -1 | 1) => void) | null;
  canStep: { previous: boolean; next: boolean };
  onBack: () => void;
  /** Whether Topos shows, so Escape returns to the graph only then. */
  visible: boolean;
}

/** Whether a key came from inside a CodeMirror editor, whose arrows move its own cursor. */
function inEditor(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".cm-editor") !== null;
}

/**
 * A commit file's diff in place of the graph (#397): #383's read-only CodeMirror view with no
 * staging gutter and no hunk buttons, unified or split as the staging diff is. ↑/↓ outside the
 * editor, or the arrow buttons, step between the commit's files. Escape returns to the graph.
 */
export const CommitFileDiffView: React.FC<CommitFileDiffViewProps> = ({ file, reader, mode, onMode, onStep, canStep, onBack, visible }) => {
  const root = useRef<HTMLElement>(null);
  usePopupLayer(visible, onBack, root);
  const { diff: state, loadedLarge, loadLarge } = reader;
  const diff: FileDiff | null = state.state === "done" ? state.diff : null;
  const body = diff ? diffBody(diff) : null;
  const shownMode: DiffMode = loadedLarge ? "unified" : mode;
  const unified = useMemo(() => (diff && shownMode === "unified" ? unifiedDoc(diff) : null), [diff, shownMode]);
  const split = useMemo(() => (diff && shownMode === "split" ? splitDoc(diff) : null), [diff, shownMode]);
  const [scrollTop, setScrollTop] = useState<{ pane: "left" | "right"; top: number } | null>(null);
  // A compared pair (#398) is diffed against the other commit, not a parent.
  const base = file.against;
  const against =
    base.kind === "commit" ? shortOid(base.oid) : base.oid === null ? "the empty tree" : `parent ${base.index} (${shortOid(base.oid)})`;
  const title = file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`;

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (onStep === null || inEditor(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === "ArrowUp" && canStep.previous) {
      e.preventDefault();
      onStep(-1);
    } else if (e.key === "ArrowDown" && canStep.next) {
      e.preventDefault();
      onStep(1);
    }
  };

  const stepButton = (direction: -1 | 1) => {
    const enabled = onStep !== null && (direction === -1 ? canStep.previous : canStep.next);
    const Icon = direction === -1 ? ArrowUp : ArrowDown;
    const label = direction === -1 ? "Previous file (↑)" : "Next file (↓)";
    return (
      <button
        type="button"
        disabled={!enabled}
        onClick={() => onStep?.(direction)}
        aria-label={label}
        title={label}
        className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-40"
      >
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    );
  };

  return (
    // The section takes the arrows that step between files; the editors inside keep their own.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={root}
      aria-label={`Diff of ${title} in ${shortOid(file.oid)} against ${against}`}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-10 flex flex-col min-h-0 bg-[#0d1117]"
    >
      <header className="h-9 px-3 shrink-0 flex items-center gap-2 border-b border-[#30363d] bg-[#161b22]">
        <button
          type="button"
          onClick={onBack}
          title="Back to graph (Esc)"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-[#8b949e] hover:text-white hover:bg-[#21262d] shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to graph
        </button>
        <h3 className="text-xs text-white truncate min-w-0" title={title}>
          {title}
        </h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] border border-[#30363d] text-[#8b949e] shrink-0">
          {base.kind === "commit"
            ? `${shortOid(base.oid)} → ${shortOid(file.oid)}`
            : `${shortOid(file.oid)} vs ${base.oid === null ? "empty tree" : `parent ${base.index}`}`}
        </span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {stepButton(-1)}
          {stepButton(1)}
          <button
            type="button"
            aria-pressed={shownMode === "split"}
            disabled={loadedLarge}
            onClick={() => onMode(mode === "split" ? "unified" : "split")}
            title={loadedLarge ? "A large diff shows in unified view only" : "Show the old and new sides side by side"}
            className={`ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] disabled:opacity-50 ${
              shownMode === "split" ? "border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white" : "border-[#30363d] text-[#8b949e] hover:text-white"
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
            Split
          </button>
        </div>
      </header>
      {diff?.modeChange && (
        <div className="px-3 py-1.5 shrink-0 border-b border-[#30363d] text-xs font-mono text-[#d29922]">{modeLabel(diff.modeChange)}</div>
      )}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {state.state === "loading" ? (
          <p role="status" className="p-4 text-xs text-[#8b949e]">
            Reading the diff…
          </p>
        ) : state.state === "failed" ? (
          <div className="p-4 text-xs text-[#ff7b72] flex items-start gap-2">
            <span className="flex-1 min-w-0 break-words">Couldn't read the diff: {state.message}</span>
            <button
              type="button"
              onClick={reader.reload}
              className="shrink-0 inline-flex items-center gap-1 px-1.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : body === "unchanged" ? (
          <p className="p-4 text-xs text-[#8b949e]">No changes to this file against {against}.</p>
        ) : body === "binary" || body === "submodule" ? (
          <p className="p-4 text-xs text-[#8b949e]">{body === "binary" ? "Binary file" : "Submodule"}: no line diff to show.</p>
        ) : body === "modeOnly" ? (
          <p className="p-4 text-xs text-[#8b949e]">Only the mode changed.</p>
        ) : body === "tooLarge" && diff ? (
          <div className="p-4 text-xs text-[#8b949e] flex flex-col items-start gap-2">
            <p>
              This diff is too large to show: {sizeLabel(diff.bytes)}, {diff.lineCount.toLocaleString("en-US")} lines.
            </p>
            <button
              type="button"
              onClick={loadLarge}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]"
            >
              Load anyway
            </button>
          </div>
        ) : unified && diff ? (
          <DiffEditor doc={unified} hunks={diff.hunks} numbers="both" actions={[]} ariaLabel={`Diff of ${title}`} lines={null} />
        ) : split && diff ? (
          <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-[#30363d]">
            <DiffEditor
              doc={split.left}
              hunks={diff.hunks}
              numbers="old"
              actions={[]}
              ariaLabel={`Old side of ${title}`}
              lines={null}
              onScroll={(top) => setScrollTop({ pane: "left", top })}
              scrollTop={scrollTop?.pane === "right" ? scrollTop.top : undefined}
            />
            <DiffEditor
              doc={split.right}
              hunks={diff.hunks}
              numbers="new"
              actions={[]}
              ariaLabel={`New side of ${title}`}
              lines={null}
              onScroll={(top) => setScrollTop({ pane: "right", top })}
              scrollTop={scrollTop?.pane === "left" ? scrollTop.top : undefined}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
};
