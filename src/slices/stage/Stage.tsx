import { TerminalInfo } from "../terminal/types";
import { TerminalView } from "../terminal/TerminalView";
import { SkipBanner } from "./SkipBanner";
import { StatusStrip } from "./StatusStrip";
import { Placeholder } from "./Placeholder";

interface StageProps {
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  activeTool?: string | null;
  onNewTerminal: () => void;
  onOpenActionLog: () => void;
}

export const Stage: React.FC<StageProps> = ({
  terminals,
  activeTerminalId,
  activeTool,
  onNewTerminal,
  onOpenActionLog,
}) => {
  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);

  if (!activeTerminal || terminals.length === 0) {
    return <Placeholder onNewTerminal={onNewTerminal} />;
  }

  const showSkipBanner =
    activeTerminal.run_kind === "claude" &&
    activeTerminal.permission_mode === "skip";

  return (
    <main className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden relative">
      {/* Skip Banner above terminal */}
      {showSkipBanner && <SkipBanner />}

      {/* Main Terminal Viewport */}
      <div className="flex-1 relative overflow-hidden bg-[#0d1117]">
        {terminals.map((term) => (
          <TerminalView
            key={term.id}
            terminalId={term.id}
            isVisible={term.id === activeTerminalId}
          />
        ))}
      </div>

      {/* Status Strip below terminal */}
      <StatusStrip
        terminal={activeTerminal}
        activeTool={activeTool}
        onOpenActionLog={onOpenActionLog}
      />
    </main>
  );
};
