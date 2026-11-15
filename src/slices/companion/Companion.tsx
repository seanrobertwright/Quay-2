import { useMemo, useRef, useState } from "react";
import type { LinkRef, LinkSlotName, TerminalInfo, TerminalLink } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import {
  clampCompanionWidth,
  companionWidthByKey,
  MAX_COMPANION_WIDTH,
  MIN_COMPANION_WIDTH,
  type CompanionPrefs,
} from "./companionPrefs.ts";
import { REPOSITORY_VIEW_ID, firstView, switchableViews, type CompanionView, type CompanionViewId } from "./companionViews.ts";
import { terminalRepository, type TerminalRepository } from "./terminalRepository.ts";
import { RepositoryView } from "./RepositoryView.tsx";
import { PullRequestView } from "./PullRequestView.tsx";
import { TerminalLinkBar } from "./TerminalLinkBar.tsx";
import { LinkToPicker } from "./LinkToPicker.tsx";
import type { LinkChoice } from "./linkChoices.ts";

/** What the companion reads and changes about terminal links. */
export interface CompanionLinking {
  /** The terminal's link as last resolved, or null when it has none. */
  linkOf: (terminal: TerminalInfo) => TerminalLink | null;
  pin: (terminalId: string, slot: LinkSlotName, ref: LinkRef) => void;
  unpin: (terminalId: string, slot: LinkSlotName) => void;
  /** What Link to... offers the terminal: guesses when `query` is empty, else search results. */
  choices: (terminal: TerminalInfo, query: string) => readonly LinkChoice[];
  /** Fetches what Link to... offers the terminal. */
  loadChoices: (terminal: TerminalInfo) => void;
}

/** What the companion knows about the selected terminal, handed to each view. */
export interface CompanionContext {
  terminal: TerminalInfo;
  repository: TerminalRepository;
  /** The terminal's link, or null when it has none. */
  link: TerminalLink | null;
  /** Terminal links, or null where the companion has none to change (as in some tests). */
  linking: CompanionLinking | null;
}

/** Whether `link` fills either slot. */
export function isLinked(link: TerminalLink | null): boolean {
  return !!(link?.ticket || link?.pull_request);
}

/**
 * The Repository view: the selected terminal's repository, with a Link to... control while the
 * terminal has no link.
 */
export const REPOSITORY_VIEW: CompanionView<CompanionContext> = {
  id: REPOSITORY_VIEW_ID,
  label: "Repository",
  available: () => true,
  render: ({ terminal, repository, link, linking }) => (
    <RepositoryView terminal={terminal} repository={repository}>
      {linking && !isLinked(link) && (
        <LinkToPicker
          choices={(query) => linking.choices(terminal, query)}
          onOpen={() => linking.loadChoices(terminal)}
          onPick={(slot, ref) => linking.pin(terminal.id, slot, ref)}
        />
      )}
    </RepositoryView>
  ),
};

/**
 * The Pull request view: the terminal's pull request slot, with its header and readiness card.
 * Keyed by the pull request, so another one starts with a fresh merge control.
 */
export const PULL_REQUEST_VIEW: CompanionView<CompanionContext> = {
  id: "pull-request",
  label: "Pull request",
  available: ({ link }) => !!link?.pull_request,
  render: ({ repository, link }) => {
    const slot = link?.pull_request;
    if (!slot) return null;
    return (
      <PullRequestView
        key={`${repository.path}|${slot.repo ?? ""}#${slot.number}`}
        repoPath={repository.path}
        repo={slot.repo}
        number={slot.number}
      />
    );
  },
};

/**
 * The views the companion registers, in the order its view switch lists them. Each later view
 * (Ticket, Activity, Run, Topos, Inspector) is added here.
 */
export const COMPANION_VIEWS: readonly CompanionView<CompanionContext>[] = [PULL_REQUEST_VIEW, REPOSITORY_VIEW];

/** The divider's hit area and the line it draws, in CSS px. */
const DIVIDER_HIT_WIDTH = 9;
const DIVIDER_LINE_WIDTH = 1;

interface CompanionProps {
  /** The selected terminal, or null when there is none. */
  selectedTerminal: TerminalInfo | null;
  projects: readonly Project[];
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>;
  /** The registered views, in the order the view switch lists them. */
  views: readonly CompanionView<CompanionContext>[];
  prefs: CompanionPrefs;
  /** Terminal links; without it the companion shows none. */
  linking?: CompanionLinking | null;
}

