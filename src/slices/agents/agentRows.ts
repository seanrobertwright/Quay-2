import { busLevel, type TerminalInfo } from "../terminal/types.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { ClaudeSessionSummary } from "../sessions/types.ts";
import { terminalDot, type DotStatus } from "../shell/terminalStatus.ts";
import { isSamePath } from "../../utils/paths.ts";

/** How many Waiting on you rows show before the section scrolls. */
export const WAITING_ROWS_SHOWN = 5;
/** The most saved swarms the panel lists; the rest are in the swarm builder. */
export const SAVED_SWARMS_SHOWN = 4;
/** The most sessions Session history lists. */
export const SESSIONS_SHOWN = 100;

/** The newest reply an agent gave on the A2A trail, on one line, and the message it answered. */
export interface ReplyPreview {
  messageId: string;
  text: string;
}

/** One row of Agents in the project. */
export interface AgentRow {
  terminal: TerminalInfo;
  /** The agent's CLI and its level on the A2A bus, such as `claude · full peer`. */
  role: string;
  status: DotStatus;
  /** Its latest reply, or null when it has given none. */
  preview: ReplyPreview | null;
}

/**
 * One row per agent terminal in `project`, in `terminals` order: every terminal on the A2A bus,
 * so not a plain shell or an Archon runner. A worktree is its own project, as on the stage.
 * `messages` is the trail, newest first. A terminal in `asking` has a permission request waiting,
 * so it shows as waiting, as its dot in the status list does.
 */
export function agentRows(
  terminals: readonly TerminalInfo[],
  project: string,
  messages: readonly TrailMessage[],
  asking: ReadonlySet<string> = new Set(),
): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const terminal of terminals) {
    const level = busLevel(terminal);
    if (level === null || !isSamePath(terminal.project_path, project)) continue;
    rows.push({ terminal, role: `${terminal.run_kind} · ${level}`, status: terminalDot(terminal, asking), preview: latestReply(terminal.id, messages) });
  }
  return rows;
}

/** The newest message to `terminalId` that drew a reply, with the reply on one line. */
function latestReply(terminalId: string, messages: readonly TrailMessage[]): ReplyPreview | null {
  let newest: TrailMessage | null = null;
  for (const m of messages) {
    if (m.to_terminal !== terminalId || !m.response?.trim()) continue;
    if (!newest || m.timestamp > newest.timestamp) newest = m;
  }
  return newest && { messageId: newest.id, text: newest.response!.replace(/\s+/g, " ").trim() };
}

/** The saved swarms the panel lists: the first {@link SAVED_SWARMS_SHOWN}. */
export function shownSavedSwarms<T>(saved: readonly T[]): T[] {
  return saved.slice(0, SAVED_SWARMS_SHOWN);
}

/**
 * The sessions Session history lists for the search `query`: those whose prompt, id or folder
 * holds it, ignoring case (all of them for a blank query), in `sessions` order, at most
 * {@link SESSIONS_SHOWN}.
 */
export function sessionMatches(sessions: readonly ClaudeSessionSummary[], query: string): ClaudeSessionSummary[] {
  const q = query.trim().toLowerCase();
  const matching = q
    ? sessions.filter(
        (s) => s.last_prompt.toLowerCase().includes(q) || s.session_id.toLowerCase().includes(q) || s.project_path.toLowerCase().includes(q),
      )
    : sessions;
  return matching.slice(0, SESSIONS_SHOWN);
}
