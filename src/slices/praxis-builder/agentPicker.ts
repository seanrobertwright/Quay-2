// The host's agent picker (#482): the agents its agent catalog offers, read with
// `praxis agents --json`, for the two fields that name a catalog agent, the agent id of a graph
// binding's Runs as entry and a workflow template's Agent. It gives them suggestions and warnings
// and nothing else: a warning never blocks a save, a submit or a run, and Praxis still checks
// agents when a run is attached. When the picker can't be read, for any reason, there is no
// picker, and the fields suggest only the ids the project already uses.
//
// The record's format, `aiws-agent-picker/1`, is PROVISIONAL in AI-WS-SDK. A record in another
// format, or one whose fields aren't the ones read here, is no picker.
import { invoke } from "@tauri-apps/api/core";
import { normalizePath } from "../../utils/paths.ts";
import { isObject } from "./model.ts";
import { praxisCall, type CallOutcome, type Invoker } from "./praxisHost.ts";
import type { Diagnostic } from "./types.ts";

/** The record format `praxis agents --json` prints. */
export const AGENT_PICKER_FORMAT = "aiws-agent-picker/1";

/** One agent the host's catalog offers. */
export interface PickerAgent {
  agentId: string;
  /** False when the host can't bind the agent. */
  selectable: boolean;
  /** The host's own words for why it can't. */
  reasons: readonly string[];
}

/** What a host said of its agent catalog. */
export interface AgentPicker {
  /** False when the host has no agent catalog; it then offers no agents. */
  catalog: boolean;
  /** The catalog's agents, in catalog order. */
  agents: readonly PickerAgent[];
}

function pickerAgent(value: unknown): PickerAgent | null {
  if (!isObject(value)) return null;
  const { agentId, selectable, reasons } = value;
  if (typeof agentId !== "string" || typeof selectable !== "boolean" || !Array.isArray(reasons)) return null;
  if (!reasons.every((r): r is string => typeof r === "string")) return null;
  return { agentId, selectable, reasons };
}

/** The picker in a `praxis_host_agents` outcome, or null when it holds none Quay can read. */
export function agentPickerOf(outcome: CallOutcome): AgentPicker | null {
  if (outcome.kind !== "record") return null;
  const { format, catalog, agents } = outcome.record;
  if (format !== AGENT_PICKER_FORMAT || typeof catalog !== "boolean" || !Array.isArray(agents)) return null;
  const read: PickerAgent[] = [];
  for (const agent of agents) {
    const one = pickerAgent(agent);
    if (!one) return null;
    read.push(one);
  }
  return { catalog, agents: read };
}

/** An agent id a field suggests. */
export interface AgentSuggestion {
  id: string;
  /** Said beside the id; set for an agent the host can't bind. */
  note?: string;
}

/** What a suggestion says of an agent the host can't bind. */
export const CANT_BE_BOUND = "can't be bound";

/** The most agent ids one field suggests. */
export const MAX_AGENT_SUGGESTIONS = 500;

/**
 * What an agent field suggests: the catalog's agents in catalog order, then the ids in `used`,
 * the ones the project already uses, that the catalog doesn't have, in their own order. No id is
 * suggested twice, and at most `MAX_AGENT_SUGGESTIONS` are. Without a picker, or on a host with
 * no agent catalog, the suggestions are `used` alone.
 */
export function agentSuggestions(picker: AgentPicker | null, used: readonly string[]): AgentSuggestion[] {
  const seen = new Set<string>();
  const suggestions: AgentSuggestion[] = [];
  const add = (suggestion: AgentSuggestion) => {
    if (seen.has(suggestion.id) || suggestions.length >= MAX_AGENT_SUGGESTIONS) return;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  };
  if (picker?.catalog) for (const a of picker.agents) add(a.selectable ? { id: a.agentId } : { id: a.agentId, note: CANT_BE_BOUND });
  for (const id of used) add({ id });
  return suggestions;
}

const warning = (code: string, message: string): Diagnostic => ({ code, severity: "warning", message, path: "" });

/**
 * The picker's warnings for the agent id in a field. An id the catalog doesn't have gets one that
 * names it, and an agent the host can't bind gets one for each of the host's reasons, verbatim.
 * An empty id gets none, and neither does any id without a picker or on a host with no catalog.
 */
export function agentWarnings(picker: AgentPicker | null, agentId: string): Diagnostic[] {
  if (!picker?.catalog || agentId.trim() === "") return [];
  const agent = picker.agents.find((a) => a.agentId === agentId);
  if (!agent) return [warning("AGENT_NOT_IN_CATALOG", `The host's agent catalog doesn't offer the agent ${JSON.stringify(agentId)}.`)];
  if (agent.selectable) return [];
  if (agent.reasons.length === 0) return [warning("AGENT_NOT_SELECTABLE", "The host can't bind this agent, and gives no reason.")];
  return agent.reasons.map((reason) => warning("AGENT_NOT_SELECTABLE", `The host can't bind this agent: ${reason}`));
}

/** What a field says when the host has no agent catalog. */
export const NO_CATALOG_NOTE = "The host has no agent catalog.";

/** The builder's reads of the picker for the project it shows. */
export interface AgentPickerReads {
  /**
   * Follows `projectPath`, and whether its picker may be read: `readable` is true while the
   * builder is shown and the project's host can be used. The picker is read when that becomes
   * true, and dropped when it stops being true or the project changes.
   */
  follow(projectPath: string | null, readable: boolean): void;
  /** Reads the picker again, as when the host is checked again. Does nothing while it may not be read. */
  reread(): void;
  /** The picker last read for the project followed, or null when there is none. */
  current(): AgentPicker | null;
  /** Calls `listener` whenever `current` changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * Reads of the picker through `call`. Only the newest read's answer is kept: starting a read, or
 * following another project, cancels the one in flight and drops its answer. A picker already
 * read stays current while it is read again, and a read that fails leaves none.
 */
export function createAgentPickerReads(call: Invoker = invoke): AgentPickerReads {
  let key = "";
  let path: string | null = null;
  let readable = false;
  let picker: AgentPicker | null = null;
  let inFlight: AbortController | null = null;
  const listeners = new Set<() => void>();

  const set = (next: AgentPicker | null) => {
    if (next === picker) return;
    picker = next;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    inFlight?.abort();
    inFlight = null;
  };
  const read = () => {
    cancel();
    if (!readable || path === null) return;
    const own = new AbortController();
    inFlight = own;
    void praxisCall("praxis_host_agents", { projectPath: path }, own.signal, call).then((outcome) => {
      if (inFlight !== own) return;
      inFlight = null;
      set(agentPickerOf(outcome));
    });
  };

  return {
    follow(projectPath, nextReadable) {
      const nextKey = projectPath === null ? "" : normalizePath(projectPath);
      if (nextKey === key && nextReadable === readable) return;
      key = nextKey;
      path = projectPath;
      readable = nextReadable;
      cancel();
      set(null);
      read();
    },
    reread: read,
    current: () => picker,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
