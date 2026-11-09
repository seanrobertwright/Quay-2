import { useEffect, useId, useMemo, useState, type FC } from "react";
import { BellRing, Check, SquareTerminal, X } from "lucide-react";
import { useOverlay } from "../overlay/useOverlay.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { worktreeRowName } from "../rail/worktreeMenu.ts";
import { isSamePath } from "../../utils/paths.ts";
import { attentionItemKey, waitedLabel, type AttentionItem } from "./attentionQueue.ts";
import type { AnswerPermission } from "./useAttentionQueue.ts";

/** How often the open drawer refreshes each row's wait time. */
const WAIT_TICK_MS = 1000;

interface AttentionDrawerProps {
  isOpen: boolean;
  /** The waiting items, oldest first, as the queue orders them. */
  items: AttentionItem[];
  terminals: TerminalInfo[];
  projects: Project[];
  projectWorktrees: Record<string, GitWorktree[]>;
  onClose: () => void;
  /** Focuses the terminal, switching to its project or worktree when it is in another. */
  onFocusTerminal: (terminalId: string) => void;
  onDismissFinishedTurn: (terminalId: string) => void;
  /** Answers a permission request, the same way the permission modal does. */
  onAnswerPermission: AnswerPermission;
  /** Shows a request deferred with Later in the permission modal again, on that request. */
  onReopenPermission: (requestId: string) => void;
}

/** The last segment of `path`, or the path itself when it has none. */
const baseName = (path: string) => path.split(/[/\\]/).filter(Boolean).pop() ?? path;

/**
 * Names the project at `path`: a project's name, a worktree as "project › " followed by the name its
 * Rail row shows, or the folder name for a path the Rail does not list.
 */
function projectLabel(
  path: string | null,
  projects: Project[],
  projectWorktrees: Record<string, GitWorktree[]>
): string {
  if (!path) return "Unknown project";
  for (const project of projects) {
    if (isSamePath(project.path, path)) return project.name;
    const worktree = projectWorktrees[project.path]?.find((wt) => isSamePath(wt.path, path));
    if (worktree) return `${project.name} › ${worktreeRowName(worktree)}`;
  }
  return baseName(path);
}

const kindLabel = (item: AttentionItem) => {
  if (item.kind === "finishedTurn") return "Finished turn";
  return item.deferred ? `Permission request: ${item.tool}, deferred` : `Permission request: ${item.tool}`;
};

/**
 * The attention queue's drawer: every session waiting on the user, oldest first, across all
 * projects. A row focuses its terminal; a permission row is allowed or denied in place, and a
 * request deferred with Later reopens in the permission modal from its row; a finished-turn row
 * can be dismissed. Focusing sends the queue no event, so the focused terminal's row stays until
 * the queue itself clears it.
 */
