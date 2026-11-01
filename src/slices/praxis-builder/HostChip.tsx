// The host chip in the builder header (#448, #362) and the pieces other views reuse: the panel
// that says what to do about a host condition, its terminal action button, and the simulated
// host's standing banner. The chip shows the latest call's condition and never calls `praxis`
// itself; Check host makes one call when pressed. Every condition has a text label, so its
// colour is never the only sign of it.
import { useId, useRef, useState, type FC } from "react";
import { RefreshCw, SquareTerminal, TriangleAlert } from "lucide-react";
import { hostConditionView, type HostAction, type HostTone } from "./hostCondition.ts";
import type { HostCondition, InteractiveCommand } from "./praxisHost.ts";

const TONE_CLASSES: Record<HostTone, { chip: string; dot: string }> = {
  neutral: { chip: "border-[#30363d] text-[#8b949e]", dot: "bg-[#8b949e]" },
  ok: { chip: "border-[#238636]/60 text-[#3fb950]", dot: "bg-[#3fb950]" },
  error: { chip: "border-[#f85149]/60 text-[#ff7b72]", dot: "bg-[#f85149]" },
  amber: { chip: "border-[#d29922]/70 text-[#e3b341] bg-[#d29922]/10", dot: "bg-[#e3b341]" },
};

/** A button that opens a visible terminal running one `praxis` command for the person to answer. */
export const HostActionButton: FC<{ action: HostAction; onRun: (command: InteractiveCommand) => void }> = ({ action, onRun }) => (
  <button
    type="button"
    onClick={() => onRun(action.command)}
    title={`Opens a terminal running praxis ${action.command}`}
    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white text-xs font-semibold"
  >
    <SquareTerminal className="w-3.5 h-3.5" aria-hidden="true" />
    {action.label}
  </button>
);

/** Check host: one call to the host, to read its condition now. */
export const CheckHostButton: FC<{ checking: boolean; onCheck: () => void }> = ({ checking, onCheck }) => (
  <button
    type="button"
    onClick={onCheck}
    // Not `disabled`, which would drop focus; a press while checking does nothing.
    aria-disabled={checking}
    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-[#21262d] border border-[#30363d] text-[#c9d1d9] text-xs aria-disabled:opacity-50"
  >
    <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
    {checking ? "Checking…" : "Check host"}
  </button>
);

export interface HostPanelProps {
  condition: HostCondition;
  checking: boolean;
  error: string | null;
  onCheck: () => void;
  onRun: (command: InteractiveCommand) => void;
}

/** What a host condition means and what to do about it, with its action and Check host. */
export const HostPanelBody: FC<HostPanelProps> = ({ condition, checking, error, onCheck, onRun }) => {
  const view = hostConditionView(condition);
  const { panel } = view;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="font-semibold text-white">{view.label}</p>
      {panel ? (
        <p className="text-[#c9d1d9] break-words">{panel.text}</p>
      ) : (
        <p className="text-[#8b949e]">
          {condition.state === "notCheckedYet"
            ? "Quay hasn't called the Praxis host for this project yet."
            : view.banner ?? "The last call reached the host and was signed in."}
        </p>
      )}
      {panel?.kind === "linkCli" && <p className="text-[#8b949e] break-words">{panel.reason}</p>}
      {error && (
        <p role="alert" className="text-[#ff7b72] break-words">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        {panel?.kind === "terminal" && <HostActionButton action={panel.action} onRun={onRun} />}
        <CheckHostButton checking={checking} onCheck={onCheck} />
      </div>
    </div>
  );
};

/** The host chip: the condition's label and colour, opening its panel when pressed. */
export const HostChip: FC<HostPanelProps> = (props) => {
  const view = hostConditionView(props.condition);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const tone = TONE_CLASSES[view.tone];
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the panel; every control inside it is native
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          // Handled here, so the builder's own Escape doesn't close the builder too.
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Praxis host"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium hover:bg-[#21262d] ${tone.chip}`}
      >
        {view.tone === "amber" ? (
          <TriangleAlert className="w-3 h-3" aria-hidden="true" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
        )}
        <span className="sr-only">Praxis host: </span>
        {view.label}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Praxis host"
          className="absolute right-0 top-full mt-1 z-20 w-80 p-3 rounded-lg bg-[#161b22] border border-[#30363d] shadow-xl"
        >
          <HostPanelBody
            {...props}
            onRun={(command) => {
              setOpen(false);
              props.onRun(command);
            }}
          />
        </div>
      )}
    </div>
  );
};

/** The simulated host's standing banner, shown for as long as the condition holds. */
export const SimulatedHostBanner: FC<{ condition: HostCondition }> = ({ condition }) => {
  const { banner } = hostConditionView(condition);
  if (!banner) return null;
  return (
    <p
      role="status"
      className="shrink-0 flex items-center gap-2 px-4 py-1.5 text-[11px] border-b border-[#d29922]/50 bg-[#d29922]/10 text-[#e3b341]"
    >
      <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {banner}
    </p>
  );
};
