import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TerminalInfo } from "../terminal/types.ts";
import type { Envelope } from "../bridge/useBridgeEvents.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { AttentionItem, PermissionItem } from "../attention/attentionQueue.ts";
import type { AnswerPermission } from "../attention/useAttentionQueue.ts";
import { splitPermissionInput } from "../attention/permissionInput.ts";
import { formatClock } from "../../lib/dates.ts";
import { activityEntries, type ActivityEntry, type MessageEntry, type ToolCallEntry } from "./activity.ts";
import { PermissionInputBox } from "./PermissionInputBox.tsx";

/** What the Activity view reads: the bridge's events, the A2A trail and what waits on the operator. */
export interface CompanionActivity {
  /** Bridge events of every terminal, in any order. */
  events: readonly Envelope[];
  /** The A2A trail, newest first. */
  messages: readonly TrailMessage[];
  /** Everything waiting on the operator, oldest first, from the attention queue. */
  waiting: readonly AttentionItem[];
  answer: AnswerPermission;
}

/** The Activity entry a request asked to show, once per `seq`. */
export interface ActivityFocus {
  entryId: string;
  seq: number;
}

/** The trail's sender id for a message the operator sends. */
const OPERATOR = "user";

const BUTTON = "h-7 shrink-0 px-3 rounded-md border text-xs font-medium";

interface ActivityViewProps {
  terminal: TerminalInfo;
  activity: CompanionActivity;
  focus: ActivityFocus | null;
}

/**
 * The companion's Activity view for the selected terminal: its pending permission requests at the
 * top, each answered in place; its tool calls, with expandable output, merged with the messages it
 * sent and got; and a message strip at the foot that sends its agent a task.
 */