export const AttentionDrawer: FC<AttentionDrawerProps> = ({
  isOpen,
  items,
  terminals,
  projects,
  projectWorktrees,
  onClose,
  onFocusTerminal,
  onDismissFinishedTurn,
  onAnswerPermission,
  onReopenPermission,
}) => {
  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose });
  const [now, setNow] = useState(() => Date.now());
  const terminalsById = useMemo(() => new Map(terminals.map((t) => [t.id, t])), [terminals]);

  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), WAIT_TICK_MS);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
    >
      <div
        {...panelProps}
        aria-label="Waiting on you"
        className="focus:outline-hidden w-full max-w-md bg-[#0d1117] border-l border-[#30363d] shadow-2xl flex flex-col h-full"
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-[#30363d] flex items-center justify-between bg-[#161b22] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-md bg-[#1f6feb]/15 text-[#58a6ff] border border-[#1f6feb]/30">
              <BellRing className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-white">Waiting on you</h2>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#21262d] text-[#8b949e] font-mono">
              {items.length} waiting
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rows, oldest first */}
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8b949e]">
              <p className="text-sm text-[#c9d1d9] font-semibold">Nothing is waiting on you</p>
              <p className="mt-1">Permission requests and finished turns show here, oldest first.</p>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Sessions waiting on you, oldest first">
              {items.map((item) => {
                const terminal = item.terminalId ? terminalsById.get(item.terminalId) : undefined;
                return (
                  <AttentionRow
                    key={attentionItemKey(item)}
                    item={item}
                    terminalName={terminal?.name ?? null}
                    project={projectLabel(item.project ?? terminal?.project_path ?? null, projects, projectWorktrees)}
                    waited={waitedLabel(item.waitingSince, now)}
                    onFocusTerminal={onFocusTerminal}
                    onDismissFinishedTurn={onDismissFinishedTurn}
                    onAnswerPermission={onAnswerPermission}
                    onReopenPermission={onReopenPermission}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

interface AttentionRowProps {
  item: AttentionItem;
  /** The terminal's name, or null when the app does not know the terminal. */
  terminalName: string | null;
  project: string;
  waited: string;
  onFocusTerminal: (terminalId: string) => void;
  onDismissFinishedTurn: (terminalId: string) => void;
  onAnswerPermission: AnswerPermission;
  onReopenPermission: (requestId: string) => void;
}

/**
 * One waiting item. Its main button focuses its terminal, or, for a request deferred with Later,
 * reopens the permission modal on it; a deferred request's row then has its own button to focus
 * the terminal. A permission row answers its request with Allow and Deny, and a finished-turn
 * row can be dismissed.
 */
const AttentionRow: FC<AttentionRowProps> = ({
  item,
  terminalName,
  project,
  waited,
  onFocusTerminal,
  onDismissFinishedTurn,
  onAnswerPermission,
  onReopenPermission,
}) => {
  const detailId = useId();
  const terminalId = item.terminalId;
  const name = terminalName ?? (terminalId ? "Unknown terminal" : "No terminal");
  const deferred = item.kind === "permission" && item.deferred;
  const focusTitle = terminalId ? `Focus ${name}` : "This request names no terminal";

  return (
    <li className="flex items-stretch gap-1 rounded-lg bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff]/50 transition-colors">
      <button
        type="button"
        disabled={!deferred && !terminalId}
        onClick={() => {
          if (item.kind === "permission" && item.deferred) onReopenPermission(item.requestId);
          else if (terminalId) onFocusTerminal(terminalId);
        }}
        className="flex-1 min-w-0 text-left px-3 py-2 rounded-lg cursor-pointer disabled:cursor-default focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
        title={deferred ? "Reopen this request" : focusTitle}
        aria-label={item.kind === "permission" && item.deferred ? `Reopen ${name}'s ${item.tool} request` : undefined}
        aria-describedby={deferred ? detailId : undefined}
      >
        <span className="block text-xs font-semibold text-white truncate">{name}</span>
        <span id={detailId} className="block mt-0.5 text-[11px] text-[#8b949e] truncate">
          <span className="font-mono text-[#58a6ff]">{project}</span>
          <span aria-hidden="true"> • </span>
          <span className={item.kind === "permission" ? "text-[#e3b341]" : "text-[#3fb950]"}>
            {kindLabel(item)}
          </span>
          <span aria-hidden="true"> • </span>
          <span>waited {waited}</span>
        </span>
      </button>
      {item.kind === "permission" && (
        <div className="shrink-0 flex items-center gap-1 pr-2">
          {deferred && terminalId && (
            <button
              type="button"
              onClick={() => onFocusTerminal(terminalId)}
              className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
              title={focusTitle}
              aria-label={focusTitle}
            >
              <SquareTerminal className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onAnswerPermission(item.requestId, "allow")}
            className="flex items-center gap-1 px-2 py-1 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md text-[11px] font-semibold transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
            aria-label={`Allow ${item.tool} for ${name}`}
            aria-describedby={detailId}
          >
            <Check className="w-3 h-3" aria-hidden="true" />
            <span>Allow</span>
          </button>
          <button
            type="button"
            onClick={() => onAnswerPermission(item.requestId, "deny")}
            className="flex items-center gap-1 px-2 py-1 bg-[#da3633] hover:bg-[#f85149] text-white rounded-md text-[11px] font-semibold transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
            aria-label={`Deny ${item.tool} for ${name}`}
            aria-describedby={detailId}
          >
            <X className="w-3 h-3" aria-hidden="true" />
            <span>Deny</span>
          </button>
        </div>
      )}
      {item.kind === "finishedTurn" && (
        <button
          type="button"
          onClick={() => onDismissFinishedTurn(item.terminalId)}
          className="shrink-0 px-2 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-r-lg transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
          title="Dismiss"
          aria-label={`Dismiss ${name}'s finished turn`}
          aria-describedby={detailId}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
};
