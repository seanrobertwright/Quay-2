import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BadgeCheck, ChevronDown, ChevronRight, Copy, Loader2, ShieldAlert, ShieldQuestion, X } from "lucide-react";
import { formatDateTime } from "../../../lib/dates";
import { usePopupLayer } from "../../overlay/useOverlay";
import { committerShown, filesNote, linkify, keyedTrailers, type CommitDetails, type CommitFile, type FileStatus, type Person } from "./commitDetails";
import { movedRow } from "./commitSelection";
import type { Badge } from "./graphRefs";
import { shortOid } from "./graphStore";
import { renderedActiveRow, ROW_HEIGHT, rowWindow } from "./graphWindow";
import { InspectorHandle } from "./InspectorHandle";
import { nodeTooltip } from "./provenance";
import type { LoadState } from "./settledLoader";
import { useVerifyCommit, type FilesState, type OpenCommitFile, type VerifyState } from "./useCommitDetails";

export interface CommitInspectorProps {
  id: string;
  repoPath: string;
  /** The selected commit's details, the previous commit's while it loads. */
  details: LoadState<CommitDetails>;
  width: number;
  onWidth: (width: number) => void;
  onClose: () => void;
  /** The badges on a commit's row (#378). */
  badgesOf: (oid: string) => Badge[];
  /** Copies `text`, a SHA, and says so in a toast. */
  onCopy: (text: string) => void;
  /** A parent link: selects that commit in the graph. */
  onSelectCommit: (oid: string) => void;
  /** The shown commit's files against parent `parentIndex`. */
  files: FilesState;
  /** The parent, from 1, the files are diffed against. */
  parentIndex: number;
  onParentIndex: (oid: string, index: number) => void;
  openFile: OpenCommitFile | null;
  /** Opens `file` of the shown commit, diffed against parent `parentIndex`. */
  onOpenFile: (file: CommitFile) => void;
  /** Escape inside the inspector: focus goes back to the graph. */
  onEscape: () => void;
  /** Enter on the graph focuses this. */
  focusRef: React.RefObject<HTMLElement | null>;
}

const LETTER_WORDS: Record<FileStatus, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
};

const LETTER_CLASS: Record<FileStatus, string> = {
  A: "text-[#3fb950]",
  M: "text-[#d29922]",
  D: "text-[#f85149]",
  R: "text-[#58a6ff]",
  C: "text-[#58a6ff]",
  T: "text-[#8b949e]",
};

/** A commit body as text with only http(s) links (#368): React text children, never HTML. */
const Body: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-xs text-[#c9d1d9] whitespace-pre-wrap break-words">
    {linkify(text).map((part) =>
      part.kind === "text" ? (
        <React.Fragment key={part.start}>{part.text}</React.Fragment>
      ) : (
        <a
          key={part.start}
          href={part.href}
          onClick={(e) => {
            e.preventDefault();
            openUrl(part.href).catch(console.error);
          }}
          className="text-[#58a6ff] hover:underline"
        >
          {part.text}
        </a>
      )
    )}
  </p>
);

const PersonLine: React.FC<{ heading: string; person: Person }> = ({ heading, person }) => (
  <div className="flex flex-col min-w-0">
    <dt className="text-[10px] uppercase tracking-wide text-[#8b949e]">{heading}</dt>
    <dd className="text-xs text-[#c9d1d9] truncate" title={`${person.name} <${person.email}>`}>
      {person.name} <span className="text-[#8b949e]">&lt;{person.email}&gt;</span>
    </dd>
    <dd className="text-[11px] text-[#8b949e] tabular-nums">{formatDateTime(person.timeMs)}</dd>
  </div>
);

const VERIFY_WORDS = {
  good: { text: "Good signature", Icon: BadgeCheck, className: "text-[#3fb950]" },
  bad: { text: "Bad signature", Icon: ShieldAlert, className: "text-[#f85149]" },
  unknownKey: { text: "Signed with a key Quay can't check", Icon: ShieldQuestion, className: "text-[#d29922]" },
  none: { text: "No signature", Icon: ShieldQuestion, className: "text-[#8b949e]" },
} as const;

