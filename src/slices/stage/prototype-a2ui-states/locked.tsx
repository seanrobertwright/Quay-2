// PROTOTYPE (#702), throwaway. A surface that can no longer be answered: settled, ended or
// withdrawn. Three ways to say so, inside the header-bar frame picked in #696.
import { useState, type ReactNode } from "react";
import { Ban, Check, ChevronRight, CircleSlash, MessageSquare, X } from "lucide-react";
import { AgentIcon } from "../../terminal/AgentIcons.tsx";
import type { RunKind } from "../../terminal/types.ts";
import { CLI, KIND, type Key, type Kind } from "../prototype-a2ui-look/frame.tsx";
import type { Ask } from "../prototype-a2ui-look/content.ts";

export type LockState = "settled" | "ended" | "withdrawn";
export interface Locked {
  id: string;
  kind: Kind;
  title: string;
  state: LockState;
  at: string;
  /** What was chosen, one pair per question; empty when nothing was answered. */
  lines: [string, string][];
  /** What the operator had typed and not sent. */
  draft?: string;
  /** The surface as it was asked, drawn without controls. */
  full?: ReactNode;
  verdict?: string;
  terminal?: string;
  cli?: RunKind;
}

const MARK = {
  settled: { Icon: Check, tone: "#3fb950" },
  ended: { Icon: CircleSlash, tone: "#8b949e" },
  withdrawn: { Icon: Ban, tone: "#d2a8ff" },
} as const;
const markOf = (l: Locked) =>
  l.state !== "settled" ? MARK[l.state] : /^(Failed|Rejected)$/.test(l.verdict ?? "") ? { Icon: X, tone: "#ff7b72" } : /^Changes/.test(l.verdict ?? "") ? { Icon: MessageSquare, tone: "#e3b341" } : MARK.settled;

export const word = (l: Locked) =>
  l.state === "ended" ? (l.kind === "board" ? "Stopped" : "Ended") : l.state === "withdrawn" ? "Withdrawn" : (l.verdict ?? (l.kind === "board" ? "Done" : "Answered"));
export const sentence = (l: Locked) =>
  l.state === "ended"
    ? l.kind === "board"
      ? "Stopped: the terminal exited."
      : "The terminal exited before this was answered."
    : l.state === "withdrawn"
      ? "Withdrawn by the agent before you answered."
      : l.kind === "board"
        ? `${word(l)}.`
        : `${word(l)} and sent to the agent.`;

