import type { CSSProperties } from "react";
import { BAR_BUTTON_CLASS, BarTooltip, MODULE_BAR_WIDTH } from "./ModuleBar.tsx";
import {
  DOT_STATUS_LABELS,
  PROJECT_GAP,
  STATUS_LIST_PADDING,
  STATUS_ROW_HEIGHT,
  fitStatusRows,
  type DotStatus,
  type StatusRow,
} from "./terminalStatus.ts";

// The edge rule, as for the module icons: each row's button starts at x = 0 and spans the bar.
const ROW_STYLE: CSSProperties = { width: MODULE_BAR_WIDTH, height: STATUS_ROW_HEIGHT, margin: 0, padding: 0, border: 0 };
const LIST_STYLE: CSSProperties = {
  width: MODULE_BAR_WIDTH,
  margin: 0,
  padding: `${STATUS_LIST_PADDING / 2}px 0`,
  listStyle: "none",
};

// Every state differs by shape or motion, never colour alone: a pulsing disc, a disc with a
// halo, a hollow ring and a square.
const DOT_CLASS: Record<DotStatus, string> = {
  working: "w-2 h-2 rounded-full bg-[#3fb950] motion-safe:animate-pulse",
  waiting: "w-2 h-2 rounded-full bg-[#d29922] shadow-[0_0_0_3px_rgba(210,153,34,0.35)]",
  idle: "w-2 h-2 rounded-full border-[1.5px] border-[#8b949e] bg-transparent",
  exited: "w-2 h-2 rounded-none bg-[#f85149]",
};

interface TerminalStatusListProps {
  /** Every terminal's row, in the Projects panel's order; the list applies the cap. */
  rows: readonly StatusRow[];
  /** The height the list may take, in CSS px; null until the bar is measured. */
  maxHeight?: number | null;
  selectedTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  /** Opens the Projects panel, from the +N row. */
  onOpenProjects: () => void;
}

/**
 * The module bar's terminal status list: one 48 x 24 px row and dot per terminal, grouped by
 * project. Clicking a row shows that terminal; when not every row fits, a last +N row opens
 * the Projects panel.
 */
export const TerminalStatusList = ({
  rows,
  maxHeight = null,
  selectedTerminalId,
  onSelectTerminal,
  onOpenProjects,
}: TerminalStatusListProps) => {
  if (rows.length === 0) return null;
  const { rows: shown, hidden } = fitStatusRows(rows, maxHeight);
  // The +N row takes a row itself, so it always stands for two terminals or more.
  const moreLabel = `${hidden} more terminals`;
  return (
    <ul aria-label="Terminals" style={LIST_STYLE} className="shrink-0">
      {shown.map((row, i) => {
        const { terminal, status, projectName } = row;
        const selected = terminal.id === selectedTerminalId;
        const statusLabel = DOT_STATUS_LABELS[status];
        const newGroup = i > 0 && shown[i - 1].group !== row.group;
        return (
          <li key={terminal.id} style={{ marginTop: newGroup ? PROJECT_GAP : 0 }} data-status={status}>
            <button
              type="button"
              aria-label={`${terminal.name}, ${statusLabel}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelectTerminal(terminal.id)}
              data-pie-row
              data-pie-terminal={terminal.id}
              data-pie-folder={terminal.project_path}
              style={ROW_STYLE}
              className={BAR_BUTTON_CLASS}
            >
              {selected && (
                <span aria-hidden="true" data-selected-bar className="absolute left-0 top-0.5 bottom-0.5 w-[2px] bg-[#e6edf3]" />
              )}
              <span aria-hidden="true" className={DOT_CLASS[status]} />
              <BarTooltip>{`${projectName} · ${terminal.name} · ${statusLabel}`}</BarTooltip>
            </button>
          </li>
        );
      })}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            aria-label={`${moreLabel} in the Projects panel`}
            onClick={onOpenProjects}
            style={ROW_STYLE}
            className={`${BAR_BUTTON_CLASS} font-mono text-[10px] text-[#8b949e] hover:text-white`}
          >
            +{hidden}
            <BarTooltip>{`${moreLabel}: open Projects`}</BarTooltip>
          </button>
        </li>
      )}
    </ul>
  );
};
