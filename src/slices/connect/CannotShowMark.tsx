import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { focusTerminal } from "../terminal/terminalRequests.ts";
import type { RunKind } from "../terminal/types.ts";
import { askForConnectRow, readAntigravity, useAntigravity } from "./antigravity.ts";
import { CannotShowPanel } from "./CannotShowPanel.tsx";
import { cannotShow } from "./cannotShow.ts";
import { useNoHandshake } from "./handshake.ts";

interface CannotShowMarkProps {
  terminalId: string;
  kind: RunKind;
}

const NAME = "Why this terminal can't show surfaces";

const MarkButton = ({ terminalId, kind }: CannotShowMarkProps) => {
  const why = cannotShow(kind, useAntigravity());
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  // Focus that is in the mark or its panel as it goes
  useLayoutEffect(
    () => () => {
      const held = document.activeElement;
      if (held && (held === button.current || held.closest("[role=dialog]")?.id === panelId)) focusTerminal(terminalId);
    },
    [terminalId, panelId]
  );

  const close = useCallback((refocus: boolean) => {
    if (refocus) button.current?.focus();
    setOpen(false);
  }, []);

  if (!why) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        data-no-terminal-focus
        aria-label={NAME}
        title={NAME}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          // Read afresh, so it says what is so now
          if (!open && kind === "antigravity") void readAntigravity();
          setOpen(!open);
        }}
        className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] transition-colors cursor-pointer"
      >
        <Info className="w-3 h-3" aria-hidden="true" />
      </button>
      {open && (
        <CannotShowPanel
          id={panelId}
          label={NAME}
          why={why}
          button={button}
          onClose={close}
          onConnect={() => {
            close(true);
            askForConnectRow();
          }}
        />
      )}
    </>
  );
};

const AgentMark = (props: CannotShowMarkProps) => useNoHandshake(props.terminalId) && <MarkButton {...props} />;

/**
 * The mark on the title bar of a terminal that can't show surfaces: an info button that says why, and
 * how to put it right. It shows once the grace of the terminal's launch is over and its CLI has not
 * shaken hands with Quay's MCP server, and goes when it does. A terminal that is no agent's has none.
 */
export const CannotShowMark = (props: CannotShowMarkProps) => cannotShow(props.kind, null) && <AgentMark {...props} />;
