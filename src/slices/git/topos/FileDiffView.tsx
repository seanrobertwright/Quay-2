import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Columns2, Loader2, Minus, Plus, RefreshCw } from "lucide-react";
import { usePopupLayer } from "../../overlay/useOverlay";
import { DiffEditor, type HunkAction } from "./DiffEditor";
import { splitDoc, unifiedDoc, type FileDiff } from "./diffDoc";
import { diffBody, imageMime, modeLabel, previewSources, sizeLabel, type ByteSource, type Selection } from "./diffView";
import { errorMessage } from "./gitVersion";
import type { Side } from "./stagingLists";
import type { FileDiffReader, OpenFile } from "./useFileDiff";
import type { BusyOp } from "./useStaging";

export type DiffMode = "unified" | "split";

const SIDE_WORDS: Record<Side, { name: string; verb: string; other: Side; otherName: string; icon: typeof Plus }> = {
  unstaged: { name: "Unstaged", verb: "Stage", other: "staged", otherName: "staged", icon: Plus },
  staged: { name: "Staged", verb: "Unstage", other: "unstaged", otherName: "unstaged", icon: Minus },
};

type Preview = { state: "loading" } | { state: "done"; url: string; bytes: number } | { state: "failed"; message: string };

/**
 * One side of an image's before-and-after preview. The bytes become a blob URL shown by an
 * `<img>`, so an SVG is never inlined into the page and its scripts never run.
 */
const PreviewImage: React.FC<{ worktreePath: string; path: string; source: ByteSource; mime: string; label: string }> = ({
  worktreePath,
  path,
  source,
  mime,
  label,
}) => {
  const [preview, setPreview] = useState<Preview>({ state: "loading" });
  const sourceKey = source.kind === "blob" ? source.oid : "worktree";
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    setPreview({ state: "loading" });
    invoke<ArrayBuffer>("git_file_bytes", { worktreePath, path, source }).then(
      (bytes) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setPreview({ state: "done", url, bytes: bytes.byteLength });
      },
      (e: unknown) => live && setPreview({ state: "failed", message: errorMessage(e) })
    );
    return () => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
    };
    // `source` is described by its key; a new object for the same blob needn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath, path, sourceKey, mime]);

  return (
    <figure className="flex-1 min-w-0 flex flex-col gap-1">
      <figcaption className="text-[11px] text-[#8b949e]">
        {label}
        {preview.state === "done" && ` · ${sizeLabel(preview.bytes)}`}
      </figcaption>
      <div className="flex-1 min-h-0 flex items-center justify-center rounded border border-[#30363d] bg-[repeating-conic-gradient(#161b22_0%_25%,#0d1117_0%_50%)] bg-[length:16px_16px] p-2">
        {preview.state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin text-[#8b949e]" aria-label="Loading preview" />
        ) : preview.state === "failed" ? (
          <p className="text-[11px] text-[#8b949e] text-center break-words">No preview: {preview.message}</p>
        ) : (
          <img src={preview.url} alt={`${label}: ${path}`} className="max-w-full max-h-64 object-contain" />
        )}
      </div>
    </figure>
  );
};

export interface FileDiffViewProps {
  worktreePath: string;
  file: OpenFile;
  reader: FileDiffReader;
  busy: BusyOp | null;
  mode: DiffMode;
  onMode: (mode: DiffMode) => void;
  /** Whether the file has changes on the other side, so an emptied side can point there. */
  otherSideHasChanges: boolean;
  onOpenOtherSide: () => void;
  onBack: () => void;
  /** Whether Topos shows, so Escape returns to the graph only then. */
  visible: boolean;
}

/**
 * A file's diff in place of the graph (#366, #383): read-only CodeMirror 6, unified by default
 * with a Split toggle, a Stage or Unstage hunk button on each hunk header, and the mode change on
 * its own row with its own button. Binary files, submodules and too-large diffs act only whole;
 * images up to 5 MB show before and after. Escape or "Back to graph" returns to the graph.
 */
