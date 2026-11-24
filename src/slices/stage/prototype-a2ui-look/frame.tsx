// PROTOTYPE (#696), throwaway. What Quay draws around an agent's surface, the mark on Quay's own
// cards, and a web link: three takes of each.
import { createContext, useContext, useState, type ReactNode } from "react";
import { AppWindow, ExternalLink, LayoutList, ListChecks, MessageCircleQuestion, MoreHorizontal, PanelRight, Shapes, ShieldCheck, X } from "lucide-react";
import { AgentIcon } from "../../terminal/AgentIcons.tsx";
import type { RunKind } from "../../terminal/types.ts";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";

export type Key = "A" | "B" | "C";
export const LooksContext = createContext<{ frame: Key; mark: Key; link: Key; move: Key }>({ frame: "A", mark: "B", link: "B", move: "A" });
const FootContext = createContext<(href: string | null) => void>(() => {});

export type Kind = "ask" | "review" | "board" | "raw";
export const KIND: Record<Kind, { Icon: typeof X; tone: string }> = {
  ask: { Icon: MessageCircleQuestion, tone: "#d29922" },
  review: { Icon: ListChecks, tone: "#a371f7" },
  board: { Icon: LayoutList, tone: "#58a6ff" },
  raw: { Icon: Shapes, tone: "#39c5cf" },
};
export const CLI: Partial<Record<RunKind, string>> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", aider: "Aider", pi: "Pi" };

const hostOf = (href: string) => {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
};
export const WebLink = ({ label, href }: { label: string; href: string }) => {
  const { link } = useContext(LooksContext);
  const foot = useContext(FootContext);
  const show = { onMouseEnter: () => foot(href), onMouseLeave: () => foot(null), onFocus: () => foot(href), onBlur: () => foot(null) };
  const a = (
    <a href={href} onClick={(e) => e.preventDefault()} {...(link === "A" ? {} : show)} className="text-[#58a6ff] hover:underline break-words">
      {label}
      <ExternalLink className="inline w-3 h-3 ml-0.5 -mt-0.5" aria-hidden />
    </a>
  );
  if (link === "A")
    return (
      <span className="inline-block align-top max-w-full">
        {a}
        <span className="block font-mono text-[10px] text-[#8b949e] break-all">{href}</span>
      </span>
    );
  if (link === "B")
    return (
      <span>
        {a} <span className="font-mono text-[10px] px-1 rounded bg-[#30363d]/60 text-[#c9d1d9] break-all">{hostOf(href)}</span>
      </span>
    );
  return a;
};

export interface FrameProps {
  terminal: string;
  cli: RunKind;
  kind: Kind;
  /** The agent's own title, or null where the content carries its own heading (ask). */
  title: string | null;
  onDismiss: () => void;
  /** Set on a raw companion surface: where it sits now, and the control that moves it. */
  move?: { at: "companion" | "tab"; go: () => void };
  children: ReactNode;
  footer?: ReactNode;
}

const ICON_BUTTON = "p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] shrink-0";

