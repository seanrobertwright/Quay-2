// The one place a conflict's "Hand to agent" action is wired (#352). Its flow, picking an agent
// terminal in this worktree or starting one and sending it a resolve-and-stage-only prompt, is
// issue #392's; until that lands, the action renders disabled with the reason below.

export interface HandToAgent {
  /** Hands `paths` to an agent, or null while the flow isn't available. */
  hand: ((paths: string[]) => void) | null;
  /** Why the action is disabled, shown as its tooltip and description, or null when it isn't. */
  unavailable: string | null;
}

const NOT_YET: HandToAgent = {
  hand: null,
  unavailable: "Handing a conflict to an agent isn't available in this version of Quay yet. Open a terminal and run your agent there.",
};

/** The Hand to agent action for conflicts. #392 adds the worktree it hands them to. */
export function useHandToAgent(): HandToAgent {
  return NOT_YET;
}
