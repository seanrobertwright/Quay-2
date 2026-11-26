import { useRef, type ReactNode } from "react";
import { AppWindow, PanelRight, X, type LucideIcon } from "lucide-react";
import { AgentIcon } from "../terminal/AgentIcons.tsx";
import type { TerminalInfo } from "../terminal/types.ts";
import { cliName } from "./cliName.ts";
import { FrameNotice } from "./FrameNotice.tsx";
import { SurfaceLinksProvider } from "./SurfaceLinksProvider.tsx";
import type { Dismiss } from "./useDismiss.ts";
import type { Move } from "./useMove.ts";

interface SurfaceFrameProps {
  /** The surface's id, which it is recorded by, and which tests and scripts find it by. */
  id: string;
  terminal: TerminalInfo;
  /** What kind of surface it is, as its label says it, such as "Question". */
  kind: string;
  KindIcon: LucideIcon;
  /** Quay's own line under the header bar, such as that the surface was answered. */
  band?: ReactNode;
  /** Takes the surface off the screen. */
  dismiss: Dismiss;
  /** Moves it between the companion and a stage tab, for one that can be moved. */
  move?: Move | null;
  /** Why the operator's answer or dismissal was not taken, at the frame's foot. */
  refusal: string | null;
  /** Takes the refusal away, at its ×. */
  onDismissRefusal: () => void;
  /** Fills what it is in, so its header bar and foot stay in view while what it holds scrolls. */
  fills?: boolean;
  /** What the agent asked to show. */
  children: ReactNode;
}

/** The look of one of Quay's controls in a frame's header bar. */
const CONTROL = "rounded p-0.5 text-[#8b949e] hover:text-white disabled:opacity-50";

/** The control that opens a companion surface as a stage tab, and sends it back. */
const MoveButton = ({ move, moving, toTab }: Move) => {
  const label = toTab ? "Open as a stage tab" : "Send back to the companion";
  const Icon = toTab ? AppWindow : PanelRight;
  return (
    <button type="button" aria-label={label} title={label} disabled={moving} onClick={move} className={`ml-auto shrink-0 ${CONTROL}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
};

/**
 * What Quay draws around every agent surface: who is asking, in a bar of Quay's own, and a box that
 * the content cannot draw outside.
 */
export const SurfaceFrame = ({ id, terminal, kind, KindIcon, band, dismiss, move = null, refusal, onDismissRefusal, fills = false, children }: SurfaceFrameProps) => {
  const frame = useRef<HTMLElement>(null);
  // A notice's × leaves with its notice, so the focus that was on it comes to the frame
  const focusFrame = () => frame.current?.focus();
  return (
    <section
      ref={frame}
      aria-label={`${kind} from ${terminal.name}`}
      data-surface={id}
      tabIndex={-1}
      className={`overflow-clip rounded-lg border border-[#30363d] bg-[#0d1117] ${fills ? "flex min-h-0 w-full max-w-[1180px] flex-1 flex-col" : ""}`}
    >
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[#30363d] bg-[#161b22] px-3 text-[11px]">
        <KindIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#d29922]" />
        <span aria-hidden="true" className="flex shrink-0">
          <AgentIcon kind={terminal.run_kind} className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-[#c9d1d9]">{terminal.name}</span>
        <span className="shrink-0 text-[#8b949e]">{cliName(terminal.run_kind)}</span>
        {move && <MoveButton {...move} />}
        <button
          type="button"
          aria-label={`Dismiss this ${kind.toLowerCase()}`}
          disabled={dismiss.dismissing}
          onClick={dismiss.dismiss}
          className={`shrink-0 ${CONTROL} ${move ? "" : "ml-auto"}`}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </header>
      {band}
      <SurfaceLinksProvider terminalId={terminal.id} id={id} focusFrame={focusFrame}>
        {/* Paint containment clips the content to this box and holds its fixed and absolute elements inside.
            Neither it nor `overflow-clip` makes a box that scrolls, so in a frame that fills nothing a foot
            sticks to what scrolls around the frame. One that fills scrolls its content, and the size
            container is what the layout in it measures itself by. */}
        {fills ? (
          <div
            data-surface-content
            role="group"
            aria-label={kind}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
            tabIndex={0}
            className="relative isolate min-h-0 flex-1 overflow-y-auto p-3 text-xs text-[#c9d1d9] [container-type:size] contain-paint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--quay-accent)"
          >
            {children}
          </div>
        ) : (
          <div data-surface-content className="relative isolate overflow-clip p-3 text-xs text-[#c9d1d9] contain-paint">
            {children}
          </div>
        )}
      </SurfaceLinksProvider>
      {refusal && (
        <FrameNotice
          onDismiss={() => {
            focusFrame();
            onDismissRefusal();
          }}
        >
          {refusal}
        </FrameNotice>
      )}
    </section>
  );
};
