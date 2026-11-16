import type { ChangeEvent } from "react";
import type { GithubIssue } from "../github/types.ts";
import type { LinkRef, TerminalInfo } from "../terminal/types.ts";
import { SplitButton } from "../companion/SplitButton.tsx";
import type { TicketActions, TicketToStart } from "../companion/TicketView.tsx";
import { CLOSE_REASONS, CLOSE_REASON_TEXT, type CloseReason } from "../companion/ticketStatus.ts";
import { moreLabel, type LaneStepTone, type NeedsYou, type PipelineList, type PipelineLists, type TicketLane } from "./ticketLane.ts";

/** What the Projects panel's ticket pipeline reads and does. */
export interface ProjectsPipeline {
  /** The lane a terminal row shows, or null for a plain shell. */
  laneOf: (terminal: TerminalInfo) => TicketLane | null;
  /** The lists under a project's terminals, with whether every open ticket was read; null while unread. */
  listsOf: (projectPath: string) => { lists: PipelineLists; complete: boolean } | null;
  /** Starts the Merge undo window for the lane terminal's pull request. */
  onMerge: (terminal: TerminalInfo) => void;
  /** Opens a ticket in the companion, such as a listed ticket or a lane's blocker. */
  onOpenTicket: (repoPath: string, ref: LinkRef) => void;
  onClose: (repoPath: string, ref: LinkRef, reason: CloseReason) => void;
  /** The Implement split button's ways to start a ready ticket. */
  start: TicketActions;
  /** The +N link: the rest of the tickets, in the Source control panel. */
  onMore: () => void;
}

const STEP_TONE: Record<LaneStepTone, string> = {
  done: "bg-[#3fb950]",
  current: "bg-[#58a6ff] shadow-[0_0_6px_#58a6ff]",
  blocked: "bg-[#f85149] shadow-[0_0_6px_#f85149]",
  failing: "bg-[#f85149] shadow-[0_0_6px_#f85149]",
  todo: "bg-[#30363d]",
};

const CHIP_TONE: Record<NeedsYou, string> = {
  Waiting: "border-[#d29922] text-[#e3b341]",
  Merge: "border-[#3fb950] text-[#3fb950]",
  Failing: "border-[#f85149] text-[#f85149]",
};

const SMALL_BUTTON = "shrink-0 h-6 px-1.5 rounded border border-[#30363d] bg-[#21262d] text-[11px] text-[#c9d1d9] hover:bg-[#30363d]";

/** The Close control: a pick of completed, not planned or duplicate closes the ticket with it. */
const CloseSelect = ({ number, onClose }: { number: number; onClose: (reason: CloseReason) => void }) => (
  <select
    aria-label={`Close #${number}`}
    title={`Close #${number} as…`}
    value=""
    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
      const reason = CLOSE_REASONS.find((r) => r === e.target.value);
      if (reason) onClose(reason);
    }}
    className="shrink-0 h-6 max-w-[64px] rounded border border-[#30363d] bg-[#21262d] text-[11px] text-[#c9d1d9]"
  >
    <option value="">Close</option>
    {CLOSE_REASONS.map((reason) => (
      <option key={reason} value={reason}>
        {CLOSE_REASON_TEXT[reason]}
      </option>
    ))}
  </select>
);

/** The assignee's avatar: their initial in a circle, named for screen readers. */
const Avatar = ({ login }: { login: string }) => (
  <span
    role="img"
    data-assignee
    aria-label={`Assigned to ${login}`}
    title={`Assigned to ${login}`}
    className="shrink-0 w-4 h-4 rounded-full bg-[#30363d] text-[9px] leading-4 text-center font-semibold text-white uppercase"
  >
    {login.slice(0, 1)}
  </span>
);

const BlockerButton = ({ blocker, onOpen }: { blocker: LinkRef; onOpen: () => void }) => (
  <button
    type="button"
    aria-label={`Jump to the blocker #${blocker.number}`}
    title={`Open blocker #${blocker.number} in the companion`}
    onClick={onOpen}
    className="shrink-0 px-1 rounded text-[11px] font-mono text-[#f85149] hover:bg-[#f8514926]"
  >
    #{blocker.number}
  </button>
);

/**
 * A terminal row's lane: ticket number and title with the assignee and the age in the current
 * step; the four-step bar with its labels; then the state line, the needs-you chip and the moves.
 */
