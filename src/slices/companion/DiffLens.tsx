import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PullRequestFile, PullRequestTimeline } from "../github/types.ts";
import { Lens } from "../lens/Lens.tsx";
import { commentsByPath } from "./cellDetails.ts";
import { FileDiff } from "./FileDiff.tsx";
import { useGithubRead } from "./useGithubRead.ts";
import type { DiffLensTarget } from "./diffLensTarget.ts";

const MUTED = "text-[#8b949e]";

/** A path's folder, or "" for a file at the repository's root. */
const folderOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

interface DiffLensProps {
  target: DiffLensTarget;
  onClose: () => void;
  /** The reply strip at the lens's foot. */
  replyStrip?: ReactNode;
}

/**
 * The diff lens: a pull request's file filter, a file tree that marks viewed and commented files,
 * and every diff stacked, opened on the target's file. What is marked viewed lasts while the lens
 * is open.
 */
export const DiffLens = ({ target, onClose, replyStrip = null }: DiffLensProps) => {
  const location = { repoPath: target.repoPath, repo: target.repo, number: target.number };
  const files = useGithubRead<PullRequestFile[]>("get_github_pr_files", location);
  const timeline = useGithubRead<PullRequestTimeline>("get_github_pr_timeline", location);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(target.file);
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const filterBox = useRef<HTMLInputElement>(null);
  const diffs = useRef<HTMLDivElement>(null);
  const list = useMemo(() => files.data ?? [], [files.data]);
  const commented = commentsByPath(timeline.data);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? list.filter((f) => f.path.toLowerCase().includes(needle)) : list;

  useEffect(() => {
    filterBox.current?.focus({ preventScroll: true });
  }, []);

  /** Scrolls the stack to `path`'s diff. */
  const scrollTo = (path: string) => {
    const article = [...(diffs.current?.querySelectorAll<HTMLElement>("article[data-file]") ?? [])].find(
      (a) => a.dataset.file === path,
    );
    article?.scrollIntoView?.({ block: "start" });
  };
  // The stack moves to the file the lens was opened on once the files are read, and again each
  // time it is asked to open on another.
  const [openedOn, setOpenedOn] = useState(target.file);
  const [scrollPending, setScrollPending] = useState(target.file);
  if (target.file !== openedOn) {
    setOpenedOn(target.file);
    setSelected(target.file);
    setScrollPending(target.file);
  }
  useEffect(() => {
    if (scrollPending === null || list.length === 0) return;
    scrollTo(scrollPending);
    setScrollPending(null);
  }, [list, scrollPending]);

  const toggleViewed = (path: string) =>
    setViewed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  let folder: string | null = null;
  const tree: ReactNode[] = [];
  for (const file of shown) {
    const dir = folderOf(file.path);
    if (dir !== folder) {
      folder = dir;
      tree.push(
        <li key={`dir:${dir}`} aria-hidden="true" className={`px-2 pt-2 pb-0.5 font-mono ${MUTED}`}>
          {dir || "(root)"}
        </li>,
      );
    }
    const comments = commented.get(file.path) ?? 0;
    const isViewed = viewed.has(file.path);
    tree.push(
      <li key={file.path}>
        <button
          type="button"
          aria-current={selected === file.path ? "true" : undefined}
          title={file.path}
          onClick={() => {
            setSelected(file.path);
            scrollTo(file.path);
          }}
          className={`flex w-full items-baseline gap-1 rounded px-2 py-1 text-left hover:bg-[#1c2128] ${
            selected === file.path ? "bg-[#1f6feb26] text-white" : isViewed ? MUTED : "text-[#c9d1d9]"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{nameOf(file.path)}</span>
          {isViewed && (
            <span className="text-[#3fb950]">
              <span aria-hidden="true">✓</span>
              <span className="sr-only"> viewed</span>
            </span>
          )}
          {comments > 0 && (
            <span className="text-[#58a6ff]">
              <span aria-hidden="true">💬</span>
              <span className="sr-only">, {comments} {comments === 1 ? "comment" : "comments"}</span>
            </span>
          )}
        </button>
      </li>,
    );
  }

  return (
    <Lens
      label="Diff lens"
      title={`Files · pull request #${target.number}`}
      terminalId={target.terminalId}
      onClose={onClose}
      replyStrip={replyStrip}
    >
      <div className="shrink-0 flex items-center gap-2 border-b border-[#30363d] px-3 py-2 text-xs">
        <input
          ref={filterBox}
          type="search"
          aria-label="Filter changed files"
          placeholder={`Filter ${list.length} files`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-64 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[#c9d1d9]"
        />
        <span data-viewed-count className={MUTED}>
          {viewed.size} of {list.length} viewed
        </span>
      </div>
      {files.error && (
        <p role="alert" className="px-3 py-2 text-xs text-[#f85149] break-words">
          Could not read the files: {files.error}
        </p>
      )}
      {files.data === null && files.loading && <p className={`px-3 py-2 text-xs ${MUTED}`}>Reading the files…</p>}
      <div className="flex-1 min-h-0 flex text-xs">
        <nav aria-label="Changed files" className="w-60 shrink-0 overflow-y-auto border-r border-[#30363d] py-1">
          <ul>{tree}</ul>
          {files.data && shown.length === 0 && <p className={`px-2 py-1 ${MUTED}`}>No file matches.</p>}
        </nav>
        <div ref={diffs} className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3">
          {shown.map((file) => (
            <FileDiff
              key={file.path}
              file={file}
              capped={false}
              controls={
                <label className={`flex items-center gap-1 ${MUTED}`}>
                  <input type="checkbox" checked={viewed.has(file.path)} onChange={() => toggleViewed(file.path)} />
                  Viewed
                </label>
              }
            />
          ))}
        </div>
      </div>
    </Lens>
  );
};
