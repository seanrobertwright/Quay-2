import { useId, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GithubRepoInfo, IssueStatus } from "../github/types.ts";
import type { LinkRef } from "../terminal/types.ts";
import { formatDateTime, formatRelative, parseUtcTimestamp } from "../../lib/dates.ts";
import {
  CLOSE_REASON_TEXT,
  issueArrivalCell,
  issueCells,
  statusCard,
  type IssueCell,
  type IssueCellId,
  type IssueCellTone,
  type StatusTone,
} from "./issueStatus.ts";
import { IssueCellDetail } from "./IssueCellDetail.tsx";
import { useGithubRead } from "./useGithubRead.ts";
import { SplitButton } from "./SplitButton.tsx";
import { Failure, useAction } from "./PullRequestView.tsx";

/** Where a ticket lives: the folder `gh` runs in, the slot's repository when it names one, and its number. */
export interface IssueLocation {
  repoPath: string;
  /** `owner/name`, or null for the repository at `repoPath`. */
  repo: string | null;
  number: number;
}

/** The ticket a start action works on. */
export interface TicketToStart extends IssueLocation {
  title: string;
}

/** The ways the status card starts work on a ticket, from the Implement split button. */
export interface TicketActions {
  implement: (ticket: TicketToStart) => void;
  triage: (ticket: TicketToStart) => void;
  newWorktree: (ticket: TicketToStart) => void;
}

type StartKey = keyof TicketActions;
const START_ITEMS: readonly { key: StartKey; label: string }[] = [
  { key: "implement", label: "Implement" },
  { key: "triage", label: "Triage" },
  { key: "newWorktree", label: "New worktree" },
];

/** What the issue view asks of the companion around it. */
export interface IssueViewProps extends IssueLocation {
  /** Starts work on the ticket; without it the card offers no Implement. */
  actions?: TicketActions | null;
  /** Shows another ticket, such as a blocker, in the companion; without it none is offered. */
  showTicket?: ((ref: LinkRef) => void) | null;
  /** Shows a pull request in the companion; without it none is offered. */
  showPullRequest?: ((ref: LinkRef) => void) | null;
}

/** What the view's parts are handed to act with. */
export interface Acting {
  location: IssueLocation;
  actions: TicketActions | null;
  showTicket: ((ref: LinkRef) => void) | null;
  showPullRequest: ((ref: LinkRef) => void) | null;
  /** Reads the ticket again, after a change to it. */
  onChanged: () => void;
}

const BUTTON = "h-7 px-3 rounded-md border text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const SECONDARY = `${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] enabled:hover:bg-[#30363d]`;

const MUTED = "text-[#8b949e]";

const HEADLINE_TONE: Record<StatusTone, string> = {
  ready: "text-[#3fb950]",
  blocked: "text-[#f85149]",
  progress: "text-[#d29922]",
  closed: "text-[#a371f7]",
};

/**
 * The companion's issue view: GitHub's header, then the status card, then the open cell's detail,
 * or the description while no cell is open.
 */
export const IssueView = ({ actions = null, showTicket = null, showPullRequest = null, ...location }: IssueViewProps) => {
  const read = useGithubRead<IssueStatus>("get_github_issue_status", { ...location });
  const issue = read.data;
  if (!issue) {
    return (
      <p role={read.error ? "alert" : undefined} className={`p-4 text-xs ${MUTED}`}>
        {read.error
          ? `Could not read ticket #${location.number}: ${read.error}`
          : read.loading
            ? `Reading ticket #${location.number}…`
            : null}
      </p>
    );
  }
  return (
    <IssueBody
      issue={issue}
      error={read.error}
      acting={{ location, actions, showTicket, showPullRequest, onChanged: read.reload }}
    />
  );
};

/**
 * The view once the ticket is read. It mounts on the first answer, so the cell it opens on arrival
 * comes from that answer and a later refresh leaves the operator's choice alone.
 */
const IssueBody = ({ issue, error, acting }: { issue: IssueStatus; error: string | null; acting: Acting }) => {
  const [arrival] = useState(() => issueArrivalCell(issue));
  const [open, setOpen] = useState<IssueCellId | null>(arrival);
  const detailId = useId();
  return (
    <div className="p-3 space-y-3 text-xs">
      <IssueHeader issue={issue} />
      {error && (
        <p role="alert" className="text-[#f85149]">
          Could not refresh: {error}
        </p>
      )}
      <StatusCardView issue={issue} acting={acting}>
        <ul className="grid grid-cols-4 border-t border-[#30363d]">
          {issueCells(issue).map((cell) => (
            <Cell
              key={cell.id}
              cell={cell}
              open={open === cell.id}
              detailId={detailId}
              onToggle={() => setOpen((current) => (current === cell.id ? null : cell.id))}
            />
          ))}
        </ul>
      </StatusCardView>
      {open ? (
        <IssueCellDetail key={open} cell={open} id={detailId} issue={issue} acting={acting} />
      ) : (
        issue.body.trim() !== "" && (
          <section aria-label="Description" className="whitespace-pre-wrap break-words text-[#c9d1d9]">
            {issue.body}
          </section>
        )
      )}
    </div>
  );
};

const CELL_TONE: Record<IssueCellTone, string> = {
  alert: "text-[#f85149]",
  attention: "text-[#d29922]",
  neutral: "text-white",
};

