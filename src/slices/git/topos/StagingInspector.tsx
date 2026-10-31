import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, EyeOff, FolderTree, Loader2, Minus, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { CommitComposer } from "./CommitComposer";
import { HeldBadge } from "./HeldBadge";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { DiscardButton } from "./DiscardButton";
import { confirmDiscardAll, confirmDiscardFile, targetLabel, type DiscardEntry } from "./discards";
import { renderedActiveRow, ROW_HEIGHT, rowWindow } from "./graphWindow";
import {
  BUSY_MESSAGE,
  capNote,
  clampInspectorWidth,
  inspectorWidthByKey,
  listKeyAction,
  MAX_INSPECTOR_WIDTH,
  MIN_INSPECTOR_WIDTH,
  type StageDirection,
} from "./stagingKeys";
import { isFolderRow, listRows, splitStatus, type ListMode, type ListRow, type PathTarget, type Side } from "./stagingLists";
import type { OpenFile } from "./useFileDiff";
import type { Commit } from "./useCommit";
import { CONFLICT_WORDS, type OpState } from "./operation";
import type { HandToAgent } from "./useHandToAgent";
import type { BusyOp, Staging } from "./useStaging";

/** Each status letter as words, for the row's title and its spoken name. */
const LETTER_WORDS: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "unmerged",
  "?": "untracked",
};

const LETTER_CLASS: Record<string, string> = {
  M: "text-[#d29922]",
  A: "text-[#3fb950]",
  D: "text-[#f85149]",
  U: "text-[#f85149]",
  "?": "text-[#3fb950]",
};

/** What each list is called and what acting on it does. */
const SIDE: Record<
  Side,
  {
    listLabel: string;
    heading: string;
    empty: string;
    action: StageDirection;
    verb: string;
    key: string;
    icon: typeof Plus;
    /** What `s` or `u` on this list says when it's the other list's key. */
    wrongKey: (path: string) => string;
    allLabel: string;
    allBusy: string;
    allClass: string;
  }
> = {
  unstaged: {
    listLabel: "Unstaged changes",
    heading: "Unstaged",
    empty: "No unstaged changes",
    action: "stage",
    verb: "Stage",
    key: "S",
    icon: Plus,
    wrongKey: (path) => `${path} isn't staged`,
    allLabel: "Stage all",
    allBusy: "Staging…",
    allClass: "bg-[#238636] hover:bg-[#2ea043] text-white",
  },
  staged: {
    listLabel: "Staged changes",
    heading: "Staged",
    empty: "Nothing staged",
    action: "unstage",
    verb: "Unstage",
    key: "U",
    icon: Minus,
    wrongKey: (path) => `${path} is already staged`,
    allLabel: "Unstage all",
    allBusy: "Unstaging…",
    allClass: "border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]",
  },
};

/** Whether `el` takes typed text, where the lists' bare keys must not act. */
function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** The paths a stage or unstage of `row` acts on, or null for a row it can't act on. */
function rowTarget(row: ListRow): PathTarget | null {
  return row.type === "note" ? null : { kind: "paths", paths: [row.path] };
}

/** Whether `row` is a file whose diff can open: a tracked or untracked file, not a folder or a conflict. */
function opensDiff(row: ListRow): boolean {
  return row.type === "change" && (row.change?.kind === "tracked" || row.change?.kind === "untracked");
}

/** Whether `row` can be discarded on its own: a tracked or untracked file, or an untracked folder. */
function discardable(row: ListRow): boolean {
  const kind = row.change?.kind;
  return row.type === "change" && (kind === "tracked" || kind === "untracked" || kind === "untrackedFolder");
}

function isBusyFor(busy: BusyOp | null, row: ListRow): boolean {
  return busy !== null && busy.target.kind === "paths" && busy.target.paths.includes(row.path);
}

interface ChangeListProps {
  side: Side;
  rows: ListRow[];
  busy: BusyOp | null;
  /** Stages a row from Unstaged, or unstages one from Staged. */
  onAct: (row: ListRow) => void;
  /** Asks to discard a row's unstaged changes; only the Unstaged list has it. */
  onDiscard?: (row: ListRow) => void;
  /** Enter on a folder: collapses or expands it. */
  onOpen: (row: ListRow) => void;
  announce: (text: string) => void;
  hintId: string;
  /** The operator made `row` the active row, by key or pointer. */
  onActive?: (row: ListRow) => void;
  /** Click or Enter on a file: opens its diff in place of the graph. */
  onOpenFile: (row: ListRow) => void;
  /** The path whose diff is open from this list, or null. */
  openPath: string | null;
}