export const StateMark = ({ l, className = "" }: { l: Locked; className?: string }) => {
  const { Icon, tone } = markOf(l);
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 text-[11px] ${className}`} style={{ color: tone }}>
      <Icon className="w-3 h-3" aria-hidden />
      {word(l)}
    </span>
  );
};

/** A question as it was asked, with nothing left to click. */
export const AskedPlain = ({ ask }: { ask: Ask }) => (
  <div className="flex flex-col gap-2 text-xs">
    {ask.questions.map((q) => (
      <div key={q.question} className="flex flex-col gap-1">
        <div className="text-[#c9d1d9] break-words">{q.question}</div>
        {q.options?.map((o) => (
          <div key={o.label} className="pl-2.5 border-l border-[#30363d] text-[11px] text-[#8b949e] break-words">
            {o.label}
          </div>
        ))}
      </div>
    ))}
  </div>
);

const ICON_BUTTON = "p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] shrink-0";

export const LockedCard = ({ l, look, body, draft, onDismiss }: { l: Locked; look: Key; body: Key; draft: Key; onDismiss: () => void }) => {
  const [asked, setAsked] = useState(false);
  const [copied, setCopied] = useState("");
  const { Icon, tone } = KIND[l.kind];
  const mark = markOf(l);
  const dim = look === "C" ? "opacity-60" : "";
  return (
    <section aria-label={`${sentence(l)} ${l.title}`} className="rounded-lg border border-[#30363d] bg-[#0d1117]">
      <header className={`h-8 pl-3 pr-1.5 flex items-center gap-1.5 text-[11px] bg-[#161b22] border-b border-[#30363d] rounded-t-lg ${dim}`}>
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-60" style={{ color: tone }} aria-hidden />
        <AgentIcon kind={l.cli ?? "claude"} className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate text-[#c9d1d9]">{l.terminal ?? "fix-75"}</span>
        <span className="truncate text-[#8b949e]">{CLI[l.cli ?? "claude"]}</span>
        <span className="flex-1" />
        {look === "A" && (
          <span title={`${sentence(l)} ${l.at}`}>
            <StateMark l={l} />
          </span>
        )}
        <button type="button" aria-label="Dismiss this surface" title="Dismiss. The agent is not told: there is nothing left to answer." onClick={onDismiss} className={ICON_BUTTON}>
          <X className="w-3.5 h-3.5" />
        </button>
      </header>
      {look === "B" && (
        <div className="px-3 py-1.5 flex items-start gap-2 text-[11px] border-b border-[#30363d]" style={{ color: mark.tone, backgroundColor: `${mark.tone}14` }}>
          <mark.Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{sentence(l)}</span>
          <span className="shrink-0 text-[#8b949e]">{l.at}</span>
        </div>
      )}
      <div className={`p-3 flex flex-col gap-2.5 ${dim}`}>
        {l.kind !== "ask" && <h3 className="text-[13px] leading-[18px] font-semibold text-[#c9d1d9] break-words">{l.title}</h3>}
        {l.lines.map(([q, a]) => (
          <div key={q} className="text-xs">
            <div className="text-[11px] text-[#8b949e] break-words">{q}</div>
            <div className="text-[#f0f6fc] break-words">{a}</div>
          </div>
        ))}
        {l.lines.length === 0 && l.kind === "ask" && body === "A" && <div className="text-xs text-[#c9d1d9] break-words">{l.title}</div>}
        {l.full && l.kind === "board" && <div>{l.full}</div>}
        {l.full && l.kind !== "board" && body === "B" && <div className="opacity-60">{l.full}</div>}
        {l.full && l.kind !== "board" && body === "A" && (
          <div>
            <button type="button" aria-expanded={asked} onClick={() => setAsked(!asked)} className="flex items-center gap-1 text-[11px] text-[#58a6ff] hover:underline">
              <ChevronRight className={`w-3 h-3 ${asked ? "rotate-90" : ""}`} aria-hidden />
              As it was asked
            </button>
            {asked && <div className="mt-1.5 opacity-70">{l.full}</div>}
          </div>
        )}
        {l.draft && draft === "A" && (
          <div className="rounded-md border border-dashed border-[#484f58] px-2.5 py-2 text-xs">
            <div className="flex items-center gap-2 text-[11px] text-[#8b949e]">
              <span className="flex-1">You had typed, not sent</span>
              <button
                type="button"
                className="text-[#58a6ff] hover:underline"
                onClick={() => {
                  const fail = () => setCopied("Select the text and press Ctrl+C");
                  if (navigator.clipboard) navigator.clipboard.writeText(l.draft ?? "").then(() => setCopied("Copied"), fail);
                  else fail();
                }}
              >
                {copied || "Copy"}
              </button>
            </div>
            <div className="mt-0.5 text-[#f0f6fc] break-words">{l.draft}</div>
          </div>
        )}
      </div>
      {look === "C" && (
        <div className="px-3 py-1.5 flex items-center gap-2 border-t border-[#30363d] text-[11px]">
          <StateMark l={l} />
          <span className="min-w-0 flex-1 truncate text-[#8b949e]" title={sentence(l)}>
            {sentence(l)}
          </span>
          <span className="shrink-0 text-[#8b949e]">{l.at}</span>
        </div>
      )}
    </section>
  );
};

/** A locked surface as one line, opened in place. */
export const LockedRow = ({ l, open, onToggle, onDismiss, card }: { l: Locked; open: boolean; onToggle: () => void; onDismiss: () => void; card: ReactNode }) =>
  open ? (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={onToggle} className="self-start text-[11px] text-[#58a6ff] hover:underline">
        Fold
      </button>
      {card}
    </div>
  ) : (
    <div className="group h-7 flex items-center gap-2 px-2 rounded-md hover:bg-[#161b22] text-xs">
      <button type="button" aria-expanded={false} onClick={onToggle} className="min-w-0 flex-1 flex items-center gap-2 text-left">
        <StateMark l={l} className="w-[5.4rem]" />
        <span className="truncate text-[#8b949e]">{l.lines[0]?.[1] ? `${l.lines[0][1]}` : l.title}</span>
      </button>
      <span className="shrink-0 text-[10px] text-[#6e7681]">{l.at}</span>
      <button type="button" aria-label={`Dismiss: ${l.title}`} onClick={onDismiss} className={ICON_BUTTON}>
        <X className="w-3 h-3" />
      </button>
    </div>
  );