/** The right-hand column that shows what the selected terminal is working on. */
export const Companion = ({ selectedTerminal, projects, projectWorktrees, views, prefs, linking = null }: CompanionProps) => {
  const [width, setWidth] = useState(() => prefs.readWidth());
  const context = useMemo<CompanionContext | null>(
    () =>
      selectedTerminal
        ? {
            terminal: selectedTerminal,
            repository: terminalRepository(selectedTerminal, projects, projectWorktrees),
            link: linking ? linking.linkOf(selectedTerminal) : (selectedTerminal.link ?? null),
            linking,
          }
        : null,
    [selectedTerminal, projects, projectWorktrees, linking],
  );
  // The view picked on the switch holds while its terminal stays selected and still has it.
  // Selecting another terminal forgets it, so every selection starts from the first view.
  const [picked, setPicked] = useState<{ terminalId: string; view: CompanionViewId } | null>(null);
  const selectedId = context?.terminal.id ?? null;
  if (picked && picked.terminalId !== selectedId) setPicked(null);
  const choices = context ? switchableViews(views, context) : [];
  const pickedView =
    context && picked?.terminalId === context.terminal.id ? choices.find((view) => view.id === picked.view) : undefined;
  const shownId = pickedView?.id ?? (context ? firstView(views, context, prefs.readOpensOn()) : null);
  const shown = views.find((view) => view.id === shownId) ?? null;
  const resize = (next: number) => {
    setWidth(next);
    prefs.writeWidth(next);
  };
  return (
    <aside
      aria-label="Companion"
      style={{ width }}
      className="relative shrink-0 h-full min-h-0 flex flex-col bg-[#0d1117] border-l border-[#30363d]"
    >
      <CompanionDivider width={width} onResize={setWidth} onCommit={resize} />
      {context && shown && (
        <header className="shrink-0 flex flex-col border-b border-[#30363d] bg-[#161b22]">
          <div className="h-12 px-3 flex items-center">
            <ViewSwitch
              views={choices}
              shown={shown.id}
              onPick={(view) => setPicked({ terminalId: context.terminal.id, view })}
            />
          </div>
          {context.link && (
            <TerminalLinkBar
              link={context.link}
              onPin={(slot, ref) => linking?.pin(context.terminal.id, slot, ref)}
              onUnpin={(slot) => linking?.unpin(context.terminal.id, slot)}
            />
          )}
        </header>
      )}
      {context && shown ? (
        <section
          data-companion-view={shown.id}
          aria-label={shown.label}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          {shown.render(context)}
        </section>
      ) : (
        <p className="p-4 text-xs text-[#8b949e]">Select a terminal to see what it is working on.</p>
      )}
    </aside>
  );
};

/**
 * The companion header's view switch: one radio per view the selected terminal has, the shown one
 * checked. Arrow keys move the choice and focus together, as in a radio group.
 */
const ViewSwitch = ({
  views,
  shown,
  onPick,
}: {
  views: readonly CompanionView<CompanionContext>[];
  shown: CompanionViewId;
  onPick: (view: CompanionViewId) => void;
}) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, by: number) => {
    const next = (from + by + views.length) % views.length;
    onPick(views[next].id);
    buttons.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Companion view" className="flex items-stretch gap-1 h-full min-w-0 overflow-x-auto">
      {views.map((view, index) => {
        const checked = view.id === shown;
        return (
          <button
            key={view.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onPick(view.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(index, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(index, -1);
              }
            }}
            className={`shrink-0 min-w-10 px-2.5 text-xs border-b-2 transition-colors ${
              checked ? "border-[#58a6ff] text-white" : "border-transparent text-[#8b949e] hover:text-white"
            }`}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
};

/**
 * The companion's left edge, a focusable window splitter: drag it, or use the arrow keys, to
 * resize the companion. Its hit area is several times the line it draws.
 */
const CompanionDivider = ({
  width,
  onResize,
  onCommit,
}: {
  width: number;
  /** A width while a drag is under way. */
  onResize: (width: number) => void;
  /** A width the operator settled on, which the companion remembers. */
  onCommit: (width: number) => void;
}) => {
  const drag = useRef<{ pointerId: number; x: number; width: number; last: number } | null>(null);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA 1.2 focusable window splitter (separator with aria-valuenow)
    <div role="separator" tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize the companion"
      aria-valuenow={width}
      aria-valuemin={MIN_COMPANION_WIDTH}
      aria-valuemax={MAX_COMPANION_WIDTH}
      aria-valuetext={`${width} px`}
      title="Drag, or use the arrow keys, to resize the companion"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { pointerId: e.pointerId, x: e.clientX, width, last: width };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        d.last = clampCompanionWidth(d.width - (e.clientX - d.x));
        onResize(d.last);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        drag.current = null;
        onCommit(d.last);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d) onCommit(d.last);
      }}
      onKeyDown={(e) => {
        const next = companionWidthByKey(width, e.key, e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        onCommit(next);
      }}
      style={{ width: DIVIDER_HIT_WIDTH, marginLeft: -Math.ceil(DIVIDER_HIT_WIDTH / 2) }}
      className="group/handle absolute top-0 bottom-0 left-0 z-20 cursor-col-resize flex justify-center outline-none touch-none"
    >
      <div
        style={{ width: DIVIDER_LINE_WIDTH }}
        className="h-full group-hover/handle:bg-[#58a6ff] group-focus-visible/handle:bg-[#58a6ff] group-focus-visible/handle:outline group-focus-visible/handle:outline-1 group-focus-visible/handle:outline-[#58a6ff]"
      />
    </div>
  );
};
