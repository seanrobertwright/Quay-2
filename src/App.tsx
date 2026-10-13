import { useWorkspace } from "./slices/workspace/useWorkspace";
import { useBridgeEvents } from "./slices/bridge/useBridgeEvents";
import { Rail } from "./slices/rail/Rail";
import { Stage } from "./slices/stage/Stage";
import { NewTerminalModal } from "./slices/terminal/NewTerminalModal";
import { ActionLogDrawer } from "./slices/bridge/ActionLogDrawer";
import { A2APanel } from "./slices/orchestrator/A2APanel";

export function App() {
  const {
    projects,
    activeProject,
    terminals,
    activeTerminalId,
    bridgePort,
    setActiveTerminalId,
    setActiveProject,
    isNewTerminalOpen,
    setIsNewTerminalOpen,
    isA2AOpen,
    setIsA2AOpen,
    isActionLogOpen,
    setIsActionLogOpen,
    spawnTerminal,
    killTerminal,
  } = useWorkspace();

  const { activeTools, getTerminalEvents } = useBridgeEvents();

  const currentTool = activeTerminalId ? activeTools[activeTerminalId] : null;
  const currentEvents = getTerminalEvents(activeTerminalId);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-[#c9d1d9]">
      {/* Left Navigation Rail */}
      <Rail
        projects={projects}
        activeProject={activeProject}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        bridgePort={bridgePort}
        onSelectTerminal={(id) => setActiveTerminalId(id)}
        onCloseTerminal={(id) => killTerminal(id)}
        onNewTerminal={() => setIsNewTerminalOpen(true)}
        onSelectProject={(path) => setActiveProject(path)}
        onOpenA2APanel={() => setIsA2AOpen(true)}
      />

      {/* Main Workspace Stage */}
      <Stage
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        activeTool={currentTool}
        onNewTerminal={() => setIsNewTerminalOpen(true)}
        onOpenActionLog={() => setIsActionLogOpen(true)}
      />

      {/* New Terminal Dialog (^b n) */}
      <NewTerminalModal
        isOpen={isNewTerminalOpen}
        projectPath={activeProject}
        onClose={() => setIsNewTerminalOpen(false)}
        onSpawn={spawnTerminal}
      />

      {/* Action Log Drawer */}
      <ActionLogDrawer
        isOpen={isActionLogOpen}
        terminalId={activeTerminalId}
        events={currentEvents}
        onClose={() => setIsActionLogOpen(false)}
      />

      {/* Agent-to-Agent Orchestration Bus Panel */}
      <A2APanel
        isOpen={isA2AOpen}
        terminals={terminals}
        onClose={() => setIsA2AOpen(false)}
      />
    </div>
  );
}

export default App;
