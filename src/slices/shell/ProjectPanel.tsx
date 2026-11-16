import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpCircle, Coins, FolderOpen, Settings } from "lucide-react";
import { VsCodeIcon } from "../workspace/VsCodeIcon.tsx";
import { PieWire } from "../pie/PieWire.tsx";
import { pieRing } from "../pie/pieRing.ts";
import { SHELL_SETTINGS, type SetShellPref, type ShellPrefKey, type ShellPrefs, type ShellSetting } from "./shellPrefs.ts";

/** What a chord asks the Project panel to focus; `seq` counts requests so a repeat focuses again. */
export interface ProjectPanelFocus {
  target: "this-project" | "check-for-updates";
  seq: number;
}

interface ProjectPanelProps {
  /** The open project's name, or null with no project open. */
  projectName: string | null;
  /** Whether a project is open, which workspace settings and Open in VS Code act on. */
  hasProject: boolean;
  /** Today's spend in USD, or null before the first read. */
  spendTodayUsd: number | null;
  appVersion: string;
  prefs: ShellPrefs;
  focusRequest: ProjectPanelFocus | null;
  onOpenWorkspaceSettings: () => void;
  onOpenInVsCode: () => void;
  onOpenTokenSpend: () => void;
  onOpenLogsFolder: () => void;
  onCheckForUpdates: () => void;
  onSetPref: SetShellPref;
}

const GroupHeading = ({ id, children, note }: { id: string; children: ReactNode; note?: string | null }) => (
  <h3 className="px-2.5 pt-3 pb-1.5 flex items-baseline gap-2 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
    <span id={id}>{children}</span>
    {note && <span className="ml-auto truncate normal-case tracking-normal font-normal text-[#6e7681]">{note}</span>}
  </h3>
);

interface RowProps {
  label: string;
  detail?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/** One action row: an icon, its name and a line of detail under it. */
const ActionRow = ({ label, detail, icon, onClick, disabled }: RowProps) => {
  const detailId = useId();
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-describedby={detail ? detailId : undefined}
        className="w-full min-h-10 flex items-center gap-2.5 px-2.5 rounded-md text-left text-xs enabled:hover:bg-[#161b22] enabled:hover:text-white disabled:opacity-50 transition-colors"
      >
        <span className="shrink-0 w-4 h-4 grid place-items-center" aria-hidden="true">
          {icon}
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="truncate">{label}</span>
          {detail && (
            <span id={detailId} className="truncate text-[10px] text-[#8b949e]">
              {detail}
            </span>
          )}
        </span>
      </button>
    </li>
  );
};

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * A choice setting as a radio group: one click picks a value. Arrow keys move to, and pick, the
 * next or previous value, and only the checked value is in the tab order.
 */
