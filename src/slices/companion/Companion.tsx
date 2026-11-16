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
import { TicketView, type TicketActions } from "./TicketView.tsx";
import { TerminalLinkBar } from "./TerminalLinkBar.tsx";
import { LinkToPicker } from "./LinkToPicker.tsx";
import type { LinkChoice } from "./linkChoices.ts";
import { diffLensFor, type DiffLensTarget } from "./diffLensTarget.ts";
import { ToposViewSlot, type CompanionTopos } from "./ToposDock.tsx";
import { ActivityView, type ActivityFocus, type CompanionActivity } from "./ActivityView.tsx";

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

/** The diff lens as the companion sees it: which one is open, and how to open or close it. */
export interface CompanionLens {
  /** The diff lens open now, or null. */
  shown: DiffLensTarget | null;
  openDiff: (target: DiffLensTarget) => void;
  close: () => void;
}

/** What the companion knows about the selected terminal, handed to each view. */
export interface CompanionContext {
  terminal: TerminalInfo;
  repository: TerminalRepository;
  /** The terminal's link, or null when it has none. */
  link: TerminalLink | null;
  /** Terminal links, or null where the companion has none to change (as in some tests). */
  linking: CompanionLinking | null;
  /** The diff lens, or null where the companion opens none (as in some tests). */
  lens: CompanionLens | null;
  /** Starts work on a ticket, or null where the companion starts none (as in some tests). */
  ticketActions: TicketActions | null;
  /** Topos, or null where the companion shows none (as in some tests). */
  topos: CompanionTopos | null;
  /** What the Activity view reads, or null where the companion shows none (as in some tests). */
  activity: CompanionActivity | null;
  /** The Activity entry the latest show request asked for, or null. */
  focus: ActivityFocus | null;
  /** Shows `view` for the terminal, as the view switch does. */
  show: (view: CompanionViewId) => void;
}

/** Whether `slot` holds `ref`; a slot without a repository holds the terminal's own repository's. */
const holds = (slot: LinkRef | null | undefined, ref: LinkRef) =>
  !!slot && slot.number === ref.number && (slot.repo === null || ref.repo === null || slot.repo === ref.repo);

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
  render: ({ terminal, repository, link, lens, topos }) => {
    const slot = link?.pull_request;
    if (!slot) return null;
    return (
      <PullRequestView
        key={`${repository.path}|${slot.repo ?? ""}#${slot.number}`}
        repoPath={repository.path}
        repo={slot.repo}
        number={slot.number}
        lens={
          lens || topos
            ? {
                openOn: (file) => {
                  const target = diffLensFor(terminal.id, repository.path, link, file);
                  if (target) lens?.openDiff(target);
                },
                // A click on a readiness cell closes whichever lens is open.
                closeIfOpen: () => {
                  if (lens?.shown) lens.close();
                  if (topos?.wide) topos.closeWide();
                },
              }
            : null
        }
      />
    );
  },
};

/**
 * The Ticket view: the terminal's ticket slot, with its header and status card. Keyed by the
 * ticket, so another one starts with its own arrival cell.
 */
export const TICKET_VIEW: CompanionView<CompanionContext> = {
  id: "ticket",
  label: "Ticket",
  available: ({ link }) => !!link?.ticket,
  render: ({ terminal, repository, link, linking, ticketActions, show }) => {
    const slot = link?.ticket;
    if (!slot) return null;
    return (
      <TicketView
        key={`${repository.path}|${slot.repo ?? ""}#${slot.number}`}
        repoPath={repository.path}
        repo={slot.repo}
        number={slot.number}
        actions={ticketActions}
        showTicket={linking && ((ref) => linking.pin(terminal.id, "ticket", ref))}
        showPullRequest={(ref) => {
          if (!holds(link?.pull_request, ref)) linking?.pin(terminal.id, "pull_request", ref);
          show("pull-request");
        }}
      />
    );
  },
};

/**
 * The Topos view: the commit graph of the selected terminal's repository. Topos itself is drawn
 * once by the app and laid over this view's slot, so it keeps its state while the view is away.
 * The companion header's Wide toggle opens it as the Topos lens.
 */
export const TOPOS_VIEW: CompanionView<CompanionContext> = {
  id: "topos",
  label: "Topos",
  available: ({ topos }) => topos !== null,
  render: ({ topos }) => topos && <ToposViewSlot topos={topos} />,
};

/**
 * The Activity view: the selected terminal's tool calls and message trail, a message strip to send
 * it a task, and its pending permission requests answered in place. Keyed by the terminal, so
 * another one starts with its outputs folded and an empty strip.
 */
export const ACTIVITY_VIEW: CompanionView<CompanionContext> = {
  id: "activity",
  label: "Activity",
  available: ({ activity }) => activity !== null,
  render: ({ terminal, activity, focus }) =>
    activity && <ActivityView key={terminal.id} terminal={terminal} activity={activity} focus={focus} />,
};

/**
 * The views the companion registers, in the order its view switch lists them. Each later view
 * (Run, Inspector) is added here.
 */
export const COMPANION_VIEWS: readonly CompanionView<CompanionContext>[] = [
  PULL_REQUEST_VIEW,
  TICKET_VIEW,
  REPOSITORY_VIEW,
  ACTIVITY_VIEW,
  TOPOS_VIEW,
];

/**
 * A request from outside the companion, such as a pick in the Source control panel, to show `view`
 * for the terminal `terminalId`. Each new `seq` is a new request, so asking again for the view
 * already asked for shows it again after the operator switched away.
 */
