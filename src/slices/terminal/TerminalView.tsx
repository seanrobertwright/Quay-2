import { useTerminal } from "./useTerminal";

interface TerminalViewProps {
  terminalId: string;
  isVisible: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  terminalId,
  isVisible,
}) => {
  const { containerRef } = useTerminal(terminalId, isVisible);

  return (
    <div
      className={`w-full h-full p-2 bg-[#0d1117] overflow-hidden ${
        isVisible ? "block" : "hidden"
      }`}
      style={{ display: isVisible ? "block" : "none" }}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