function ChoiceSetting<K extends ShellPrefKey>({
  setting,
  value,
  onSet,
}: {
  setting: ShellSetting<K>;
  value: ShellPrefs[K];
  onSet: (value: ShellPrefs[K]) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const options = setting.options;
  const checked = Math.max(0, options.findIndex((option) => option.value === value));
  const swatchOf = setting.swatch;
  const palette = swatchOf !== undefined;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = NEXT_KEYS.has(e.key) ? 1 : PREVIOUS_KEYS.has(e.key) ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (checked + step + options.length) % options.length;
    onSet(options[next].value);
    buttons.current[next]?.focus();
  };
  return (
    <div className="px-2.5 py-1.5">
      <div className="pb-1 text-[11px] text-[#8b949e]">{setting.label}</div>
      <div
        role="radiogroup"
        aria-label={setting.label}
        className={palette ? "grid grid-cols-2 gap-1" : "flex rounded-md border border-[#30363d] bg-[#0d1117] p-0.5"}
      >
        {options.map((option, index) => {
          const isChecked = index === checked;
          const swatch = swatchOf?.(option.value);
          return (
            <button
              key={String(option.value)}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isChecked}
              tabIndex={isChecked ? 0 : -1}
              onClick={() => onSet(option.value)}
              onKeyDown={onKeyDown}
              className={`min-h-6 flex items-center gap-1.5 rounded px-2 text-[11px] transition-colors ${palette ? "flex-none border" : "flex-1 justify-center"} ${
                isChecked
                  ? `bg-[#21262d] text-white ${palette ? "border-[#58a6ff]" : ""}`
                  : `text-[#8b949e] hover:text-[#c9d1d9] ${palette ? "border-[#30363d]" : ""}`
              }`}
            >
              {swatch && <span aria-hidden="true" className="shrink-0 w-3.5 h-3.5 rounded-sm" style={{ background: swatch }} />}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** An on/off setting as one toggle button, named by the setting and pressed while on. */
const ToggleSetting = ({ label, on, onSet }: { label: string; on: boolean; onSet: (on: boolean) => void }) => (
  <div className="px-2.5 py-1.5">
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={() => onSet(!on)}
      className="w-full min-h-6 flex items-center gap-2 text-[11px] text-[#c9d1d9] hover:text-white"
    >
      <span className="flex-1 text-left text-[#8b949e]">{label}</span>
      <span aria-hidden="true" className={`relative w-7 h-4 rounded-full transition-colors ${on ? "bg-[#238636]" : "bg-[#30363d]"}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-[#e6edf3] transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      <span aria-hidden="true" className="w-6 text-right">
        {on ? "On" : "Off"}
      </span>
    </button>
  </div>
);

/** A shell setting as its control, set in one click. */
function SettingControl<K extends ShellPrefKey>({ setting, prefs, onSetPref }: { setting: ShellSetting<K>; prefs: ShellPrefs; onSetPref: SetShellPref }) {
  const value = prefs[setting.key];
  const onSet = (next: ShellPrefs[K]) => onSetPref(setting.key, next);
  if (setting.kind === "toggle") return <ToggleSetting label={setting.label} on={value === true} onSet={(on) => onSet(on as ShellPrefs[K])} />;
  return <ChoiceSetting setting={setting} value={value} onSet={onSet} />;
}

/** What the preview pie shows: the ring over a terminal, which fills every wedge but Merge's. */
const PREVIEW_RING = pieRing({ surface: "terminal", terminalId: "", zoomable: true });

/**
 * The Project module's panel: the This project group, which acts on the open project, and the
 * Quay · every project group, the shell's own settings as one-click controls.
 */
export const ProjectPanel = (props: ProjectPanelProps) => {
  const id = useId();
  const thisProjectId = `${id}-this-project`;
  const everyProjectId = `${id}-every-project`;
  const thisProjectGroup = useRef<HTMLDivElement | null>(null);
  const updatesRow = useRef<HTMLUListElement | null>(null);
  // A chord's request focuses the first control it can in its target: the This project group's
  // first enabled row, or Check for updates. Each new `seq` focuses again.
  const focusSeq = props.focusRequest?.seq;
  const focusTarget = props.focusRequest?.target;
  useEffect(() => {
    if (focusSeq === undefined) return;
    const scope = focusTarget === "check-for-updates" ? updatesRow.current : thisProjectGroup.current;
    scope?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [focusSeq, focusTarget]);
  const spend = props.spendTodayUsd === null ? undefined : `$${props.spendTodayUsd.toFixed(2)} today`;
  return (
    <div className="flex-1 min-h-0 flex flex-col select-none text-[#c9d1d9]">
      <h2 className="h-12 shrink-0 px-4 flex items-center border-b border-[#30363d] bg-[#161b22] text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
        Project
      </h2>
      <div className="flex-1 overflow-y-auto p-2">
        <div ref={thisProjectGroup} role="group" aria-labelledby={thisProjectId}>
          <GroupHeading id={thisProjectId} note={props.projectName}>
            This project
          </GroupHeading>
          <ul className="space-y-1">
            <ActionRow
              label="Workspace settings"
              detail="Environment variables and default flags"
              icon={<Settings className="w-4 h-4 text-[#8b949e]" />}
              onClick={props.onOpenWorkspaceSettings}
              disabled={!props.hasProject}
            />
            <ActionRow label="Open in VS Code" icon={<VsCodeIcon className="w-4 h-4" />} onClick={props.onOpenInVsCode} disabled={!props.hasProject} />
            <ActionRow label="Token spend" detail={spend} icon={<Coins className="w-4 h-4 text-[#e3b341]" />} onClick={props.onOpenTokenSpend} />
            <ActionRow
              label="Logs folder"
              detail="Quay's log files and crash.log"
              icon={<FolderOpen className="w-4 h-4 text-[#8b949e]" />}
              onClick={props.onOpenLogsFolder}
            />
          </ul>
        </div>
        <div role="group" aria-labelledby={everyProjectId} className="mt-2 border-t border-[#30363d]">
          <GroupHeading id={everyProjectId}>Quay · every project</GroupHeading>
          {/* Drawn from the current settings, so it redraws as the pie palette or label outline changes. */}
          <div className="px-2.5 py-1.5 flex justify-center">
            <PieWire
              as="preview"
              label="Pie preview"
              ring={PREVIEW_RING}
              palette={props.prefs.piePalette}
              labelOutline={props.prefs.pieLabelOutline}
              aimed={null}
              className="w-[200px] h-[200px]"
            />
          </div>
          {SHELL_SETTINGS.map((setting) => (
            <SettingControl key={setting.key} setting={setting} prefs={props.prefs} onSetPref={props.onSetPref} />
          ))}
          <ul ref={updatesRow} className="mt-1">
            <ActionRow
              label="Check for updates"
              detail={`Quay v${props.appVersion}`}
              icon={<ArrowUpCircle className="w-4 h-4 text-[#58a6ff]" />}
              onClick={props.onCheckForUpdates}
            />
          </ul>
        </div>
      </div>
    </div>
  );
};
