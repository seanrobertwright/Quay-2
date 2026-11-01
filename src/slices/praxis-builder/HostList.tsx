// The Workflow templates list's host parts (#363, #450): each row's host badge, the group
// header's host condition with Check host, and the On host only subsection. They draw
// `hostList.ts`'s view of the host catalog (#449) and never call `praxis` themselves: Check host
// asks the catalog, whose reads go through the Praxis CLI runner (#446).
import { useEffect, useId, useRef, useState, type FC } from "react";
import { Ban, Check, ChevronDown, ChevronRight, CircleAlert, CircleDashed, CircleHelp, CircleX, CloudOff, FileDiff, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HostActionButton } from "./HostChip.tsx";
import type { HostTone } from "./hostCondition.ts";
import { hostOnlyDetails, type HostBadge, type HostBadgeTone, type HostGroupHeader, type HostOnlySection, type ShownHostState } from "./hostList.ts";
import type { InteractiveCommand } from "./praxisHost.ts";

const BADGE_ICONS: Record<ShownHostState, LucideIcon> = {
  nameRefused: Ban,
  notInstalled: CloudOff,
  invalidOnHost: CircleX,
  differs: FileDiff,
  notReady: CircleAlert,
  installed: Check,
  failed: CircleDashed,
  unknown: CircleHelp,
};

const BADGE_TONES: Record<HostBadgeTone, string> = {
  error: "text-[#ff7b72]",
  attention: "text-[#e3b341]",
  muted: "text-[#6e7681]",
  neutral: "text-[#8b949e]",
};

/**
 * A host state's icon and colour class. A muted reading loses its colour as well as its weight,
 * so an old warning doesn't shout; the text beside the icon still says the state.
 */
export function hostStateLook(state: ShownHostState, tone: HostBadgeTone, muted: boolean): { Icon: LucideIcon; toneClass: string } {
  return { Icon: BADGE_ICONS[state], toneClass: muted ? `${BADGE_TONES.muted} opacity-60` : BADGE_TONES[tone] };
}

/**
 * A template's compact host badge. Its icon and colour are hidden from screen readers, which
 * read its text instead; the tooltip adds the host's reason and whether it may be out of date.
 */
export const HostBadgeView: FC<{ badge: HostBadge }> = ({ badge }) => {
  const { Icon, toneClass } = hostStateLook(badge.state, badge.tone, badge.muted);
  return (
    <span title={badge.title} className={`p-1 shrink-0 inline-flex ${toneClass}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="sr-only">{badge.text}</span>
    </span>
  );
};

const DOT_TONES: Record<HostTone, string> = {
  neutral: "bg-[#8b949e]",
  ok: "bg-[#3fb950]",
  error: "bg-[#f85149]",
  amber: "bg-[#e3b341]",
};

export interface HostGroupHeaderProps {
  header: HostGroupHeader;
  /** Rereads everything; resolves when the reads are done. */
  onCheckHost: () => Promise<void>;
  onRun: (command: InteractiveCommand) => void;
}

/** The Workflow templates group header's host condition, Check host, and the chip's action for it. */
export const HostGroupHeaderBar: FC<HostGroupHeaderProps> = ({ header, onCheckHost, onRun }) => {
  const [checking, setChecking] = useState(false);
  // A check that ends after the header is gone doesn't set its state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    setChecking(true);
    void onCheckHost().finally(() => {
      if (mounted.current) setChecking(false);
    });
  };
  return (
    <div className="mx-3 mb-1 flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[#8b949e]">
          <span className={`w-1.5 h-1.5 rounded-full ${DOT_TONES[header.tone]}`} aria-hidden="true" />
          <span className="sr-only">Praxis host: </span>
          {header.condition}
        </span>
        <button
          type="button"
          onClick={check}
          disabled={checking}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {checking ? "Checking…" : header.checkHostLabel}
        </button>
        {header.action && <HostActionButton action={header.action} onRun={onRun} />}
      </div>
      {header.linkCli && (
        <div className="text-[#8b949e] break-words">
          <p>{header.linkCli.text}</p>
          <p>{header.linkCli.reason}</p>
        </div>
      )}
    </div>
  );
};

/**
 * The collapsed On host only subsection: host templates with no local file, read-only. Selecting
 * one opens its read-only panel under it. There's no import and no delete.
 */
export const HostOnlySubsection: FC<{ section: HostOnlySection }> = ({ section }) => {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const panelId = `${baseId}-panel`;
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1 px-3 py-1 text-left text-[11px] text-[#8b949e] hover:text-white hover:bg-[#21262d]"
      >
        {expanded ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
        {section.title}
      </button>
      {expanded && (
        <ul id={listId} aria-label="Workflow templates on the host only">
          {section.rows.map((row) => {
            const open = selected === row.name;
            return (
              <li key={row.name}>
                <div className="flex items-center pr-1.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={open ? panelId : undefined}
                    onClick={() => setSelected(open ? null : row.name)}
                    className={`flex-1 min-w-0 ml-1.5 px-2 py-1 rounded text-left text-xs font-mono truncate hover:bg-[#21262d] ${
                      open ? "text-white bg-[#21262d]" : "text-[#8b949e]"
                    }`}
                  >
                    {row.name}
                  </button>
                  {row.invalid && <HostBadgeView badge={row.invalid} />}
                </div>
                {open && (
                  <dl
                    id={panelId}
                    aria-label={`${row.name} on the host`}
                    className="mx-3 my-1 p-2 rounded border border-[#30363d] bg-[#161b22] text-[11px] grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
                  >
                    {hostOnlyDetails(row.template).map((d) => (
                      <div key={d.label} className="contents">
                        <dt className="text-[#6e7681]">{d.label}</dt>
                        <dd className="text-[#c9d1d9] break-words">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {expanded && section.omitted > 0 && (
        <p className="mx-3 mt-1 text-[10px] text-[#e3b341]">
          Showing the first {section.rows.length}. The host holds {section.omitted} more.
        </p>
      )}
    </div>
  );
};