export const Frame = ({ terminal, cli, kind, title, onDismiss, move, children, footer }: FrameProps) => {
  const { frame, move: moveLook } = useContext(LooksContext);
  const [href, setHref] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const { Icon, tone } = KIND[kind];
  const moveLabel = move?.at === "tab" ? "Send back to the companion" : "Open as a stage tab";
  const MoveIcon = move?.at === "tab" ? PanelRight : AppWindow;
  const moveControl =
    move && moveLook === "A" ? (
      <button type="button" aria-label={moveLabel} title={moveLabel} onClick={move.go} className={ICON_BUTTON}>
        <MoveIcon className="w-3.5 h-3.5" />
      </button>
    ) : move && moveLook === "B" ? (
      <span className="relative shrink-0">
        <button type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)} className={ICON_BUTTON}>
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {menu && (
          <span className="absolute right-0 top-6 z-30 w-52 p-1 rounded-md border border-[#30363d] bg-[#161b22] shadow-xl flex flex-col">
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                move.go();
              }}
              className="h-7 px-2 text-left rounded hover:bg-[#30363d] text-xs text-[#c9d1d9]"
            >
              {moveLabel}
            </button>
            <button type="button" onClick={onDismiss} className="h-7 px-2 text-left rounded hover:bg-[#30363d] text-xs text-[#c9d1d9]">
              Dismiss
            </button>
          </span>
        )}
      </span>
    ) : null;
  const dismiss = (
    <button type="button" aria-label="Dismiss this surface" title="Dismiss. An agent that asked is told you did not answer." onClick={onDismiss} className={ICON_BUTTON}>
      <X className="w-3.5 h-3.5" />
    </button>
  );
  const heading = title && <h3 className="text-[13px] leading-[18px] font-semibold text-[#f0f6fc] break-words">{title}</h3>;
  const foot = (
    <>
      {move && moveLook === "C" && (
        <div className="px-3 pb-2">
          <button type="button" onClick={move.go} className="text-[11px] text-[#58a6ff] hover:underline">
            {move.at === "tab" ? moveLabel : "Too narrow? Open as a stage tab"}
          </button>
        </div>
      )}
      {href && (
        <div className="px-3 py-1 border-t border-[#30363d] bg-[#161b22] font-mono text-[10px] text-[#c9d1d9] break-all" role="status">
          {href}
        </div>
      )}
    </>
  );
  const who = (
    <>
      <AgentIcon kind={cli} className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate text-[#c9d1d9]">{terminal}</span>
      <span className="truncate text-[#8b949e]">{CLI[cli]}</span>
    </>
  );
  return (
    <FootContext.Provider value={setHref}>
      {frame === "A" && (
        <section aria-label={`From ${terminal}`} className="rounded-lg border border-[#30363d] bg-[#0d1117]">
          <header className="h-8 pl-3 pr-1.5 flex items-center gap-1.5 text-[11px] bg-[#161b22] border-b border-[#30363d] rounded-t-lg">
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: tone }} aria-hidden />
            {who}
            <span className="flex-1" />
            {moveControl}
            {dismiss}
          </header>
          <div className="p-3 flex flex-col gap-2.5">
            {heading}
            {children}
          </div>
          {footer}
          {foot}
        </section>
      )}
      {frame === "B" && (
        <section aria-label={`From ${terminal}`} className="relative pl-3 border-l-[3px]" style={{ borderColor: tone }}>
          <header className="flex items-center gap-1.5 text-[11px] pb-1">
            {who}
            <span className="flex-1" />
            {moveControl}
            {dismiss}
          </header>
          <div className="flex flex-col gap-2.5 pr-1">
            {heading}
            {children}
          </div>
          {footer}
          {foot}
        </section>
      )}
      {frame === "C" && (
        <section aria-label={`From ${terminal}`} className="rounded-lg border border-[#30363d] bg-[#161b22]">
          <div className="p-3 flex flex-col gap-2.5">
            <div className="flex gap-2 items-start">
              <Icon className="w-4 h-4 shrink-0 mt-px" style={{ color: tone }} aria-hidden />
              <div className="flex-1 min-w-0">
                {heading ?? <h3 className="text-[13px] font-semibold text-[#f0f6fc]">Asks</h3>}
                <div className="flex items-center gap-1.5 text-[10px] mt-0.5">{who}</div>
              </div>
              {moveControl}
              {dismiss}
            </div>
            {children}
          </div>
          {footer}
          {foot}
        </section>
      )}
    </FootContext.Provider>
  );
};

/** Quay's own decision card, with the mark an agent's surface cannot have. */
export const QuayCard = () => {
  const { mark } = useContext(LooksContext);
  const danger = "h-7 px-3 rounded-md text-xs border border-[#da3633]/50 bg-[#da3633]/10 text-[#ff7b72]";
  return (
    <section aria-label="Quay: permission" data-neon={mark === "B" ? "pane" : undefined} className={`rounded-lg border bg-[#161b22] overflow-hidden ${mark === "B" ? "" : "border-[#30363d]"}`}>
      {mark === "A" && (
        <div className="h-7 px-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#0d1117] bg-[var(--quay-accent)]">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> QUAY ASKS
        </div>
      )}
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {mark !== "A" && <ShieldCheck className="w-4 h-4 text-[var(--quay-accent)]" aria-hidden />}
          <h3 className="flex-1 text-[13px] font-semibold text-[#f0f6fc]">Permission: force push</h3>
          {mark !== "A" && <span className="px-1.5 rounded border border-[var(--quay-accent-line)] text-[var(--quay-accent)] text-[10px] font-mono">QUAY</span>}
        </div>
        <p className="text-xs text-[#8b949e]">fix-75 wants to run a command outside this project's allow list.</p>
        <pre className="px-2.5 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-[11px] font-mono whitespace-pre-wrap break-all">git push --force-with-lease origin fix/75-pair-answers</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY}>
            Allow once
          </button>
          <button type="button" className={SECONDARY}>
            Always allow
          </button>
          <button type="button" className={danger}>
            Deny
          </button>
        </div>
      </div>
    </section>
  );
};

export const Settled = ({ lines, verb = "Sent" }: { lines: [string, string][]; verb?: string }) => (
  <div className="flex flex-col gap-1.5 text-xs">
    {lines.map(([q, a]) => (
      <div key={q}>
        <div className="text-[11px] text-[#8b949e] break-words">{q}</div>
        <div className="text-[#f0f6fc] break-words">{a}</div>
      </div>
    ))}
    <div className="text-[11px] text-[#3fb950]">✓ {verb} to the agent, 19:42</div>
  </div>
);
