import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import type { TerminalInfo } from "../terminal/types.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { SwarmPreset } from "../orchestrator/swarmTypes.ts";
import type { ClaudeSessionSummary } from "../sessions/types.ts";
import { attentionItemKey, waitedLabel, type AttentionItem } from "../attention/attentionQueue.ts";
import { lookOf } from "../surface/looks/index.ts";
import { waitingTerminals, DOT_STATUS_LABELS } from "../shell/terminalStatus.ts";
import { formatRelative } from "../../lib/dates.ts";
import { agentRows, SESSIONS_SHOWN, sessionMatches, shownSavedSwarms, WAITING_ROWS_SHOWN } from "./agentRows.ts";

/** A Waiting on you row's height, in CSS px. */
const WAITING_ROW_HEIGHT = 40;

/** A request to show Session history, such as `Ctrl+Shift+B h`; each new `seq` is a new request. */
export interface SessionHistoryRequest {
  seq: number;
}

interface AgentsPanelProps {
  /** Whether the panel shows, so Session history loads when it opens. */
  isOpen: boolean;
  /** The active project, whose agents and sessions the panel lists. */
  project: string;
  terminals: readonly TerminalInfo[];
  /** The A2A trail, newest first. */
  messages: readonly TrailMessage[];
  /** Everything waiting on the operator, oldest first. */
  waiting: readonly AttentionItem[];
  /** How many of a terminal's older permission requests its cap dropped; absent shows none. */
  droppedPermissionCount?: (terminalId: string | null) => number;
  selectedTerminalId: string | null;
  sessionHistoryRequest: SessionHistoryRequest | null;
  onSelectTerminal: (terminalId: string) => void;
  /** Opens a waiting item: its terminal, a permission request in the companion's Activity view and a surface in its Surface view or its stage tab. */
  onOpenWaiting: (item: AttentionItem) => void;
  /** Opens the message an agent's latest reply answered in the companion's Activity view. */
  onOpenReply: (terminalId: string, messageId: string) => void;
  savedSwarms: readonly SwarmPreset[];
  onLaunchSwarm: (preset: SwarmPreset) => void;
  /** Opens the swarm builder stage tab, with every preset. */
  onOpenSwarmBuilder: () => void;
  onResumeSession: (sessionId: string, projectPath: string) => void;
}

/**
 * The Agents panel, top to bottom: Waiting on you, agents in the project, saved swarms and session
 * history.
 */
