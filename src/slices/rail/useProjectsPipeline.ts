import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GithubIssue, PullRequestReadiness } from "../github/types.ts";
import type { LinkRef, TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import type { CompanionLinking } from "../companion/Companion.tsx";
import type { PullRequestLocation } from "../companion/usePullRequestReadiness.ts";
import type { CloseReason } from "../companion/ticketStatus.ts";
import { terminalRepository } from "../companion/terminalRepository.ts";
import { isSamePath } from "../../utils/paths.ts";
import { pipelineLists, ticketLane, type LaneInput } from "./ticketLane.ts";
import { pullRequestKey, usePipelineReads, type RepoTickets } from "./pipelineReads.ts";
import type { ProjectsPipeline } from "./TicketPipeline.tsx";

/** The moves the app makes for the pipeline, beyond what it reads. */
export type PipelineMoves = Omit<ProjectsPipeline, "laneOf" | "listsOf" | "onClose" | "onMerge"> & {
  /** Merges the lane terminal's pull request, as read for its lane. */
  onMerge: (terminal: TerminalInfo, at: PullRequestLocation, pr: PullRequestReadiness) => void;
};

/** The Projects panel's ticket pipeline, with the pull request each lane terminal's lane read. */
export interface ProjectsPipelineState {
  pipeline: ProjectsPipeline;
  /** Reads GitHub again, as after a merge or a close. */
  reload: () => void;
}

/** The tickets read for the repository at `root`. */
const ticketsAt = (tickets: Readonly<Record<string, RepoTickets>>, root: string): RepoTickets | undefined =>
  tickets[root] ?? Object.entries(tickets).find(([path]) => isSamePath(path, root))?.[1];

/** What the lane takes from a ticket as last listed. */
function laneTicket(issue: GithubIssue | undefined): LaneInput["ticket"] {
  if (!issue) return null;
  const blocker = issue.state === "OPEN" ? issue.blockedBy[0] : undefined;
  return {
    title: issue.title,
    assignee: issue.assignees[0]?.login ?? null,
    blocker: blocker ? { repo: blocker.repoNwo || null, number: blocker.number } : null,
  };
}

/**
 * The Projects panel's ticket pipeline: each terminal's lane from its link, its ticket as listed
 * and its pull request as read, and each project's Ready to start, Blocked and Merged today. Close
 * closes the ticket and reads GitHub again; the other moves are the app's.
 */
export function useProjectsPipeline(
  terminals: readonly TerminalInfo[],
  projects: readonly Project[],
  projectWorktrees: Readonly<Record<string, readonly GitWorktree[]>>,
  linking: CompanionLinking,
  waiting: (terminal: TerminalInfo) => boolean,
  moves: PipelineMoves,
): ProjectsPipelineState {
  const rootOf = useCallback(
    (terminal: TerminalInfo) => terminalRepository(terminal, projects, projectWorktrees).path,
    [projects, projectWorktrees],
  );
  // Only a lane's pull request is read: a terminal with a ticket slot and a pull request slot.
  const laneLocations = useMemo(
    () =>
      terminals.flatMap((terminal): (PullRequestLocation & { terminalId: string })[] => {
        const link = linking.linkOf(terminal);
        const pr = link?.ticket ? link.pull_request : null;
        return pr ? [{ terminalId: terminal.id, repoPath: rootOf(terminal), repo: pr.repo, number: pr.number }] : [];
      }),
    [terminals, linking, rootOf],
  );
  const repoPaths = useMemo(() => projects.map((p) => p.path), [projects]);
  const { tickets, readiness, reload } = usePipelineReads(repoPaths, laneLocations);

  const pipeline = useMemo<ProjectsPipeline>(() => {
    const locationOf = (terminal: TerminalInfo) => laneLocations.find((l) => l.terminalId === terminal.id) ?? null;
    const readOf = (terminal: TerminalInfo) => {
      const at = locationOf(terminal);
      return at ? (readiness[pullRequestKey(at)] ?? null) : null;
    };
    return {
      laneOf: (terminal) => {
        const link = linking.linkOf(terminal);
        const slot = link?.ticket;
        if (!slot) return null;
        const read = slot.repo === null ? ticketsAt(tickets, rootOf(terminal)) : undefined;
        const issue = read?.open.find((i) => i.number === slot.number) ?? read?.closed.find((i) => i.number === slot.number);
        return ticketLane({ link, ticket: laneTicket(issue), pullRequest: readOf(terminal), waiting: waiting(terminal), now: Date.now() });
      },
      listsOf: (projectPath) => {
        const read = ticketsAt(tickets, projectPath);
        if (!read) return null;
        const linked = new Set(
          terminals.flatMap((t) => {
            const slot = linking.linkOf(t)?.ticket;
            return slot && slot.repo === null && isSamePath(rootOf(t), projectPath) ? [slot.number] : [];
          }),
        );
        return {
          lists: pipelineLists({ open: read.open, openComplete: read.openComplete, closed: read.closed, viewer: read.viewer, linked, now: Date.now() }),
          complete: read.openComplete,
        };
      },
      onMerge: (terminal) => {
        const at = locationOf(terminal);
        const pr = readOf(terminal);
        if (at && pr) moves.onMerge(terminal, { repoPath: at.repoPath, repo: at.repo, number: at.number }, pr);
      },
      onOpenTicket: moves.onOpenTicket,
      onClose: (repoPath: string, ref: LinkRef, reason: CloseReason) => {
        invoke("close_github_issue", { repoPath, repo: ref.repo, number: ref.number, reason, comment: null })
          .then(reload)
          .catch((err) => {
            console.error(`Could not close #${ref.number}:`, err);
            alert(`Could not close #${ref.number}: ${err}`);
          });
      },
      start: moves.start,
      onMore: moves.onMore,
    };
  }, [laneLocations, readiness, tickets, terminals, linking, rootOf, waiting, moves, reload]);

  return { pipeline, reload };
}