/**
 * One of the inspector's lists: a listbox of fixed-height rows with only a window of them in the
 * DOM, so a list of 10,000 changes renders a few dozen. ↑/↓ move the active row, Enter opens a
 * folder, and `s` or `u` acts on the active row.
 */
const ChangeList: React.FC<ChangeListProps> = ({ side, rows, busy, onAct, onDiscard, onOpen, announce, hintId, onActive, onOpenFile, openPath }) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  // The active row is kept by key, so it follows its change when the list above it changes.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const idPrefix = useId();
  const win = rowWindow(top, height, rows.length);
  const found = activeKey === null ? -1 : rows.findIndex((r) => r.key === activeKey);
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

  const moveTo = (index: number) => {
    const row = rows[index];
    const el = scroller.current;
    if (row === undefined || !el) return;
    setActiveKey(row.key);
    onActive?.(row);
    const rowTop = index * ROW_HEIGHT;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowTop + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + ROW_HEIGHT - el.clientHeight;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const action = listKeyAction(e, isTextField(e.target));
    if (action === null || rows.length === 0) return;
    e.preventDefault();
    const current = found === -1 ? (active ?? 0) : found;
    const row = rows[current];
    switch (action) {
      case "up":
        moveTo(found === -1 ? current : Math.max(0, current - 1));
        return;
      case "down":
        moveTo(found === -1 ? current : Math.min(rows.length - 1, current + 1));
        return;
      case "open":
        if (row && row.expanded !== undefined) onOpen(row);
        else if (row && opensDiff(row)) onOpenFile(row);
        return;
      case "stage":
      case "unstage": {
        if (!row) return;
        if (action !== SIDE[side].action) {
          announce(SIDE[side].wrongKey(row.path));
          return;
        }
        if (busy !== null) {
          announce(BUSY_MESSAGE);
          return;
        }
        if (rowTarget(row)) onAct(row);
      }
    }
  };

  // A click on a file row opens its diff; the listbox takes it, as it takes the row's keys.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const option = e.target instanceof Element ? e.target.closest("[data-row]") : null;
    const row = option === null ? undefined : rows[Number(option.getAttribute("data-row"))];
    if (row !== undefined && opensDiff(row)) onOpenFile(row);
  };

  const { listLabel, empty, verb, key: actionKey, icon: ActionIcon } = SIDE[side];
  const shown: React.ReactNode[] = [];
  for (let i = win.start; i < win.end; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const isActive = i === active;
    const letter = row.change?.letter ?? "";
    const words = LETTER_WORDS[letter] ?? letter;
    const rowBusy = isBusyFor(busy, row);
    const actionLabel = `${verb} ${row.path}${isFolderRow(row) ? "/" : ""}`;
    shown.push(
      <div
        key={row.key}
        id={`${idPrefix}-${i}`}
        role="option"
        aria-selected={isActive}
        aria-busy={rowBusy || undefined}
        tabIndex={-1}
        onPointerDown={() => {
          setActiveKey(row.key);
          onActive?.(row);
        }}
        data-row={i}
        onDoubleClick={() => row.expanded !== undefined && onOpen(row)}
        title={row.type === "note" ? row.name : `${row.path} (${row.type === "dir" ? "folder" : words})`}
        className={`group/row absolute inset-x-0 flex items-center gap-1.5 pr-1 text-xs ${opensDiff(row) ? "cursor-pointer" : ""} ${
          isActive ? "bg-[#161b22] group-focus-visible/list:shadow-[inset_0_0_0_1px_#06B6D4]" : "hover:bg-[#161b22]"
        } ${openPath === row.path && row.type === "change" ? "shadow-[inset_2px_0_0_#06B6D4]" : ""}`}
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * 14 }}
      >
        {row.expanded === undefined ? (
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.path}/`}
            onClick={() => onOpen(row)}
            className="w-3.5 shrink-0 text-[#8b949e] hover:text-white"
          >
            {row.expanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        )}
        {row.type === "note" ? (
          <span className="flex-1 min-w-0 truncate italic text-[#8b949e]">{row.name}</span>
        ) : (
          <>
            <span
              aria-hidden="true"
              className={`w-3 shrink-0 text-center font-mono font-semibold ${LETTER_CLASS[letter] ?? "text-[#8b949e]"}`}
            >
              {letter}
            </span>
            <span className="flex-1 min-w-0 truncate text-[#c9d1d9]">
              {row.name}
              {isFolderRow(row) ? "/" : ""}
            </span>
            {/* An option can't carry aria-expanded, so the folder's state is spoken instead. */}
            <span className="sr-only">
              , {row.type === "dir" ? "folder" : words}
              {row.expanded === undefined ? "" : row.expanded ? ", expanded" : ", collapsed"}
            </span>
            {!rowBusy && onDiscard && discardable(row) && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Discard ${row.path}${isFolderRow(row) ? "/" : ""}`}
                title={`Discard ${row.path}${isFolderRow(row) ? "/" : ""}`}
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard(row);
                }}
                className="shrink-0 p-0.5 rounded text-[#8b949e] opacity-0 group-hover/row:opacity-100 hover:text-[#ff7b72] hover:bg-[#30363d] disabled:opacity-40"
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            {rowBusy ? (
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[#8b949e]" aria-label="Working" />
            ) : (
              // The keyboard's way to this is `s` or `u` on the active row, so the button stays out of the tab order.
              <button
                type="button"
                tabIndex={-1}
                aria-label={actionLabel}
                title={`${actionLabel} (${actionKey})`}
                disabled={busy !== null}
                onClick={(e) => {
                  // The row's own click opens the diff; this one only stages or unstages.
                  e.stopPropagation();
                  onAct(row);
                }}
                className="shrink-0 p-0.5 rounded text-[#8b949e] opacity-0 group-hover/row:opacity-100 hover:text-white hover:bg-[#30363d] disabled:opacity-40"
              >
                <ActionIcon className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      role="listbox"
      aria-label={listLabel}
      aria-describedby={hintId}
      aria-activedescendant={active === null ? undefined : `${idPrefix}-${active}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      className="group/list flex-1 min-h-0 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#06B6D4]/60"
    >
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-[#8b949e]">{empty}</p>
      ) : (
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {shown}
        </div>
      )}
    </div>
  );
};

const DISCARD_STATE: Record<DiscardEntry["state"], string> = {
  discarded: "",
  restored: "Restored",
  changed: "Changed since the discard",
  copied: "Copied",
};

/** One discard in Recently discarded: Restore, or Copy to a new file once the file has changed since. */
const DiscardRow: React.FC<{
  entry: DiscardEntry;
  busy: boolean;
  onRestore: (entry: DiscardEntry) => void;
  onCopy: (entry: DiscardEntry) => void;
}> = ({ entry, busy, onRestore, onCopy }) => {
  const note =
    entry.state === "copied" ? `Copied to ${entry.copiedTo.join(", ")}` : entry.state === "changed" ? `${DISCARD_STATE.changed}: ${entry.changedPaths.join(", ")}` : DISCARD_STATE[entry.state];
  const button = "shrink-0 px-1.5 py-0.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50";
  return (
    <li className="px-3 py-1 flex items-center gap-2 text-xs">
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[#c9d1d9]" title={entry.label}>
          {entry.label}
        </span>
        {note && <span className="block truncate text-[11px] text-[#8b949e]" title={note}>{note}</span>}
      </span>
      {entry.state === "discarded" && (
        <button type="button" disabled={busy} onClick={() => onRestore(entry)} aria-label={`Restore ${entry.label}`} className={button}>
          Restore
        </button>
      )}
      {entry.state === "changed" && (
        <button type="button" disabled={busy} onClick={() => onCopy(entry)} aria-label={`Copy ${entry.label} to a new file`} className={button}>
          Copy to a new file
        </button>
      )}
    </li>
  );
};

export interface StagingInspectorProps {
  id: string;
  staging: Staging;
  /** The selected worktree's name, as the Rail shows it. */
  worktreeName: string;
  width: number;
  onWidth: (width: number) => void;
  /** Flat or tree. It outlives the inspector, so Topos keeps it with the other prefs (#384). */
  listMode: ListMode;
  onListMode: (mode: ListMode) => void;
  onClose: () => void;
  /** The file whose diff is open, if any. */
  openFile: OpenFile | null;
  onOpenFile: (file: OpenFile) => void;
  /** The commit composer pinned at the bottom (#388). */
  commit: Commit;
  /** The operation under way, whose conflicts top the inspector (#389), or null until it is read. */
  conflicts: OpState | null;
  /** Moves focus to the operation banner's Continue. */
  onGoToContinue: () => void;
  /** Opens a conflicted file in the three-pane resolver (#390), or its side-picker card (#391). */
  onResolve: (path: string) => void;
  /** The conflicted files an agent holds (#392), and taking one back. */
  handOffs: Pick<HandToAgent, "held" | "takeBack">;
}

/** The most rows the Conflicts list renders; a note counts the rest. */
const CONFLICT_ROWS = 200;

interface ConflictListProps {
  op: OpState;
  busy: BusyOp | null;
  onStage: (path: string) => void;
  onResolve: (path: string) => void;
  /** The files an agent holds (#392), and taking one back. */
  handOffs: Pick<HandToAgent, "held" | "takeBack">;
}

/**
 * The inspector's Conflicts list (#366, #389), shown only while unmerged entries exist: each path
 * with what happened to it on each side, Resolve to open it in the three-pane resolver (#390), or
 * in a side-picker card when it can't be edited as text (#391), and Stage to mark it resolved once
 * its file is fixed. A file handed to an agent (#392) says which agent has it and offers Take back
 * in place of Stage.
 */
const ConflictList: React.FC<ConflictListProps> = ({ op, busy, onStage, onResolve, handOffs }) => {
  const headingId = useId();
  const shown = op.conflicts.slice(0, CONFLICT_ROWS);
  const more = op.conflictsTotal - shown.length;
  return (
    <section aria-labelledby={headingId} className="shrink-0 flex flex-col max-h-[40%] min-h-0">
      <div className="h-8 px-3 shrink-0 flex items-center gap-2 border-y border-[#30363d] bg-[#161b22]">
        <h4 id={headingId} className="text-[11px] font-semibold uppercase tracking-wide text-[#ff7b72]">
          Conflicts
          <span className="ml-1.5 normal-case font-normal tabular-nums">{op.conflictsTotal.toLocaleString()}</span>
        </h4>
      </div>
      <ul className="overflow-y-auto min-h-0 py-0.5">
        {shown.map((c) => {
          const held = handOffs.held.get(c.path);
          return (
          <li key={c.path} className="h-7 px-3 flex items-center gap-2 text-xs">
            <span className="w-5 shrink-0 font-mono text-[11px] text-[#f85149]" aria-hidden="true">
              {c.xy}
            </span>
            <span className="flex-1 min-w-0 truncate text-[#c9d1d9]" title={`${c.path}: ${CONFLICT_WORDS[c.kind]}`}>
              {c.path}
              <span className="sr-only">, {CONFLICT_WORDS[c.kind]}</span>
            </span>
            <HeldBadge held={held} />
            <button
              type="button"
              onClick={() => onResolve(c.path)}
              aria-label={`Resolve ${c.path}`}
              className="shrink-0 px-1.5 rounded border border-[#06B6D4]/50 text-[11px] text-[#c9d1d9] hover:bg-[#06B6D4]/15"
            >
              Resolve
            </button>
            {held ? (
              <button
                type="button"
                onClick={() => handOffs.takeBack(c.path)}
                aria-label={`Take ${c.path} back from ${held.agentName}`}
                className="shrink-0 px-1.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d]"
              >
                Take back
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onStage(c.path)}
                aria-label={`Stage ${c.path} to mark it resolved`}
                className="shrink-0 px-1.5 rounded border border-[#30363d] text-[11px] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50"
              >
                Stage
              </button>
            )}
          </li>
          );
        })}
      </ul>
      {more > 0 && <p className="px-3 py-1 text-[11px] text-[#8b949e]">and {more.toLocaleString()} more conflicted files</p>}
    </section>
  );
};

/**
 * The staging inspector (#366, #382): a right-hand column, resizable from its left edge, holding
 * Conflicts while any remain (#389), Unstaged with Stage all, and Staged with Unstage all, with the
 * commit composer pinned at the bottom. Lists are flat by default with a tree
 * toggle. Every result comes from git's answer, never from a guess, and every action is announced
 * in a live region.
 */
export const StagingInspector: React.FC<StagingInspectorProps> = ({
  id,
  staging,
  worktreeName,
  width,
  onWidth,
  listMode: mode,
  onListMode: setMode,
  onClose,
  openFile,
  onOpenFile,
  commit,
  conflicts,
  onGoToContinue,
  onResolve,
  handOffs,
}) => {
  const titleId = useId();
  const hintId = useId();
  const [collapsed, setCollapsed] = useState<Record<Side, ReadonlySet<string>>>({ unstaged: new Set(), staged: new Set() });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const { status, busy, failure, announce, run, folders, toggleFolder, discard, discards, undo, dismissUndo, restore, copyDiscard } = staging;
  const [showDiscards, setShowDiscards] = useState(false);
  const discardsId = useId();

  // While the Conflicts list shows, unmerged paths are listed there rather than in Unstaged.
  const showConflicts = conflicts !== null && conflicts.conflictsTotal > 0;
  const lists = useMemo(() => {
    if (status.state !== "done") return null;
    const split = splitStatus(status.status.entries);
    return showConflicts ? { ...split, unstaged: split.unstaged.filter((c) => c.kind !== "unmerged") } : split;
  }, [status, showConflicts]);
  const unstagedRows = useMemo(
    () => (lists ? listRows(lists.unstaged, { mode, collapsed: collapsed.unstaged, folders }) : []),
    [lists, mode, collapsed.unstaged, folders]
  );
  const stagedRows = useMemo(
    () => (lists ? listRows(lists.staged, { mode, collapsed: collapsed.staged, folders: new Map() }) : []),
    [lists, mode, collapsed.staged]
  );

  // A failed read or write is announced as it lands; `useStaging` announces finished writes itself.
  const readFailure = status.state === "failed" ? status.message : null;
  useEffect(() => {
    if (readFailure !== null) announce(`Couldn't read the changes: ${readFailure}`);
  }, [readFailure, announce]);

  const onOpen = (side: Side) => (row: ListRow) => {
    if (row.type === "dir") {
      const next = new Set(collapsed[side]);
      const closing = !next.has(row.path);
      if (closing) next.add(row.path);
      else next.delete(row.path);
      setCollapsed({ ...collapsed, [side]: next });
      announce(`${closing ? "Collapsed" : "Expanded"} ${row.path}/`);
    } else if (row.change?.kind === "untrackedFolder") {
      toggleFolder(row.path);
    }
  };
  const act = (side: Side) => (row: ListRow) => {
    const target = rowTarget(row);
    if (target) run(SIDE[side].action, target);
  };

  // The ignorable folder is the one the operator last pointed at in Unstaged.
  const [ignorable, setIgnorable] = useState<string | null>(null);
  const folderRows = unstagedRows.filter((r) => r.change?.kind === "untrackedFolder");
  const ignoreFolder = ignorable !== null && folderRows.some((r) => r.path === ignorable) ? ignorable : (folderRows[0]?.path ?? null);
  const askIgnore = (folder: string) =>
    setConfirm({
      title: `Add ${folder}/ to .gitignore?`,
      detail: `Quay appends /${folder}/ to this worktree's .gitignore, so git stops listing the folder. Edit .gitignore to undo it.`,
      confirmLabel: "Add to .gitignore",
      onConfirm: () => run("ignore", { kind: "paths", paths: [folder] }),
    });

  const askDiscard = (row: ListRow) => {
    const kind = row.change?.kind ?? "tracked";
    const target = { kind: "paths" as const, paths: [row.path] };
    setConfirm({ ...confirmDiscardFile(row.path, kind), onConfirm: () => discard(target, targetLabel(target, kind)) });
  };
  const askDiscardAll = () => {
    if (status.state !== "done") return;
    setConfirm({
      ...confirmDiscardAll(status.status),
      onConfirm: (includeUntracked) => {
        const target = { kind: "all" as const, includeUntracked };
        discard(target, targetLabel(target));
      },
    });
  };

  const isBusy = (action: BusyOp["action"]) => busy !== null && busy.action === action && busy.target.kind === "all";
  const note = status.state === "done" ? capNote(status.status) : null;

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = inspectorWidthByKey(width, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    onWidth(next);
  };

  const sectionHeader = (side: Side, count: number) => {
    const { heading, action: all, allLabel, allBusy, allClass } = SIDE[side];
    const busyAll = isBusy(all);
    return (
      <div className="h-8 px-3 shrink-0 flex items-center gap-2 border-y border-[#30363d] bg-[#161b22]">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8b949e]">
          {heading}
          <span className="ml-1.5 normal-case font-normal tabular-nums">{count.toLocaleString()}</span>
        </h4>
        {side === "unstaged" && (
          <DiscardButton
            busy={isBusy("discard")}
            disabled={busy !== null || count === 0}
            onClick={askDiscardAll}
            title="Discard every unstaged change, after a backup"
            className="ml-auto px-1.5 text-[11px] shrink-0"
          >
            {isBusy("discard") ? "Discarding…" : "Discard all"}
          </DiscardButton>
        )}
        {side === "unstaged" && ignoreFolder !== null && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => askIgnore(ignoreFolder)}
            title={`Add ${ignoreFolder}/ to .gitignore`}
            className="inline-flex items-center gap-1 min-w-0 max-w-[35%] px-1.5 py-0.5 rounded border border-[#30363d] text-[11px] text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-50"
          >
            <EyeOff className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Ignore {ignoreFolder}/</span>
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null || count === 0}
          aria-busy={busyAll}
          onClick={() => run(all, { kind: "all" })}
          className={`${side === "unstaged" ? "" : "ml-auto "}inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 ${allClass} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {busyAll && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
          {busyAll ? allBusy : allLabel}
        </button>
      </div>
    );
  };

  return (
    <aside id={id} aria-labelledby={titleId} className="relative shrink-0 flex flex-col min-h-0 border-l border-[#30363d] bg-[#0d1117]" style={{ width }}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow) */}
      <div role="separator" tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize staging inspector"
        aria-valuenow={width}
        aria-valuemin={MIN_INSPECTOR_WIDTH}
        aria-valuemax={MAX_INSPECTOR_WIDTH}
        aria-valuetext={`${width} px`}
        title="Drag, or use the arrow keys, to resize the inspector"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { pointerId: e.pointerId, x: e.clientX, width };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && d.pointerId === e.pointerId) onWidth(clampInspectorWidth(d.width - (e.clientX - d.x)));
        }}
        onPointerUp={(e) => {
          if (drag.current?.pointerId === e.pointerId) drag.current = null;
        }}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onHandleKeyDown}
        className="group/handle absolute top-0 bottom-0 left-0 z-20 w-[9px] -ml-[5px] cursor-col-resize flex justify-center outline-none touch-none"
      >
        <div className="w-px h-full group-hover/handle:bg-[#58a6ff] group-focus-visible/handle:w-[2px] group-focus-visible/handle:bg-[#58a6ff]" />
      </div>
      <header className="h-9 px-3 shrink-0 flex items-center gap-2">
        <h3 id={titleId} className="text-xs font-semibold text-white truncate min-w-0" title={worktreeName}>
          Changes · {worktreeName}
        </h3>
        <button
          type="button"
          aria-pressed={mode === "tree"}
          onClick={() => {
            const next = mode === "tree" ? "flat" : "tree";
            setMode(next);
            announce(next === "tree" ? "Showing changes as a tree" : "Showing changes as a flat list");
          }}
          title="Show changes as a folder tree"
          className={`ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] shrink-0 ${
            mode === "tree" ? "border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white" : "border-[#30363d] text-[#8b949e] hover:text-white"
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" aria-hidden="true" />
          Tree
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close staging inspector"
          className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </header>
      <p id={hintId} className="sr-only">
        Up and Down move, Enter opens a file's diff or a folder, S stages and U unstages the selected change. Tab moves between the lists.
      </p>
      {note && (
        <p role="status" className="px-3 py-1 text-[11px] text-[#d29922] bg-[#d29922]/10 border-t border-[#d29922]/30">
          {note}. Stage all and Unstage all still act on every change.
        </p>
      )}
      {failure && (
        <div role="alert" className="px-3 py-2 flex items-start gap-2 text-[11px] text-[#ff7b72] bg-[#f85149]/10 border-t border-[#f85149]/30">
          <span className="flex-1 min-w-0 break-words">{failure.message}</span>
          {failure.retry && (
            <button
              type="button"
              onClick={failure.retry}
              disabled={busy !== null}
              className="shrink-0 inline-flex items-center gap-1 px-1.5 rounded border border-[#f85149]/40 hover:bg-[#f85149]/20 disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      )}
      {status.state === "idle" ? (
        <p role="status" className="px-3 py-2 text-xs text-[#8b949e]">
          Reading changes…
        </p>
      ) : status.state === "failed" ? (
        <div className="px-3 py-2 text-xs text-[#ff7b72] flex items-start gap-2">
          <span className="flex-1 min-w-0 break-words">Couldn't read the changes: {status.message}</span>
          <button
            type="button"
            onClick={() => void staging.reload()}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {showConflicts && (
            <ConflictList
              op={conflicts}
              busy={busy}
              onStage={(path) => run("stage", { kind: "paths", paths: [path] })}
              onResolve={onResolve}
              handOffs={handOffs}
            />
          )}
          {sectionHeader("unstaged", lists?.unstaged.length ?? 0)}
          <ChangeList
            side="unstaged"
            rows={unstagedRows}
            busy={busy}
            onAct={act("unstaged")}
            onDiscard={askDiscard}
            onOpen={onOpen("unstaged")}
            announce={announce}
            hintId={hintId}
            onActive={(row) => row.change?.kind === "untrackedFolder" && setIgnorable(row.path)}
            onOpenFile={(row) => onOpenFile({ path: row.path, side: "unstaged" })}
            openPath={openFile?.side === "unstaged" ? openFile.path : null}
          />
          {sectionHeader("staged", lists?.staged.length ?? 0)}
          <ChangeList
            side="staged"
            rows={stagedRows}
            busy={busy}
            onAct={act("staged")}
            onOpen={onOpen("staged")}
            announce={announce}
            hintId={hintId}
            onOpenFile={(row) => onOpenFile({ path: row.path, side: "staged" })}
            openPath={openFile?.side === "staged" ? openFile.path : null}
          />
        </div>
      )}
      {discards.length > 0 && (
        <section aria-label="Recently discarded" className="shrink-0 border-t border-[#30363d]">
          <h4>
            <button
              type="button"
              aria-expanded={showDiscards}
              aria-controls={discardsId}
              onClick={() => setShowDiscards(!showDiscards)}
              className="w-full h-8 px-3 flex items-center gap-1.5 bg-[#161b22] text-[11px] font-semibold uppercase tracking-wide text-[#8b949e] hover:text-white"
            >
              {showDiscards ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
              Recently discarded
              <span className="ml-1 normal-case font-normal tabular-nums">{discards.length.toLocaleString()}</span>
            </button>
          </h4>
          {showDiscards && (
            <ul id={discardsId} className="max-h-48 overflow-y-auto py-1">
              {discards.map((entry) => (
                <DiscardRow key={entry.id} entry={entry} busy={busy !== null} onRestore={restore} onCopy={copyDiscard} />
              ))}
            </ul>
          )}
        </section>
      )}
      <CommitComposer commit={commit} stagingBusy={busy !== null && busy.action !== "commit"} onGoToContinue={onGoToContinue} />
      {undo && (
        <div role="status" className="absolute left-3 right-3 bottom-3 z-30 flex items-center gap-2 px-3 py-2 rounded-md border border-[#30363d] bg-[#161b22] shadow-lg text-xs">
          <span className="flex-1 min-w-0 truncate text-[#c9d1d9]" title={undo.label}>
            Discarded {undo.label}
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => restore(undo)}
            className="shrink-0 px-2 py-0.5 rounded border border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white hover:bg-[#06B6D4]/20 disabled:opacity-50"
          >
            Undo
          </button>
          <button type="button" onClick={dismissUndo} aria-label="Dismiss" className="shrink-0 p-0.5 rounded text-[#8b949e] hover:text-white">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />
    </aside>
  );
};
