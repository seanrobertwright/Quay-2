import { useId, type ReactNode } from "react";
import { MODULES, MODULE_NAMES, type ModuleId } from "./modules.ts";

/** The panel's width, in CSS px. */
export const PANEL_WIDTH = 280;

interface ModulePanelProps {
  id: string;
  /** The module whose panel shows, or null while the panel is folded. */
  openModule: ModuleId | null;
  /** Each module's panel content. */
  panels: Record<ModuleId, ReactNode>;
}

/**
 * The 280 px column beside the module bar that shows the open module. Every module's content stays
 * mounted while another shows or the panel is folded, so a panel keeps its state, such as which
 * projects the Projects panel has collapsed.
 */
export const ModulePanel = ({ id, openModule, panels }: ModulePanelProps) => (
  <aside
    id={id}
    aria-label={openModule ? `${MODULE_NAMES[openModule]} panel` : undefined}
    hidden={openModule === null}
    style={{ width: PANEL_WIDTH }}
    className="shrink-0 h-full min-h-0 flex flex-col bg-[#0d1117] border-r border-[#30363d]"
  >
    {MODULES.map((module) => (
      <div key={module} hidden={module !== openModule} className="flex-1 min-h-0 flex flex-col">
        {panels[module]}
      </div>
    ))}
  </aside>
);

/** One command a placeholder panel offers. */
export interface PanelLauncher {
  id: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  onClick: () => void;
  /** Set while the tool has nothing to open, such as no project for Open in VS Code. */
  disabled?: boolean;
}

/**
 * A panel that lists the tools its module holds today, each opening that tool as before. The
 * Source control, Agents, Workflows and Project panels start as these until their own panels land.
 */
export const LauncherPanel = ({ title, launchers }: { title: string; launchers: PanelLauncher[] }) => {
  const id = useId();
  return (
    <div className="flex-1 min-h-0 flex flex-col select-none text-[#c9d1d9]">
      <h2 className="h-12 shrink-0 px-4 flex items-center border-b border-[#30363d] bg-[#161b22] text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
        {title}
      </h2>
      <ul className="flex-1 overflow-y-auto p-2 space-y-1">
        {launchers.map((launcher) => {
          const shortcutId = `${id}-${launcher.id}-shortcut`;
          return (
            <li key={launcher.id}>
              <button
                type="button"
                onClick={launcher.onClick}
                disabled={launcher.disabled}
                aria-label={launcher.label}
                aria-describedby={launcher.shortcut ? shortcutId : undefined}
                className="w-full min-h-10 flex items-center gap-2.5 px-2.5 rounded-md text-left text-xs enabled:hover:bg-[#161b22] enabled:hover:text-white disabled:opacity-50 transition-colors"
              >
                <span className="shrink-0 w-4 h-4 grid place-items-center" aria-hidden="true">
                  {launcher.icon}
                </span>
                <span className="flex-1 truncate">{launcher.label}</span>
                {launcher.shortcut && (
                  <span id={shortcutId} className="shrink-0 font-mono text-[10px] text-[#8b949e]">
                    {launcher.shortcut}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
