import type { CSSProperties, ReactNode } from "react";
import { Bot, Command, FolderTree, GitPullRequest, Settings2, Workflow } from "lucide-react";
import { MODULES, MODULE_NAMES, moduleAfterClick, type ModuleId } from "./modules.ts";

/** The module bar's width, in CSS px. */
export const MODULE_BAR_WIDTH = 48;

const MODULE_ICONS: Record<ModuleId, ReactNode> = {
  projects: <FolderTree className="w-[22px] h-[22px]" aria-hidden="true" />,
  "source-control": <GitPullRequest className="w-[22px] h-[22px]" aria-hidden="true" />,
  agents: <Bot className="w-[22px] h-[22px]" aria-hidden="true" />,
  workflows: <Workflow className="w-[22px] h-[22px]" aria-hidden="true" />,
  project: <Settings2 className="w-[22px] h-[22px]" aria-hidden="true" />,
};

// The edge rule: a pointer thrown at the window's left edge lands on a button. The bar and every
// button carry their geometry inline, with no margin, padding or border outside a button, so
// each button's box starts at x = 0 and spans the bar. Visual insets live inside the button.
const BAR_STYLE: CSSProperties = { width: MODULE_BAR_WIDTH, padding: 0, margin: 0, border: 0 };
const BUTTON_STYLE: CSSProperties = { width: MODULE_BAR_WIDTH, height: MODULE_BAR_WIDTH, margin: 0, padding: 0, border: 0 };

interface ModuleBarProps {
  /** The module whose panel shows, or null while the panel is folded. */
  openModule: ModuleId | null;
  onOpenModule: (module: ModuleId | null) => void;
  /** The id of the panel the module icons show and fold. */
  panelId: string;
  onOpenPalette?: () => void;
}

interface BarButtonProps {
  label: string;
  shortcut?: string;
  /** The shortcut in `aria-keyshortcuts` form, such as `Control+Shift+P`. */
  keyShortcuts?: string;
  icon: ReactNode;
  onClick: () => void;
  current?: boolean;
  /** Set on module icons, which show and fold the panel. */
  controls?: string;
}

const BarButton = ({ label, shortcut, keyShortcuts, icon, onClick, current, controls }: BarButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    // Every module icon controls the one panel, so the open module is marked current rather than
    // expanded: an expanded state on one icon would leave the others reading collapsed over a
    // visible panel.
    aria-current={current ? "true" : undefined}
    aria-controls={controls}
    aria-keyshortcuts={keyShortcuts}
    style={BUTTON_STYLE}
    className={`group/mod relative grid place-items-center bg-transparent transition-colors hover:bg-[#21262d] focus-visible:outline-none focus-visible:bg-[#21262d] ${
      current ? "text-white" : "text-[#8b949e] hover:text-white"
    }`}
  >
    {/* The open module's edge, drawn inside the button so the box still starts at x = 0. */}
    {current && <span aria-hidden="true" className="absolute left-0 top-2.5 bottom-2.5 w-[2px] bg-[#58a6ff]" />}
    {icon}
    {/* Styled tooltip instead of `title`, which WebView2 does not always show. */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full ml-1.5 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-[#c9d1d9] shadow-lg opacity-0 transition-opacity group-hover/mod:opacity-100 group-hover/mod:delay-150 group-focus-visible/mod:opacity-100"
    >
      {label}
      {shortcut && <span className="ml-1.5 font-mono text-[#8b949e]">{shortcut}</span>}
    </span>
  </button>
);

/**
 * The permanent icon bar on the window's left edge: one icon per module, top to bottom, then the
 * palette icon at the bottom. A module icon shows its module's panel; the open module's icon
 * folds it.
 */
export const ModuleBar = ({ openModule, onOpenModule, panelId, onOpenPalette }: ModuleBarProps) => (
  <nav
    aria-label="Module bar"
    style={BAR_STYLE}
    className="shrink-0 h-full flex flex-col bg-[#161b22] shadow-[inset_-1px_0_0_#30363d] select-none"
  >
    {MODULES.map((module) => (
      <BarButton
        key={module}
        label={MODULE_NAMES[module]}
        icon={MODULE_ICONS[module]}
        current={openModule === module}
        controls={panelId}
        onClick={() => onOpenModule(moduleAfterClick(openModule, module))}
      />
    ))}
    <div className="flex-1" />
    {onOpenPalette && (
      <BarButton
        label="Command palette"
        shortcut="Ctrl+Shift+P"
        keyShortcuts="Control+Shift+P"
        icon={<Command className="w-5 h-5" aria-hidden="true" />}
        onClick={onOpenPalette}
      />
    )}
  </nav>
);
