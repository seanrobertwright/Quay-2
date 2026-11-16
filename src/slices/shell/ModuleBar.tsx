import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bot, Command, FolderTree, GitPullRequest, Settings2, Workflow } from "lucide-react";
import { MODULES, MODULE_NAMES, moduleAfterClick, type ModuleId } from "./modules.ts";
import { badgeText, spendText } from "./barBadges.ts";

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
const SPEND_HEIGHT = 28;
const SPEND_STYLE: CSSProperties = { ...BUTTON_STYLE, height: SPEND_HEIGHT };

/** The classes every bar button shares; its tooltip shows on the `mod` group's hover or focus. */
export const BAR_BUTTON_CLASS =
  "group/mod relative shrink-0 grid place-items-center bg-transparent transition-colors hover:bg-[#21262d] focus-visible:outline-none focus-visible:bg-[#21262d]";

/** A bar button's tooltip, beside the bar. Styled instead of `title`, which WebView2 does not always show. */
export const BarTooltip = ({ children }: { children: ReactNode }) => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute left-full ml-1.5 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-[#c9d1d9] shadow-lg opacity-0 transition-opacity group-hover/mod:opacity-100 group-hover/mod:delay-150 group-focus-visible/mod:opacity-100"
  >
    {children}
  </span>
);

interface ModuleBarProps {
  /** The module whose panel shows, or null while the panel is folded. */
  openModule: ModuleId | null;
  onOpenModule: (module: ModuleId | null) => void;
  /** The id of the panel the module icons show and fold. */
  panelId: string;
  onOpenPalette?: () => void;
  /**
   * Renders the terminal status list directly under the Projects icon, given the height left
   * for it in CSS px (null until the bar is measured).
   */
  renderTerminalList?: (maxHeight: number | null) => ReactNode;
  /** The Waiting on you count, permission requests included, on the Agents icon. */
  waitingCount?: number;
  /** The open pull request count on the Source control icon; null while unknown. */
  openPrCount?: number | null;
  /** Today's spend in US dollars for the ticker at the bottom; null while unknown. */
  spendTodayUsd?: number | null;
  /** Opens the token spend window from the spend ticker, which shows only when this is set. */
  onOpenSpend?: () => void;
}

/** A module icon's badge: its count and the words a screen reader hears after the module name. */
interface Badge {
  count: number;
  noun: (count: number) => string;
  className: string;
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
  badge?: Badge;
}

const BarButton = ({ label, shortcut, keyShortcuts, icon, onClick, current, controls, badge }: BarButtonProps) => {
  const badgeLabel = badge ? badgeText(badge.count) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge && badgeLabel ? `${label}, ${badge.count} ${badge.noun(badge.count)}` : label}
      // Every module icon controls the one panel, so the open module is marked current rather than
      // expanded: an expanded state on one icon would leave the others reading collapsed over a
      // visible panel.
      aria-current={current ? "true" : undefined}
      aria-controls={controls}
      aria-keyshortcuts={keyShortcuts}
      style={BUTTON_STYLE}
      className={`${BAR_BUTTON_CLASS} ${current ? "text-white" : "text-[#8b949e] hover:text-white"}`}
    >
      {/* The open module's edge, drawn inside the button so the box still starts at x = 0. */}
      {current && <span aria-hidden="true" className="absolute left-0 top-2.5 bottom-2.5 w-[2px] bg-[#58a6ff]" />}
      {icon}
      {badge && badgeLabel && (
        <span
          aria-hidden="true"
          data-badge
          className={`absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 font-semibold text-center ${badge.className}`}
        >
          {badgeLabel}
        </span>
      )}
      <BarTooltip>
        {label}
        {shortcut && <span className="ml-1.5 font-mono text-[#8b949e]">{shortcut}</span>}
      </BarTooltip>
    </button>
  );
};

/** The module icons' badges: Waiting on you on Agents, open pull requests on Source control. */
function moduleBadges(waitingCount: number, openPrCount: number | null): Partial<Record<ModuleId, Badge>> {
  return {
    agents: { count: waitingCount, noun: () => "waiting on you", className: "bg-[#d29922] text-[#0d1117]" },
    "source-control": {
      count: openPrCount ?? 0,
      noun: (count) => (count === 1 ? "open pull request" : "open pull requests"),
      className: "bg-[#1f6feb] text-white",
    },
  };
}

/**
 * The permanent icon bar on the window's left edge: one icon per module, top to bottom, with the
 * terminal status list under the Projects icon, then the palette icon and today's spend at the
 * bottom. A module icon shows its module's panel; the open module's icon folds it.
 */
export const ModuleBar = ({
  openModule,
  onOpenModule,
  panelId,
  onOpenPalette,
  renderTerminalList,
  waitingCount = 0,
  openPrCount = null,
  spendTodayUsd = null,
  onOpenSpend,
}: ModuleBarProps) => {
  const badges = moduleBadges(waitingCount, openPrCount);
  const navRef = useRef<HTMLElement>(null);
  const [navHeight, setNavHeight] = useState<number | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setNavHeight(nav.clientHeight));
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  // The list gets what the fixed buttons leave, so a short window drops rows, not buttons.
  const fixedHeight =
    MODULES.length * MODULE_BAR_WIDTH + (onOpenPalette ? MODULE_BAR_WIDTH : 0) + (onOpenSpend ? SPEND_HEIGHT : 0);
  const listHeight = navHeight === null ? null : Math.max(navHeight - fixedHeight, 0);
  const spendLabel = spendTodayUsd === null ? "$–" : spendText(spendTodayUsd);
  return (
    <nav
      ref={navRef}
      aria-label="Module bar"
      // The module bar is a pie surface: plain right-click opens the pie (#648).
      data-pie-surface="pie"
      data-pie-target="panel"
      style={BAR_STYLE}
      className="shrink-0 h-full flex flex-col bg-[#161b22] shadow-[inset_-1px_0_0_#30363d] select-none"
    >
      {MODULES.map((module) => (
        <Fragment key={module}>
          <BarButton
            label={MODULE_NAMES[module]}
            icon={MODULE_ICONS[module]}
            current={openModule === module}
            controls={panelId}
            badge={badges[module]}
            onClick={() => onOpenModule(moduleAfterClick(openModule, module))}
          />
          {module === "projects" && renderTerminalList?.(listHeight)}
        </Fragment>
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
      {onOpenSpend && (
        <button
          type="button"
          onClick={onOpenSpend}
          aria-label={`Today's spend: ${spendLabel === "$–" ? "unknown" : spendLabel}`}
          style={SPEND_STYLE}
          className={`${BAR_BUTTON_CLASS} font-mono text-[10px] font-semibold text-[#e3b341]`}
        >
          {spendLabel}
        </button>
      )}
    </nav>
  );
};