export const LaneView = ({
  terminal,
  lane,
  isActive,
  onSelect,
  pipeline,
}: {
  terminal: TerminalInfo;
  lane: TicketLane;
  isActive: boolean;
  onSelect: () => void;
  pipeline: ProjectsPipeline;
}) => {
  const repoPath = terminal.project_path;
  return (
    <div
      data-lane={terminal.id}
      className={`ml-5 mr-1 mb-1 px-1.5 py-1 rounded border text-[11px] ${isActive ? "border-[#58a6ff]/60 bg-[#1f6feb14]" : "border-[#30363d]/60"}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          aria-label={`Select ${terminal.name}: #${lane.number} ${lane.title}`}
          onClick={onSelect}
          className="min-w-0 flex-1 truncate text-left text-[#c9d1d9] hover:text-white"
        >
          <span className="font-mono text-[#8b949e]">#{lane.number}</span> {lane.title}
        </button>
        {lane.assignee && <Avatar login={lane.assignee} />}
        <span data-age title="Time in this step" className="shrink-0 text-[10px] text-[#8b949e]">
          {lane.age}
        </span>
      </div>
      <ol aria-label={`Steps of #${lane.number}`} className="mt-1 grid grid-cols-4 gap-0.5">
        {lane.steps.map((step) => (
          <li key={step.id} className="min-w-0">
            <span aria-hidden className={`block h-1 rounded-full ${STEP_TONE[step.tone]}`} />
            <span
              data-step
              data-tone={step.tone}
              aria-current={step.id === lane.current ? "step" : undefined}
              className={`block truncate text-[9px] ${step.tone === "todo" ? "text-[#6e7681]" : "text-[#c9d1d9]"}`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-0.5 flex items-center gap-1 min-w-0">
        <span className="min-w-0 flex-1 truncate text-[#8b949e]" title={lane.stateLine}>
          {lane.stateLine}
        </span>
        {lane.needsYou && (
          <span data-needs-you className={`shrink-0 px-1 rounded border text-[10px] ${CHIP_TONE[lane.needsYou]}`}>
            {lane.needsYou}
          </span>
        )}
        {lane.blocker && <BlockerButton blocker={lane.blocker} onOpen={() => pipeline.onOpenTicket(repoPath, lane.blocker!)} />}
        {lane.canMerge && (
          <button type="button" aria-label={`Merge #${lane.number}`} onClick={() => pipeline.onMerge(terminal)} className={SMALL_BUTTON}>
            Merge
          </button>
        )}
        {lane.current !== "merged" && (
          <CloseSelect number={lane.number} onClose={(reason) => pipeline.onClose(repoPath, { repo: null, number: lane.number }, reason)} />
        )}
      </div>
    </div>
  );
};

const START_ITEMS = [
  { key: "implement", label: "Implement" },
  { key: "triage", label: "Triage" },
  { key: "newWorktree", label: "New worktree" },
] as const;

/** One ticket in Ready to start or Blocked: its number and title, then Implement or its blocker, and Close. */
const ListedTicket = ({ repoPath, issue, ready, pipeline }: { repoPath: string; issue: GithubIssue; ready: boolean; pipeline: ProjectsPipeline }) => {
  const ticket: TicketToStart = { repoPath, repo: null, number: issue.number, title: issue.title };
  const blocker = issue.blockedBy[0];
  return (
    <li data-ticket={issue.number} className="flex items-center gap-1 min-w-0 py-0.5">
      <button
        type="button"
        aria-label={`#${issue.number} ${issue.title}`}
        title="Open in the companion"
        onClick={() => pipeline.onOpenTicket(repoPath, { repo: null, number: issue.number })}
        className="min-w-0 flex-1 truncate text-left text-[11px] text-[#c9d1d9] hover:text-white"
      >
        <span className="font-mono text-[#8b949e]">#{issue.number}</span> {issue.title}
      </button>
      {ready && (
        <SplitButton
          label="Implement"
          onMain={() => pipeline.start.implement(ticket)}
          toggleLabel={`More ways to start #${issue.number}`}
          menuLabel="Start"
          items={START_ITEMS}
          onPick={(key) => pipeline.start[key](ticket)}
          tone="secondary"
        />
      )}
      {!ready && blocker && (
        <BlockerButton blocker={{ repo: blocker.repoNwo || null, number: blocker.number }} onOpen={() => pipeline.onOpenTicket(repoPath, { repo: blocker.repoNwo || null, number: blocker.number })} />
      )}
      <CloseSelect number={issue.number} onClose={(reason) => pipeline.onClose(repoPath, { repo: null, number: issue.number }, reason)} />
    </li>
  );
};

const ListSection = ({
  name,
  list,
  complete,
  repoPath,
  ready,
  pipeline,
}: {
  name: string;
  list: PipelineList;
  complete: boolean;
  repoPath: string;
  ready: boolean;
  pipeline: ProjectsPipeline;
}) => (
  <section aria-label={name} className="mt-1">
    <h4 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]">{name}</h4>
    {list.shown.length === 0 ? (
      <p className="px-1 text-[11px] text-[#6e7681]">None</p>
    ) : (
      <ul className="px-1">
        {list.shown.map((issue) => (
          <ListedTicket key={issue.number} repoPath={repoPath} issue={issue} ready={ready} pipeline={pipeline} />
        ))}
      </ul>
    )}
    {list.more > 0 && (
      <button
        type="button"
        title="The rest in Source control"
        onClick={() => pipeline.onMore()}
        className="ml-1 text-[11px] text-[#58a6ff] hover:underline"
      >
        {moreLabel(list.more, complete)}
      </button>
    )}
  </section>
);

/** Ready to start and Blocked under a project's terminals, and the Merged today count. */
export const PipelineSection = ({ projectPath, pipeline }: { projectPath: string; pipeline: ProjectsPipeline }) => {
  const read = pipeline.listsOf(projectPath);
  if (!read) return null;
  const { lists, complete } = read;
  return (
    <div data-pipeline className="mt-2 pt-1 border-t border-[#30363d]/40">
      <ListSection name="Ready to start" list={lists.ready} complete={complete} repoPath={projectPath} ready pipeline={pipeline} />
      <ListSection name="Blocked" list={lists.blocked} complete={complete} repoPath={projectPath} ready={false} pipeline={pipeline} />
      {lists.mergedToday > 0 && <p className="mt-1 px-1 text-[11px] text-[#a371f7]">Merged today · {lists.mergedToday}</p>}
    </div>
  );
};
