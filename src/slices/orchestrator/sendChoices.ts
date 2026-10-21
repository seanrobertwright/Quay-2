import type { TerminalInfo } from "../terminal/types";

type Agent = Pick<TerminalInfo, "id" | "claude_status">;

/** The agents To Agent offers: live ones, since Quay refuses a message to a terminal
 *  that has exited, and not From Agent's unless the message is dispatched as the user. */
export function toAgentChoices<T extends Agent>(agents: readonly T[], from: string, asUser: boolean): T[] {
  return agents.filter((t) => t.claude_status !== "exited" && (asUser || t.id !== from));
}

/** From Agent and To Agent kept on `agents`, the active project's peers. A To Agent that
 *  is no longer a choice moves to the first live peer other than From Agent, or to none. */
export function keepSendChoices(
  agents: readonly Agent[],
  from: string,
  to: string,
  asUser: boolean,
): { from: string; to: string } {
  const keptFrom = agents.some((t) => t.id === from) ? from : agents[0]?.id || "";
  const keptTo = toAgentChoices(agents, keptFrom, asUser).some((t) => t.id === to)
    ? to
    : toAgentChoices(agents, keptFrom, false)[0]?.id || "";
  return { from: keptFrom, to: keptTo };
}