/** One of the card's cells: its name and what it holds, on a button that opens and closes its detail. */
const Cell = ({ cell, open, detailId, onToggle }: { cell: IssueCell; open: boolean; detailId: string; onToggle: () => void }) => (
  <li data-issue-cell={cell.id} className="min-w-0 border-r last:border-r-0 border-[#30363d]">
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? detailId : undefined}
      onClick={onToggle}
      className={`block w-full p-2 space-y-1 text-left hover:bg-[#1c2128] ${open ? "bg-[#1f6feb1a] shadow-[inset_0_-2px_0_#58a6ff]" : ""}`}
    >
      <span className={`block ${MUTED}`}>{cell.label}</span>
      <span className={`block truncate font-semibold ${CELL_TONE[cell.tone]}`}>{cell.value}</span>
    </button>
  </li>
);

/** The state pill's words and colour: Open, Closed, or Closed as not planned or as duplicate. */
function pill(issue: IssueStatus): { label: string; className: string } {
  if (issue.state === "OPEN") return { label: "Open", className: "bg-[#238636]" };
  if (issue.stateReason === "NOT_PLANNED" || issue.stateReason === "DUPLICATE") {
    return { label: `Closed as ${CLOSE_REASON_TEXT[issue.stateReason]}`, className: "bg-[#6e7681]" };
  }
  return { label: "Closed", className: "bg-[#8957e5]" };
}

/** GitHub's issue header: title and number, state pill, type, and who opened it when. */
const IssueHeader = ({ issue }: { issue: IssueStatus }) => {
  const p = pill(issue);
  const opened = parseUtcTimestamp(issue.createdAt);
  return (
    <header data-issue-header className="space-y-2">
      <h2 className="text-sm font-semibold text-white break-words">
        {issue.title} <span className={`font-normal ${MUTED}`}>#{issue.number}</span>
      </h2>
      <div className={`flex flex-wrap items-center gap-1.5 ${MUTED}`}>
        <span data-state-pill className={`rounded-full px-2 py-0.5 font-medium text-white ${p.className}`}>
          {p.label}
        </span>
        {issue.issueType && (
          <span data-issue-type className="rounded-full border border-[#30363d] px-2 py-0.5 text-[#c9d1d9]">
            {issue.issueType}
          </span>
        )}
        <span>
          {issue.author === issue.viewer ? "you" : issue.author} opened this
          {opened !== null && (
            <>
              {" "}
              <time dateTime={issue.createdAt} title={formatDateTime(opened)}>
                {formatRelative(opened)}
              </time>
            </>
          )}
        </span>
      </div>
    </header>
  );
};

/**
 * The Implement split button. Work starts in the terminal's repository, so a ticket the slot places
 * in another repository offers none and says where it lives instead.
 */
const StartWork = (props: { ticket: TicketToStart; ticketRepo: string; actions: TicketActions }) =>
  props.ticket.repo === null ? <StartButton {...props} /> : <StartIfHere {...props} />;

/** Implement, for a slot that names a repository: only when it is the terminal's own. */
const StartIfHere = (props: { ticket: TicketToStart; ticketRepo: string; actions: TicketActions }) => {
  const here = useGithubRead<GithubRepoInfo | null>("get_github_repo_info", { repoPath: props.ticket.repoPath });
  if (here.loading && !here.data) return null;
  if (here.data?.nwo.toLowerCase() === props.ticketRepo.toLowerCase()) return <StartButton {...props} />;
  return (
    <p className={MUTED}>
      {props.ticketRepo} is not this terminal's repository; start it from a clone of that repository.
    </p>
  );
};

const StartButton = ({ ticket, actions }: { ticket: TicketToStart; actions: TicketActions }) => (
  <SplitButton
    label="Implement"
    onMain={() => actions.implement(ticket)}
    toggleLabel="More ways to start"
    menuLabel="Start"
    items={START_ITEMS}
    onPick={(key) => actions[key](ticket)}
  />
);

/** The status card: headline, its reason, and the one button that follows the ticket's state. */
const StatusCardView = ({ issue, acting, children }: { issue: IssueStatus; acting: Acting; children: ReactNode }) => {
  const verdict = statusCard(issue);
  const { busy, failure, run } = useAction(acting.onChanged);
  const ticket: TicketToStart = { ...acting.location, title: issue.title };
  const { actions, showTicket, showPullRequest } = acting;
  const action = verdict.action;
  return (
    <section aria-label="Status" className="rounded-md border border-[#30363d] bg-[#161b22]">
      <div className="p-3 space-y-2">
        <h3 className={`text-sm font-semibold ${HEADLINE_TONE[verdict.tone]}`}>{verdict.headline}</h3>
        {verdict.reason && <p className={MUTED}>{verdict.reason}</p>}
        {action.kind === "implement" && actions && <StartWork ticket={ticket} ticketRepo={issue.repo} actions={actions} />}
        {action.kind === "show-blocker" && showTicket && (
          <button
            type="button"
            title={`Pin #${action.blocker.number} to this terminal and show it`}
            onClick={() => showTicket({ repo: action.blocker.repo, number: action.blocker.number })}
            className={SECONDARY}
          >
            Show the blocker
          </button>
        )}
        {action.kind === "open-pull-request" && showPullRequest && (
          <button
            type="button"
            onClick={() => showPullRequest({ repo: action.pullRequest.repo, number: action.pullRequest.number })}
            className={SECONDARY}
          >
            Open pull request #{action.pullRequest.number}
          </button>
        )}
        {action.kind === "reopen" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run("Reopen", async () => {
                await invoke("reopen_github_issue", { ...acting.location });
                return null;
              })
            }
            className={SECONDARY}
          >
            Reopen
          </button>
        )}
        <Failure text={failure} />
      </div>
      {children}
    </section>
  );
};