/** The Signed chip (#368) with its on-demand Verify. */
const SignedChip: React.FC<{ verify: VerifyState; onVerify: () => void }> = ({ verify, onVerify }) => (
  <div className="flex items-center gap-2 flex-wrap text-[11px]">
    <span className="inline-flex items-center gap-1 px-1.5 rounded border border-[#3fb950]/50 text-[#7ee787]">Signed</span>
    {verify.state === "done" ? (
      (() => {
        const { text, Icon, className } = VERIFY_WORDS[verify.result.status];
        return (
          <span role="status" className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
            <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={verify.result.signer ?? undefined}>
              {text}
              {verify.result.signer ? ` · ${verify.result.signer}` : ""}
            </span>
          </span>
        );
      })()
    ) : (
      <button
        type="button"
        onClick={onVerify}
        disabled={verify.state === "checking"}
        aria-busy={verify.state === "checking" || undefined}
        title="Check the signature with git verify-commit"
        className="inline-flex items-center gap-1 px-1.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50"
      >
        {verify.state === "checking" && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
        Verify
      </button>
    )}
    {verify.state === "failed" && (
      <span role="alert" className="text-[#ff7b72] break-words">
        Couldn't verify: {verify.message}
      </span>
    )}
  </div>
);

function countsLabel(file: CommitFile): string {
  if (file.additions === null || file.deletions === null) return "binary";
  return `+${file.additions.toLocaleString("en-US")} −${file.deletions.toLocaleString("en-US")}`;
}

/**
 * A commit's files (#397): a virtualized listbox of status letter, path and `+n −m`. Clicking a
 * file opens its read-only diff; ↑/↓ move the selection, and the open diff follows it, so the
 * arrows step between files.
 */
const CommitFileList: React.FC<{
  files: CommitFile[];
  openPath: string | null;
  onOpen: (file: CommitFile) => void;
  label: string;
}> = ({ files, openPath, onOpen, label }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  const [activePath, setActivePath] = useState<string | null>(null);
  const idPrefix = useId();
  const hintId = useId();
  const win = rowWindow(top, height, files.length);
  const shownPath = openPath ?? activePath;
  const found = shownPath === null ? -1 : files.findIndex((f) => f.path === shownPath);
  const active = renderedActiveRow(found === -1 ? null : found, win);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const moveTo = (index: number, open: boolean) => {
    const file = files[index];
    const el = scroller.current;
    if (file === undefined || !el) return;
    setActivePath(file.path);
    if (open) onOpen(file);
    const rowTop = index * ROW_HEIGHT;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowTop + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + ROW_HEIGHT - el.clientHeight;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (files.length === 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const steps: Record<string, "up" | "down" | "home" | "end"> = { ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end" };
    if (e.key === "Enter") {
      e.preventDefault();
      const file = files[found === -1 ? (active ?? 0) : found];
      if (file) onOpen(file);
      return;
    }
    const step = steps[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const row = movedRow(found === -1 ? null : found, step, { rowCount: files.length, pageRows: 1, firstVisible: win.start });
    if (row !== null) moveTo(row, openPath !== null);
  };

  const shown: React.ReactNode[] = [];
  for (let i = win.start; i < win.end; i++) {
    const file = files[i];
    if (file === undefined) continue;
    const words = LETTER_WORDS[file.status];
    shown.push(
      <div
        key={file.path}
        id={`${idPrefix}-${i}`}
        role="option"
        aria-selected={i === found}
        data-row={i}
        title={file.oldPath ? `${file.oldPath} → ${file.path} (${words})` : `${file.path} (${words})`}
        className={`absolute inset-x-0 flex items-center gap-1.5 px-2 text-xs cursor-pointer ${
          i === active ? "bg-[#161b22] group-focus-visible/list:shadow-[inset_0_0_0_1px_#06B6D4]" : "hover:bg-[#161b22]"
        } ${openPath === file.path ? "shadow-[inset_2px_0_0_#06B6D4]" : ""}`}
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
      >
        <span aria-hidden="true" className={`w-3 shrink-0 text-center font-mono font-semibold ${LETTER_CLASS[file.status]}`}>
          {file.status}
        </span>
        <span className="flex-1 min-w-0 truncate text-[#c9d1d9]">
          {file.oldPath !== null && <span className="text-[#8b949e]">{file.oldPath} → </span>}
          {file.path}
        </span>
        <span className="sr-only">, {words}</span>
        <span className="shrink-0 font-mono text-[10px] text-[#8b949e] tabular-nums">{countsLabel(file)}</span>
      </div>
    );
  }

  return (
    <>
      <p id={hintId} className="sr-only">
        Up and Down move between files, and the open diff follows. Enter or a click opens a file's diff.
      </p>
      <div
        ref={scroller}
        role="listbox"
        aria-label={label}
        aria-describedby={hintId}
        aria-activedescendant={active === null ? undefined : `${idPrefix}-${active}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const option = e.target instanceof Element ? e.target.closest("[data-row]") : null;
          const index = option === null ? -1 : Number(option.getAttribute("data-row"));
          if (Number.isSafeInteger(index) && index >= 0) moveTo(index, true);
        }}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        className="group/list flex-1 min-h-24 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#06B6D4]/60"
      >
        {files.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[#8b949e]">No files changed</p>
        ) : (
          <div className="relative" style={{ height: files.length * ROW_HEIGHT }}>
            {shown}
          </div>
        )}
      </div>
    </>
  );
};

/**
 * The inspector in details mode (#368, #397): what a selected commit is. The subject and the body
 * (text with only http and https linkified), the full SHA with Copy SHA and Copy short, parents as
 * links that select them in the graph, the author and, only when someone else, the committer, the
 * refs, a provenance row, a collapsed Trailers section, a Signed chip with an on-demand Verify, and
 * its files. A merge's files are diffed against parent 1 unless the picker says otherwise; there is
 * no combined diff. While the next commit loads the previous one stays, dimmed.
 */
export const CommitInspector: React.FC<CommitInspectorProps> = ({
  id,
  repoPath,
  details,
  width,
  onWidth,
  onClose,
  badgesOf,
  onCopy,
  onSelectCommit,
  files,
  parentIndex,
  onParentIndex,
  openFile,
  onOpenFile,
  onEscape,
  focusRef,
}) => {
  const titleId = useId();
  const trailersId = useId();
  const parentId = useId();
  const root = useRef<HTMLElement>(null);
  const shown = details.shown;
  const oid = shown?.oid ?? null;
  // Escape in the inspector goes back to the graph before it closes Topos.
  const [focusWithin, setFocusWithin] = useState(false);
  usePopupLayer(focusWithin, onEscape, root);
  const [trailersOpen, setTrailersOpen] = useState(false);
  const { verify, run: runVerify } = useVerifyCommit(repoPath, oid);
  useEffect(() => setTrailersOpen(false), [oid]);

  const badges = oid === null ? [] : badgesOf(oid);
  return (
    <aside
      id={id}
      ref={(el) => {
        root.current = el;
        (focusRef as React.MutableRefObject<HTMLElement | null>).current = el;
      }}
      tabIndex={-1}
      aria-labelledby={titleId}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      className="relative shrink-0 flex flex-col min-h-0 border-l border-[#30363d] bg-[#0d1117] outline-none"
      style={{ width }}
    >
      <InspectorHandle width={width} onWidth={onWidth} label="Resize commit inspector" />
      <header className="h-9 px-3 shrink-0 flex items-center gap-2">
        <h3 id={titleId} className="text-xs font-semibold text-white truncate min-w-0">
          Commit{oid !== null && <span className="ml-1 font-mono text-[#8b949e]">{shortOid(oid)}</span>}
        </h3>
        {details.pending && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8b949e] shrink-0" aria-label="Loading the commit" />}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close commit inspector"
          className="ml-auto p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </header>
      {details.error !== null && (
        <p role="alert" className="px-3 py-2 text-[11px] text-[#ff7b72] bg-[#f85149]/10 border-t border-[#f85149]/30 break-words">
          Couldn't read the commit: {details.error}
        </p>
      )}
      {shown === null ? (
        details.error === null && (
          <p role="status" className="px-3 py-2 text-xs text-[#8b949e]">
            Reading the commit…
          </p>
        )
      ) : (
        <div
          aria-busy={details.pending || undefined}
          className={`flex-1 min-h-0 flex flex-col transition-opacity ${details.pending ? "opacity-50" : ""}`}
        >
          <div className="shrink-0 max-h-[60%] overflow-y-auto px-3 pb-3 flex flex-col gap-3 border-t border-[#30363d] pt-3">
            <h4 className="text-sm font-semibold text-white break-words">{shown.subject}</h4>
            {shown.body !== "" && <Body text={shown.body} />}
            <div className="flex items-center gap-2 min-w-0">
              <code className="flex-1 min-w-0 truncate font-mono text-[11px] text-[#c9d1d9]" title={shown.oid}>
                {shown.oid}
              </code>
              <button
                type="button"
                onClick={() => onCopy(shown.oid)}
                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d]"
              >
                <Copy className="w-3 h-3" aria-hidden="true" />
                Copy SHA
              </button>
              <button
                type="button"
                onClick={() => onCopy(shortOid(shown.oid))}
                className="shrink-0 px-1.5 py-0.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d]"
              >
                Copy short
              </button>
            </div>
            <dl className="grid grid-cols-1 gap-2">
              <div className="flex flex-col min-w-0">
                <dt className="text-[10px] uppercase tracking-wide text-[#8b949e]">{shown.parents.length === 1 ? "Parent" : "Parents"}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {shown.parents.length === 0 ? (
                    <span className="text-xs text-[#8b949e]">None: this is a root commit</span>
                  ) : (
                    shown.parents.map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onSelectCommit(p)}
                        title={`Select parent ${i + 1}, ${p}, in the graph`}
                        className="font-mono text-[11px] text-[#58a6ff] hover:underline"
                      >
                        {shortOid(p)}
                      </button>
                    ))
                  )}
                </dd>
              </div>
              <PersonLine heading="Author" person={shown.author} />
              {committerShown(shown.author, shown.committer) && <PersonLine heading="Committer" person={shown.committer} />}
              {badges.length > 0 && (
                <div className="flex flex-col min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-[#8b949e]">Refs</dt>
                  <dd className="flex flex-wrap gap-1">
                    {badges.map((b) => (
                      <span
                        key={b.kind === "head" ? `head:${b.path}` : `${b.kind}:${b.name}`}
                        className="max-w-full truncate px-1.5 rounded border border-[#30363d] text-[10px] leading-4 text-[#c9d1d9]"
                      >
                        {b.kind === "head" ? `HEAD · ${b.name}` : b.name}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <dt className="text-[10px] uppercase tracking-wide text-[#8b949e]">Provenance</dt>
                {nodeTooltip(shown.provenance, shown.author.name).map((line) => (
                  <dd key={line} className="text-xs text-[#c9d1d9] break-words">
                    {line}
                  </dd>
                ))}
              </div>
            </dl>
            {shown.hasSignature && <SignedChip verify={verify} onVerify={runVerify} />}
            {shown.trailers.length > 0 && (
              <section aria-label="Trailers">
                <h5>
                  <button
                    type="button"
                    aria-expanded={trailersOpen}
                    aria-controls={trailersId}
                    onClick={() => setTrailersOpen(!trailersOpen)}
                    className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#8b949e] hover:text-white"
                  >
                    {trailersOpen ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                    Trailers
                    <span className="normal-case font-normal tabular-nums">{shown.trailers.length.toLocaleString("en-US")}</span>
                  </button>
                </h5>
                <dl id={trailersId} hidden={!trailersOpen} className="mt-1 flex flex-col gap-0.5">
                  {keyedTrailers(shown.trailers).map(({ id, trailer: t }) => (
                    <div key={id} className="text-[11px] break-words">
                      <dt className="inline text-[#8b949e]">{t.key}: </dt>
                      <dd className="inline text-[#c9d1d9]">{t.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
          <div className="h-8 px-3 shrink-0 flex items-center gap-2 border-y border-[#30363d] bg-[#161b22]">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8b949e]">
              Files
              {files.state === "done" && (
                <span className="ml-1.5 normal-case font-normal tabular-nums">{files.files.total.toLocaleString("en-US")}</span>
              )}
            </h4>
            {shown.parents.length > 1 && (
              <>
                <label htmlFor={parentId} className="ml-auto text-[11px] text-[#8b949e] shrink-0">
                  Diff against
                </label>
                <select
                  id={parentId}
                  value={parentIndex}
                  onChange={(e) => onParentIndex(shown.oid, Number(e.target.value))}
                  className="min-w-0 max-w-[50%] px-1 py-0.5 rounded border border-[#30363d] bg-[#0d1117] text-[11px] text-[#c9d1d9]"
                >
                  {shown.parents.map((p, i) => (
                    <option key={p} value={i + 1}>
                      Parent {i + 1} · {shortOid(p)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {files.state === "failed" ? (
            <p role="alert" className="px-3 py-2 text-xs text-[#ff7b72] break-words">
              Couldn't read the files: {files.message}
            </p>
          ) : files.state === "done" ? (
            <>
              <CommitFileList
                files={files.files.files}
                openPath={openFile !== null && openFile.oid === shown.oid && openFile.parentIndex === parentIndex ? openFile.path : null}
                onOpen={onOpenFile}
                label={`Files of ${shortOid(shown.oid)}`}
              />
              {filesNote(files.files) !== null && (
                <p role="status" className="px-3 py-1 text-[11px] text-[#d29922] bg-[#d29922]/10 border-t border-[#d29922]/30">
                  {filesNote(files.files)}
                </p>
              )}
            </>
          ) : (
            <p role="status" className="px-3 py-2 text-xs text-[#8b949e]">
              Reading the files…
            </p>
          )}
        </div>
      )}
    </aside>
  );
};
