import type { ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { AgentIcon } from "../terminal/AgentIcons.tsx";
import type { TerminalInfo } from "../terminal/types.ts";
import { cliName } from "./cliName.ts";
import type { Dismiss } from "./useDismiss.ts";

interface SurfaceFrameProps {
  /** The surface's id, which tests and scripts find it by. */
  id: string;
  terminal: TerminalInfo;
  /** What kind of surface it is, as its label says it, such as "Question". */
  kind: string;
  KindIcon: LucideIcon;
  /** Quay's own line under the header bar, such as that the surface was answered. */
  band?: ReactNode;
  /** Takes the surface off the screen. */
  dismiss: Dismiss;
  /** Why the operator's answer or dismissal was not taken, at the frame's foot. */
  refusal: string | null;
  /** What the agent asked to show. */
  children: ReactNode;
}

/**
 * What Quay draws around every agent surface: who is asking, in a bar of Quay's own, and a box that
 * the content cannot draw outside.
 */
export const SurfaceFrame = ({ id, terminal, kind, KindIcon, band, dismiss, refusal, children }: SurfaceFrameProps) => (
  <section aria-label={`${kind} from ${terminal.name}`} data-surface={id} className="overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
    <header className="flex h-8 items-center gap-1.5 border-b border-[#30363d] bg-[#161b22] px-3 text-[11px]">
      <KindIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#d29922]" />
      <span aria-hidden="true" className="flex shrink-0">
        <AgentIcon kind={terminal.run_kind} className="h-3.5 w-3.5" />
      </span>
      <span className="truncate text-[#c9d1d9]">{terminal.name}</span>
      <span className="shrink-0 text-[#8b949e]">{cliName(terminal.run_kind)}</span>
      <button
        type="button"
        aria-label={`Dismiss this ${kind.toLowerCase()}`}
        disabled={dismiss.dismissing}
        onClick={dismiss.dismiss}
        className="ml-auto shrink-0 rounded p-0.5 text-[#8b949e] hover:text-white disabled:opacity-50"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </header>
    {band}
    {/* Paint containment clips the content to this box and holds its fixed and absolute elements inside. */}
    <div data-surface-content className="relative isolate overflow-hidden p-3 text-xs text-[#c9d1d9] contain-paint">
      {children}
    </div>
    {refusal && (
      <p role="alert" className="border-t border-[#da3633]/40 bg-[#da3633]/10 px-3 py-1.5 text-[11px] wrap-anywhere text-[#ff7b72]">
        {refusal}
      </p>
    )}
  </section>
);