export const AgentsPanel = (props: AgentsPanelProps) => {
  const { terminals, waiting, project, messages } = props;
  const nameOf = (terminalId: string | null) => terminals.find((t) => t.id === terminalId)?.name ?? "Unknown terminal";
  const agents = useMemo(
    () => agentRows(terminals, project, messages, waitingTerminals(waiting)),
    [terminals, project, messages, waiting],
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col select-none text-[#c9d1d9] text-xs">
      <h2 className="h-12 shrink-0 px-4 flex items-center border-b border-[#30363d] bg-[#161b22] text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
        Agents
      </h2>
      <Section title="Waiting on you">
        {waiting.length === 0 ? (
          <p className="px-4 py-2 text-[#8b949e]">Nothing is waiting on you</p>
        ) : (
          <WaitingRows
            waiting={waiting}
            droppedPermissionCount={props.droppedPermissionCount}
            onOpenWaiting={props.onOpenWaiting}
            nameOf={nameOf}
          />
        )}
      </Section>
      <Section title="Agents in the project">
        {agents.length === 0 ? (
          <p className="px-4 py-2 text-[#8b949e]">No agents in this project.</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto px-2 pb-2 space-y-0.5">
            {agents.map((row) => (
              <li
                key={row.terminal.id}
                className={`rounded-md ${row.terminal.id === props.selectedTerminalId ? "bg-[#161b22] shadow-[inset_2px_0_0_#58a6ff]" : ""}`}
              >
                <button
                  type="button"
                  aria-label={`Select ${row.terminal.name}`}
                  onClick={() => props.onSelectTerminal(row.terminal.id)}
                  className="w-full min-h-8 px-2 flex items-center gap-2 rounded-md text-left hover:bg-[#161b22]"
                >
                  <span className="min-w-0 flex-1 truncate text-white">{row.terminal.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[#8b949e]">{row.role}</span>
                  <span className="shrink-0 text-[10px]">{DOT_STATUS_LABELS[row.status]}</span>
                </button>
                {row.preview && (
                  <button
                    type="button"
                    aria-label={`Open ${row.terminal.name}'s latest reply in Activity`}
                    title={row.preview.text}
                    onClick={() => props.onOpenReply(row.terminal.id, row.preview!.messageId)}
                    className="w-full min-h-6 px-2 pb-1 block truncate rounded-md text-left text-[11px] text-[#8b949e] hover:text-white hover:bg-[#161b22]"
                  >
                    {row.preview.text}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Saved swarms">
        {props.savedSwarms.length === 0 ? (
          <p className="px-4 py-1 text-[#8b949e]">No saved swarms yet.</p>
        ) : (
          <ul className="px-2 space-y-0.5">
            {shownSavedSwarms(props.savedSwarms).map((preset) => (
              <li key={preset.id} className="flex items-center gap-2 px-2 min-h-8">
                <span className="min-w-0 flex-1 truncate">{preset.title}</span>
                <span className="shrink-0 text-[10px] text-[#8b949e]">{preset.agents.length} agents</span>
                <button
                  type="button"
                  aria-label={`Launch ${preset.title}`}
                  title={`Launch ${preset.title}`}
                  onClick={() => props.onLaunchSwarm(preset)}
                  className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-[#3fb950] hover:bg-[#21262d]"
                >
                  <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={props.onOpenSwarmBuilder}
          className="mx-4 mb-2 min-h-6 text-left text-[11px] text-[#58a6ff] hover:underline"
        >
          All presets and the builder
        </button>
      </Section>
      <SessionHistory
        isOpen={props.isOpen}
        project={project}
        sessionHistoryRequest={props.sessionHistoryRequest}
        onResumeSession={props.onResumeSession}
      />
    </div>
  );
};

const Section = ({ title, children, grow = false }: { title: string; children: ReactNode; grow?: boolean }) => (
  <section aria-label={title} className={`${grow ? "flex-1 min-h-0" : "shrink-0"} flex flex-col border-b border-[#30363d]`}>
    <h3 className="shrink-0 px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]">{title}</h3>
    {children}
  </section>
);

/** What a waiting item is, in Quay's words. */
function whatWaits(item: AttentionItem): string {
  switch (item.kind) {
    case "permission":
      return `${item.tool} permission request`;
    case "finishedTurn":
      return "finished its turn";
    case "surface":
      return `${lookOf(item.tool).kind.toLowerCase()} for you`;
  }
}

/** Waiting on you: one row per waiting item, oldest first; five show, then the list scrolls. */
const WaitingRows = ({
  waiting,
  droppedPermissionCount,
  onOpenWaiting,
  nameOf,
}: Pick<AgentsPanelProps, "waiting" | "droppedPermissionCount" | "onOpenWaiting"> & {
  nameOf: (terminalId: string | null) => string;
}) => {
  const now = Date.now();
  // A terminal's dropped count sits on its oldest permission row, once.
  const counted = new Set<string | null>();
  return (
    <ul
      style={{ maxHeight: WAITING_ROWS_SHOWN * WAITING_ROW_HEIGHT, overflowY: "auto" }}
      className="px-2 pb-2"
    >
      {waiting.map((item) => {
        const name = nameOf(item.terminalId);
        const what = whatWaits(item);
        let dropped = 0;
        if (item.kind === "permission" && !counted.has(item.terminalId)) {
          counted.add(item.terminalId);
          dropped = droppedPermissionCount?.(item.terminalId) ?? 0;
        }
        return (
          <li key={attentionItemKey(item)} style={{ height: WAITING_ROW_HEIGHT }}>
            <button
              type="button"
              aria-label={`${name}: ${what}`}
              onClick={() => onOpenWaiting(item)}
              className="w-full h-full px-2 flex items-center gap-2 rounded-md text-left hover:bg-[#161b22]"
            >
              <span aria-hidden="true" className="shrink-0 w-2 h-2 rounded-full bg-[#d29922] shadow-[0_0_0_3px_#d2992233]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-white">{name}</span>
                <span className="block truncate text-[11px] text-[#8b949e]">
                  {what}
                  {dropped > 0 && ` · +${dropped} older not shown`}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[#8b949e]">{waitedLabel(item.waitingSince, now)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/** Session history: the project's Claude sessions, newest first, with a search and Resume. */
const SessionHistory = ({
  isOpen,
  project,
  sessionHistoryRequest,
  onResumeSession,
}: Pick<AgentsPanelProps, "isOpen" | "project" | "sessionHistoryRequest" | "onResumeSession">) => {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    invoke<ClaudeSessionSummary[]>("list_claude_sessions", { projectPath: project || null, limit: SESSIONS_SHOWN })
      .then((list) => {
        if (!current) return;
        setSessions(list ?? []);
        setError(null);
      })
      .catch((err) => {
        if (current) setError(String(err));
      });
    return () => {
      current = false;
    };
  }, [isOpen, project]);
  useEffect(() => {
    if (sessionHistoryRequest) searchRef.current?.focus();
  }, [sessionHistoryRequest]);
  const shown = sessionMatches(sessions, query);
  return (
    <Section title="Session history" grow>
      <div className="shrink-0 px-3 pb-1.5">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search sessions"
          placeholder="Search sessions"
          className="w-full h-7 px-2 rounded-md border border-[#30363d] bg-[#0d1117] text-xs text-white placeholder-[#8b949e] focus:border-(--quay-accent) focus:outline-hidden"
        />
      </div>
      {error && (
        <p role="alert" className="px-4 text-[11px] text-[#f85149]">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="px-4 py-1 text-[#8b949e]">{sessions.length === 0 ? "No sessions yet." : "No session matches."}</p>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
          {shown.map((s) => (
            <li key={s.session_id} className="flex items-center gap-2 px-2 min-h-10 rounded-md hover:bg-[#161b22]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-white" title={s.last_prompt}>
                  {s.last_prompt || s.session_id}
                </span>
                <span className="block text-[10px] text-[#8b949e]">
                  {formatRelative(s.timestamp_ms)} · {s.message_count} messages
                </span>
              </span>
              <button
                type="button"
                aria-label={`Resume session ${s.last_prompt || s.session_id}`}
                onClick={() => onResumeSession(s.session_id, s.project_path)}
                className="shrink-0 h-7 px-2 rounded-md border border-[#30363d] bg-[#21262d] text-[11px] hover:bg-[#30363d]"
              >
                Resume
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