export const ActivityView = ({ terminal, activity, focus }: ActivityViewProps) => {
  const entries = useMemo(
    () => activityEntries(terminal.id, activity.events, activity.messages),
    [terminal.id, activity.events, activity.messages],
  );
  const permissions = activity.waiting.filter(
    (item): item is PermissionItem => item.kind === "permission" && item.terminalId === terminal.id,
  );
  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (!focus) return;
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [focus]);
  return (
    <div className="min-h-full flex flex-col">
      {permissions.length > 0 && (
        <div className="shrink-0 border-b border-[#30363d]">
          {permissions.map((permission) => (
            <PermissionRequest key={permission.requestId} permission={permission} onAnswer={activity.answer} />
          ))}
        </div>
      )}
      {entries.length === 0 ? (
        <p className="flex-1 p-4 text-xs text-[#8b949e]">{terminal.name} has no tool calls or messages yet.</p>
      ) : (
        <ol ref={listRef} aria-label="Activity" className="flex-1 p-2 space-y-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              aria-current={focus?.entryId === entry.id ? "true" : undefined}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${
                focus?.entryId === entry.id ? "border-[#58a6ff] bg-[#1f6feb1a]" : "border-[#30363d] bg-[#161b22]"
              }`}
            >
              <Entry entry={entry} />
            </li>
          ))}
        </ol>
      )}
      <MessageStrip terminal={terminal} />
    </div>
  );
};

const Entry = ({ entry }: { entry: ActivityEntry }) =>
  entry.kind === "tool" ? <ToolCall call={entry} /> : <Message message={entry} />;

const STATUS_TEXT: Record<ToolCallEntry["status"], { text: string; className: string }> = {
  running: { text: "running", className: "text-[#58a6ff]" },
  ok: { text: "done", className: "text-[#3fb950]" },
  error: { text: "failed", className: "text-[#f85149]" },
};

/** One tool call: its tool, what it worked on and its status, with its output behind a toggle. */
const ToolCall = ({ call }: { call: ToolCallEntry }) => {
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const status = STATUS_TEXT[call.status];
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 font-mono text-[10px] text-[#8b949e]">{formatClock(call.at)}</span>
        <b className="shrink-0 text-[#e3b341]">{call.tool}</b>
        <code className="min-w-0 flex-1 truncate text-[#c9d1d9]" title={call.summary}>
          {call.summary}
        </code>
        <span className={`shrink-0 ${status.className}`}>{status.text}</span>
        {call.output !== null && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={outputId}
            aria-label={`${open ? "Hide" : "Show"} output of ${call.tool} ${call.summary}`}
            onClick={() => setOpen((was) => !was)}
            className="shrink-0 min-w-6 h-6 px-1.5 rounded border border-[#30363d] text-[10px] text-[#8b949e] hover:text-white hover:bg-[#21262d]"
          >
            {open ? "Hide" : "Output"}
          </button>
        )}
      </div>
      {open && call.output !== null && (
        <pre id={outputId} className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-[#0d1117] p-2 font-mono text-[11px] text-[#c9d1d9]">
          {call.output || "(no output)"}
        </pre>
      )}
    </>
  );
};

/** One trail message the terminal got or sent, with the reply it drew. */
const Message = ({ message }: { message: MessageEntry }) => (
  <>
    <div className="flex items-center gap-2">
      <span className="shrink-0 font-mono text-[10px] text-[#8b949e]">{formatClock(message.at)}</span>
      <b className="text-[#bc8cff]">{message.direction === "received" ? `From ${message.peer}` : `To ${message.peer}`}</b>
      <span className="ml-auto text-[10px] text-[#8b949e]">{message.status}</span>
    </div>
    <p className="mt-1 whitespace-pre-wrap break-words text-[#c9d1d9]">{message.content}</p>
    {message.reply && (
      <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-[#3fb950] pl-2 text-[#c9d1d9]">
        <span className="sr-only">Reply: </span>
        {message.reply}
      </p>
    )}
  </>
);

/** A pending permission request: what it asks to do, the input its summary leaves out, and its three answers. */
const PermissionRequest = ({ permission, onAnswer }: { permission: PermissionItem; onAnswer: AnswerPermission }) => {
  const { summary, rest } = splitPermissionInput(permission.input);
  return (
    <section aria-label="Permission request" className="p-3 bg-[#d2992214] border-l-2 border-[#d29922] text-xs space-y-2">
      <p className="text-[#c9d1d9] break-words">
        <span className="text-[#e3b341] font-semibold">{permission.tool}</span>
        {summary && (
          <>
            {" "}
            <code>{summary}</code>
          </>
        )}
        {permission.reason && <span className="text-[#8b949e]"> · {permission.reason}</span>}
      </p>
      {rest.length > 0 && <PermissionInputBox tool={permission.tool} rest={rest} />}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onAnswer(permission.requestId, "allow", undefined, false)}
          className={`${BUTTON} border-[#2ea043] bg-[#238636] text-white hover:bg-[#2ea043]`}
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => void onAnswer(permission.requestId, "allow", undefined, true)}
          className={`${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]`}
        >
          Allow for session
        </button>
        <button
          type="button"
          onClick={() => void onAnswer(permission.requestId, "deny")}
          className={`${BUTTON} border-[#da3633] bg-[#da3633] text-white hover:bg-[#f85149]`}
        >
          Deny
        </button>
      </div>
    </section>
  );
};

/**
 * The strip at the view's foot that sends the terminal's agent a task over the A2A bus, as the
 * operator. Enter sends; Shift+Enter starts a new line.
 */
const MessageStrip = ({ terminal }: { terminal: TerminalInfo }) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exited = terminal.claude_status === "exited";
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const prompt = text.trim();
    if (!prompt || sending || exited) return;
    setSending(true);
    setError(null);
    try {
      await invoke("a2a_send_prompt", { request: { from_terminal: OPERATOR, to_terminal: terminal.id, prompt, as_user: true } });
      setText("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  return (
    <form onSubmit={send} className="sticky bottom-0 shrink-0 border-t border-[#30363d] bg-[#161b22] p-2 space-y-1.5">
      {error && (
        <p role="alert" className="text-[11px] text-[#f85149]">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={exited}
          aria-label={`Message to ${terminal.name}`}
          placeholder={exited ? `${terminal.name} has exited` : `Send ${terminal.name} a task`}
          className="min-w-0 flex-1 resize-none rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-white placeholder-[#8b949e] focus:border-(--quay-accent) focus:outline-hidden disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={exited || sending || !text.trim()}
          className={`${BUTTON} h-8 border-[#1f6feb] bg-[#1f6feb] text-white enabled:hover:bg-[#388bfd] disabled:opacity-50`}
        >
          Send
        </button>
      </div>
    </form>
  );
};
