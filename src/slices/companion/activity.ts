import type { Envelope } from "../bridge/useBridgeEvents.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { TrailStatus } from "../orchestrator/trailEntry.ts";

/** The most entries the Activity view shows: the newest ones. */
export const ACTIVITY_LIMIT = 200;

/** One tool call the terminal's agent made: its started and finished events as one entry. */
export interface ToolCallEntry {
  kind: "tool";
  /** `tool:` and the call's tool use id, or the event's sequence number when it has none. */
  id: string;
  /** When the call started (or, when only its finish was heard, finished), in epoch ms. */
  at: number;
  tool: string;
  /** What the call worked on, on one line: its command, file, URL or arguments. */
  summary: string;
  /** What the call printed, once it finished; null while it runs. */
  output: string | null;
  status: "running" | "ok" | "error";
}

/** One message on the A2A trail the terminal sent or got, with the reply it drew. */
export interface MessageEntry {
  kind: "message";
  /** `message:` and the trail message's id. */
  id: string;
  /** When the message was sent, in epoch ms. */
  at: number;
  /** Received when the message was sent to the terminal; sent when the terminal sent it. */
  direction: "received" | "sent";
  /** Who sent a received message, or whom a sent one went to. */
  peer: string;
  content: string;
  /** The reply or answer, once one came; null until then. */
  reply: string | null;
  status: TrailStatus;
}

export type ActivityEntry = ToolCallEntry | MessageEntry;

/** The Activity entry id of trail message `messageId`, for a request to show that message. */
export const messageEntryId = (messageId: string) => `message:${messageId}`;

/** What a tool call's arguments name, on one line: a command, a file, a URL, else the arguments. */
export function toolInputSummary(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const fields = input as Record<string, unknown>;
    for (const key of ["command", "file_path", "path", "url", "pattern"]) {
      if (typeof fields[key] === "string") return fields[key];
    }
    return JSON.stringify(input);
  }
  return "";
}

/** What a finished call printed: the bridge's `text`, else an `output` or `result` field. */
function outputOf(data: Record<string, unknown>): string {
  for (const key of ["text", "output", "result"]) {
    const value = data[key];
    if (typeof value === "string") return value;
    if (value !== undefined && value !== null) return JSON.stringify(value);
  }
  return "";
}

/**
 * The terminal's activity, oldest first: each tool call its agent made, its `tool.started` and
 * `tool.finished` paired by tool use id, merged with each trail message sent to it or from it.
 * `events` may come in any order (the bridge hands them newest first). At most `limit` entries,
 * the newest, are kept.
 */
export function activityEntries(
  terminalId: string,
  events: readonly Envelope[],
  messages: readonly TrailMessage[],
  limit = ACTIVITY_LIMIT,
): ActivityEntry[] {
  const calls = new Map<string, ToolCallEntry>();
  const ordered = events
    .filter((e) => e.tag === terminalId && (e.type === "tool.started" || e.type === "tool.finished"))
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  for (const e of ordered) {
    const data = (e.data ?? {}) as Record<string, unknown>;
    const useId = typeof data.toolUseId === "string" ? data.toolUseId : `seq-${e.seq}`;
    const id = `tool:${useId}`;
    const known = calls.get(id);
    const tool = typeof data.tool === "string" ? data.tool : (known?.tool ?? "Tool");
    const summary = known?.summary || toolInputSummary(data.input);
    if (e.type === "tool.started") {
      if (!known) calls.set(id, { kind: "tool", id, at: e.ts, tool, summary, output: null, status: "running" });
      continue;
    }
    const failed = data.status !== undefined && data.status !== "ok";
    calls.set(id, {
      kind: "tool",
      id,
      at: known?.at ?? e.ts,
      tool,
      summary,
      output: outputOf(data),
      status: failed ? "error" : "ok",
    });
  }

  const trail: MessageEntry[] = [];
  for (const m of messages) {
    const received = m.to_terminal === terminalId;
    if (!received && m.from_terminal !== terminalId) continue;
    trail.push({
      kind: "message",
      id: messageEntryId(m.id),
      at: m.timestamp,
      direction: received ? "received" : "sent",
      peer: (received ? m.from_name : m.to_name) || (received ? m.from_terminal : m.to_terminal),
      content: m.content,
      reply: m.response ?? null,
      status: m.status,
    });
  }

  const entries: ActivityEntry[] = [...calls.values(), ...trail].sort((a, b) => a.at - b.at);
  return entries.slice(Math.max(0, entries.length - limit));
}
