// Agent highlights (#368, #401): picking agent kinds dims the rows of every other kind. It is a
// highlight, never a filter, since hiding commits would break parent links and lanes. Like Find
// (#399), the highlighted rows are one sorted index list, computed once per change and carried on
// as rows load, so a row holds no highlight state of its own.

import type { RunKind } from "../../terminal/types.ts";
import type { GraphAgent } from "./graphPage.ts";

/** What a highlight picks: human commits, an agent's run kind, or a stamp naming no known kind. */
export type HighlightKind = "human" | "unknown" | RunKind;

/** The loaded rows as the scan reads them; `GraphStore` is one. */
export interface AgentRows {
  readonly rowCount: number;
  agent(row: number): GraphAgent | null;
}

/** The highlight kind of a commit whose agent is `agent`, null for a human commit. */
export function highlightKindOf(agent: GraphAgent | null): HighlightKind {
  if (agent === null) return "human";
  return agent.kind ?? "unknown";
}

/**
 * The kinds the highlight offers for a store's distinct `agents`: human first, then each agent
 * kind in the order the agents came, each once.
 */
export function highlightKinds(agents: readonly (GraphAgent | null)[]): HighlightKind[] {
  const kinds = new Set<HighlightKind>(["human"]);
  for (const agent of agents) kinds.add(highlightKindOf(agent));
  return [...kinds];
}

export class AgentScan {
  private readonly kinds: ReadonlySet<HighlightKind>;
  private buffer = new Int32Array(64);
  private count = 0;
  private next = 0;
  /**
   * Whether each agent is highlighted, decided once per agent: the store shares one object per
   * distinct agent, so a million rows test a handful of agents.
   */
  private readonly decided = new Map<GraphAgent | null, boolean>();

  constructor(kinds: readonly HighlightKind[]) {
    this.kinds = new Set(kinds);
  }

  /** The highlighted rows scanned so far, ascending. */
  get matches(): Int32Array {
    return this.buffer.subarray(0, this.count);
  }

  /** Scans up to `budget` more rows; returns whether it has reached the last loaded row. */
  scan(rows: AgentRows, budget: number): boolean {
    const end = Math.min(rows.rowCount, this.next + budget);
    for (let row = this.next; row < end; row++) {
      const agent = rows.agent(row);
      let hit = this.decided.get(agent);
      if (hit === undefined) {
        hit = this.kinds.has(highlightKindOf(agent));
        this.decided.set(agent, hit);
      }
      if (!hit) continue;
      if (this.count === this.buffer.length) {
        const grown = new Int32Array(this.buffer.length * 2);
        grown.set(this.buffer);
        this.buffer = grown;
      }
      this.buffer[this.count++] = row;
    }
    this.next = end;
    return end === rows.rowCount;
  }
}

/** One source of bright rows: whether it is on, and its rows, ascending. */
export interface Highlight {
  active: boolean;
  matches: Int32Array;
}

/** The rows in both sorted lists, ascending: one merge pass. */
function intersect(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(Math.min(a.length, b.length));
  let i = 0;
  let j = 0;
  let n = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) i++;
    else if (a[i] > b[j]) j++;
    else {
      out[n++] = a[i];
      i++;
      j++;
    }
  }
  return out.subarray(0, n);
}

/**
 * The bright rows when Find (or a deep search) and the agent highlight combine (#368): with one
 * on, its rows; with both, only the rows matching both. Every other row is dimmed.
 */
export function brightRows(find: Highlight, agents: Highlight): Highlight {
  if (!agents.active) return find;
  if (!find.active) return agents;
  return { active: true, matches: intersect(find.matches, agents.matches) };
}