export interface CompanionShowRequest {
  terminalId: string;
  view: CompanionViewId;
  /** The Activity entry to show, such as the message an Agents panel reply preview names. */
  entryId?: string;
  seq: number;
}

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
  /** The diff lens; without it the companion offers none. */
  lens?: CompanionLens | null;
  /** Starts work on a ticket; without it the Ticket view offers no Implement. */
  ticketActions?: TicketActions | null;
  /** Topos; without it the companion offers no Topos view. */
  topos?: CompanionTopos | null;
  /** What the Activity view reads; without it the companion offers no Activity view. */
  activity?: CompanionActivity | null;
  /** The latest request to show a view; one for a terminal other than the selected one is ignored. */
  showRequest?: CompanionShowRequest | null;
}

/** The right-hand column that shows what the selected terminal is working on. */
export const Companion = ({
  selectedTerminal,
  projects,
  projectWorktrees,
  views,
  prefs,
  linking = null,
  lens = null,
  ticketActions = null,
  topos = null,
  activity = null,
  showRequest = null,
}: CompanionProps) => {
  const [width, setWidth] = useState(() => prefs.readWidth());
  // The view picked on the switch holds while its terminal stays selected and still has it.
  // Selecting another terminal forgets it, so every selection starts from the first view.
  const [picked, setPicked] = useState<{ terminalId: string; view: CompanionViewId } | null>(null);
  // The Activity entry the latest request asked for, while its terminal stays selected.
  const [focus, setFocus] = useState<(ActivityFocus & { terminalId: string }) | null>(null);
  const context = useMemo<CompanionContext | null>(
    () =>
      selectedTerminal
        ? {
            terminal: selectedTerminal,
            repository: terminalRepository(selectedTerminal, projects, projectWorktrees),
            link: linking ? linking.linkOf(selectedTerminal) : (selectedTerminal.link ?? null),
            linking,
            lens,
            ticketActions,
            topos,
            activity,
            focus: focus?.terminalId === selectedTerminal.id ? focus : null,
            show: (view: CompanionViewId) => setPicked({ terminalId: selectedTerminal.id, view }),
          }
        : null,
    [selectedTerminal, projects, projectWorktrees, linking, lens, ticketActions, topos, activity, focus],
  );
  const selectedId = context?.terminal.id ?? null;
  // Each request is taken once, when it arrives, as if its view were picked on the switch.
  const [takenSeq, setTakenSeq] = useState<number | null>(null);
  if (showRequest && showRequest.seq !== takenSeq) {
    setTakenSeq(showRequest.seq);
    if (showRequest.terminalId === selectedId) {
      setPicked({ terminalId: showRequest.terminalId, view: showRequest.view });
      if (showRequest.entryId) setFocus({ terminalId: showRequest.terminalId, entryId: showRequest.entryId, seq: showRequest.seq });
    }
  }
  if (picked && picked.terminalId !== selectedId) setPicked(null);
  const choices = context ? switchableViews(views, context) : [];
  // While both slots are filled, the slot switch in the terminal link reaches the ticket, and the
  // view switch lists the pull request alone for the pair.
  const bothSlots = !!(context?.link?.ticket && context.link.pull_request);
  const viewChoices = bothSlots ? choices.filter((view) => view.id !== TICKET_VIEW.id) : choices;
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
              views={viewChoices}
              shown={shown.id}
              onPick={(view) => setPicked({ terminalId: context.terminal.id, view })}
            />
            <div className="ml-auto shrink-0 flex items-center gap-2 pl-2">
              {lens && <DiffLensToggle context={context} lens={lens} />}
              {topos && shown.id === TOPOS_VIEW.id && <WideToggle topos={topos} />}
            </div>
          </div>
          {context.link && (
            <TerminalLinkBar
              link={context.link}
              onPin={(slot, ref) => linking?.pin(context.terminal.id, slot, ref)}
              onUnpin={(slot) => linking?.unpin(context.terminal.id, slot)}
              slotSwitch={
                bothSlots
                  ? {
                      shown: shown.id === "ticket" ? "ticket" : shown.id === PULL_REQUEST_VIEW.id ? "pull_request" : null,
                      onPick: (slot) =>
                        setPicked({ terminalId: context.terminal.id, view: slot === "ticket" ? "ticket" : PULL_REQUEST_VIEW.id }),
                    }
                  : null
              }
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

/** The look of a companion header toggle such as Diff lens or Wide, pressed or not. */
const headerToggleClass = (pressed: boolean) =>
  `shrink-0 h-7 px-2.5 rounded-md border text-xs ${
    pressed ? "border-[#58a6ff] bg-[#1f6feb26] text-white" : "border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]"
  }`;

/**
 * The companion header's Diff lens button, while the selected terminal has a pull request: it
 * opens the diff lens on that pull request, and closes it while it is open.
 */
const DiffLensToggle = ({ context, lens }: { context: CompanionContext; lens: CompanionLens }) => {
  const target = diffLensFor(context.terminal.id, context.repository.path, context.link);
  if (!target) return null;
  const open = lens.shown !== null;
  return (
    <button
      type="button"
      aria-pressed={open}
      title={open ? "Close the diff lens" : "Open every diff of this pull request over the terminal"}
      onClick={() => (open ? lens.close() : lens.openDiff(target))}
      className={headerToggleClass(open)}
    >
      Diff lens
    </button>
  );
};

/**
 * The Topos view's Wide toggle in the companion header: it opens Topos as the Topos lens over the
 * terminal, and closes the lens while it is open.
 */
const WideToggle = ({ topos }: { topos: CompanionTopos }) => (
  <button
    type="button"
    aria-pressed={topos.wide}
    title={topos.wide ? "Close the Topos lens" : "Open Topos wide over the terminal"}
    onClick={() => (topos.wide ? topos.closeWide() : topos.openWide())}
    className={headerToggleClass(topos.wide)}
  >
    Wide
  </button>
);

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