export const FileDiffView: React.FC<FileDiffViewProps> = ({
  worktreePath,
  file,
  reader,
  busy,
  mode,
  onMode,
  otherSideHasChanges,
  onOpenOtherSide,
  onBack,
  visible,
}) => {
  const root = useRef<HTMLElement>(null);
  usePopupLayer(visible, onBack, root);
  const words = SIDE_WORDS[file.side];
  const { diff: state, loadedLarge, loadLarge, act } = reader;
  const diff: FileDiff | null = state.state === "done" ? state.diff : null;
  const body = diff ? diffBody(diff) : null;
  // A loaded too-large diff shows in unified view only.
  const shownMode: DiffMode = loadedLarge ? "unified" : mode;
  const unified = useMemo(() => (diff && shownMode === "unified" ? unifiedDoc(diff) : null), [diff, shownMode]);
  const split = useMemo(() => (diff && shownMode === "split" ? splitDoc(diff) : null), [diff, shownMode]);
  const [scrollTop, setScrollTop] = useState<{ pane: "left" | "right"; top: number } | null>(null);

  const ownBusy = busy !== null && busy.target.kind === "paths" && busy.target.paths[0] === file.path ? busy : null;
  const busySelection = (s: Selection["kind"]) => ownBusy?.selection?.kind === s;
  const busyHunk = ownBusy?.selection?.kind === "hunks" ? (ownBusy.selection.hunks[0] ?? null) : null;
  const hunkAction = useMemo<HunkAction | null>(
    () =>
      diff && !diff.binary && !diff.submodule
        ? {
            label: `${words.verb} hunk`,
            busyHunk,
            disabled: busy !== null,
            onAct: (hunk) => act({ kind: "hunks", hunks: [hunk] }),
          }
        : null,
    [diff, words.verb, busyHunk, busy, act]
  );

  const ActionIcon = words.icon;
  const actionButton = (selection: Selection, label: string, title: string) => {
    const working = busySelection(selection.kind);
    return (
      <button
        type="button"
        disabled={busy !== null}
        aria-busy={working || undefined}
        onClick={() => act(selection)}
        title={title}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50 shrink-0"
      >
        {working ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <ActionIcon className="w-3 h-3" aria-hidden="true" />}
        {label}
      </button>
    );
  };

  const mime = imageMime(file.path);
  const sources = diff && mime !== null && body !== "unchanged" ? previewSources(diff, { kind: file.side }) : null;
  const sideLabel = file.side === "unstaged" ? ["Index", "Worktree"] : ["HEAD", "Index"];

  return (
    <section ref={root} aria-label={`${words.name} diff of ${file.path}`} className="absolute inset-0 z-10 flex flex-col min-h-0 bg-[#0d1117]">
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
        <h3 className="text-xs text-white truncate min-w-0" title={file.path}>
          {file.path}
        </h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] border border-[#30363d] text-[#8b949e] shrink-0">{words.name}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {diff && body !== "unchanged" && actionButton({ kind: "file" }, `${words.verb} file`, `${words.verb} the whole file`)}
          <button
            type="button"
            aria-pressed={shownMode === "split"}
            disabled={loadedLarge}
            onClick={() => onMode(mode === "split" ? "unified" : "split")}
            title={loadedLarge ? "A large diff shows in unified view only" : "Show the old and new sides side by side"}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] disabled:opacity-50 ${
              shownMode === "split" ? "border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white" : "border-[#30363d] text-[#8b949e] hover:text-white"
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
            Split
          </button>
        </div>
      </header>
      {diff?.modeChange && (
        <div className="px-3 py-1.5 shrink-0 flex items-center gap-2 border-b border-[#30363d] text-xs">
          <span className="font-mono text-[#d29922]">{modeLabel(diff.modeChange)}</span>
          {actionButton({ kind: "modeChange" }, `${words.verb} mode change`, `${words.verb} only the mode change`)}
        </div>
      )}
      {diff && sources && (sources.before || sources.after) && (
        <div className="px-3 py-2 shrink-0 flex gap-3 border-b border-[#30363d] max-h-80">
          {sources.before && <PreviewImage worktreePath={worktreePath} path={file.path} source={sources.before} mime={mime!} label={`Before (${sideLabel[0]})`} />}
          {sources.after && <PreviewImage worktreePath={worktreePath} path={file.path} source={sources.after} mime={mime!} label={`After (${sideLabel[1]})`} />}
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        {state.state === "loading" ? (
          <p role="status" className="p-4 text-xs text-[#8b949e]">
            Reading the diff…
          </p>
        ) : state.state === "failed" ? (
          <div className="p-4 text-xs text-[#ff7b72] flex items-start gap-2">
            <span className="flex-1 min-w-0 break-words">Couldn't read the diff: {state.message}</span>
            <button
              type="button"
              onClick={() => void reader.reload()}
              className="shrink-0 inline-flex items-center gap-1 px-1.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : body === "unchanged" ? (
          <div className="p-4 text-xs text-[#8b949e] flex items-center gap-2">
            <span>No {words.name.toLowerCase()} changes in this file.</span>
            {otherSideHasChanges && (
              <button type="button" onClick={onOpenOtherSide} className="text-[#58a6ff] hover:underline">
                Show its {words.otherName} changes
              </button>
            )}
          </div>
        ) : body === "binary" || body === "submodule" ? (
          <p className="p-4 text-xs text-[#8b949e]">
            {body === "binary" ? "Binary file" : "Submodule"}: only whole-file actions apply.
          </p>
        ) : body === "modeOnly" ? (
          <p className="p-4 text-xs text-[#8b949e]">Only the mode changed.</p>
        ) : body === "tooLarge" && diff ? (
          <div className="p-4 text-xs text-[#8b949e] flex flex-col items-start gap-2">
            <p>
              This diff is too large to show: {sizeLabel(diff.bytes)}, {diff.lineCount.toLocaleString("en-US")} lines. You can still{" "}
              {words.verb.toLowerCase()} the whole file.
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
          <DiffEditor doc={unified} hunks={diff.hunks} numbers="both" action={hunkAction} ariaLabel={`${words.name} diff of ${file.path}`} />
        ) : split && diff ? (
          <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-[#30363d]">
            <DiffEditor
              doc={split.left}
              hunks={diff.hunks}
              numbers="old"
              action={hunkAction}
              ariaLabel={`Old side of ${file.path}`}
              onScroll={(top) => setScrollTop({ pane: "left", top })}
              scrollTop={scrollTop?.pane === "right" ? scrollTop.top : undefined}
            />
            <DiffEditor
              doc={split.right}
              hunks={diff.hunks}
              numbers="new"
              action={null}
              ariaLabel={`New side of ${file.path}`}
              onScroll={(top) => setScrollTop({ pane: "right", top })}
              scrollTop={scrollTop?.pane === "left" ? scrollTop.top : undefined}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
};
