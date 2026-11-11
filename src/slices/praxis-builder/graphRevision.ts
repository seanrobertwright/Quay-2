// One revision of a graph workflow, as a graph run's run canvas draws it (#571): read from the host
// with `praxis graphs show <name> --revision <n> --format aiws-graph-workflow-revision/1 --json`
// through the Praxis CLI runner, and its bundle's main graph parsed for drawing. Child graphs are
// never drawn, so the bundle's `children` are ignored.
//
// A revision never changes, so each one read is kept in memory, in a cache of
// `REVISION_CACHE_SIZE` revisions that drops the oldest when a new one comes, and a revision the
// cache holds is never read from the host again. A read that failed is never kept, so the next
// read of it asks the host again. A read isn't cancelled when the detail that asked for it closes:
// it is kept for the next one, and the runner's read timeout bounds it.
import { invoke } from "@tauri-apps/api/core";
import { isObject, MAX_NODES, parseGraph, type PraxisGraph } from "./model.ts";
import { outcomeMessage, praxisCall, type Invoker } from "./praxisHost.ts";

/** How many revisions the cache keeps. */
export const REVISION_CACHE_SIZE = 8;

/** What reading one revision came to. */
export type RevisionRead =
  /** Its bundle's main graph, to draw. */
  | { kind: "graph"; graph: PraxisGraph }
  /** Read, but its main graph isn't drawn, for `reason`. */
  | { kind: "undrawn"; reason: string }
  /** Not read, for `problem`, in praxis's or Quay's words. */
  | { kind: "failed"; problem: string };

export interface RevisionCache {
  /**
   * Revision `revision` of graph workflow `name`, on `projectPath`'s host: the cache's copy when it
   * holds one, else read from the host, joining a read of it already in flight. Never rejects.
   */
  read(projectPath: string, name: string, revision: number): Promise<RevisionRead>;
}

export interface RevisionCacheOptions {
  /** The most revisions it keeps; `REVISION_CACHE_SIZE` when absent. */
  size?: number;
  call?: Invoker;
}

/**
 * What a revision record's bundle holds to draw: its main graph, or why it isn't drawn: it has no
 * graph, more nodes than the builder draws, or a graph the builder can't read.
 */
export function revisionGraphOf(record: Record<string, unknown>): Exclude<RevisionRead, { kind: "failed" }> {
  const graph = isObject(record.bundle) ? record.bundle.graph : undefined;
  if (!isObject(graph)) return { kind: "undrawn", reason: "praxis gave it without a graph." };
  if (Array.isArray(graph.nodes) && graph.nodes.length > MAX_NODES) {
    return { kind: "undrawn", reason: `Its graph has ${graph.nodes.length} nodes, more than the ${MAX_NODES} the builder draws.` };
  }
  const parsed = parseGraph(graph);
  return parsed.ok ? { kind: "graph", graph: parsed.value } : { kind: "undrawn", reason: `Its graph can't be drawn: ${parsed.message}` };
}

/** A signal no one aborts: a revision read runs to its end, for whoever asks next. */
const NEVER_ABORTED = new AbortController().signal;

export function createRevisionCache({ size = REVISION_CACHE_SIZE, call = invoke }: RevisionCacheOptions = {}): RevisionCache {
  // A Map iterates in insertion order, so the first key is the oldest revision kept.
  const kept = new Map<string, RevisionRead>();
  const reading = new Map<string, Promise<RevisionRead>>();

  async function fromHost(projectPath: string, name: string, revision: number): Promise<RevisionRead> {
    const outcome = await praxisCall("praxis_host_graph_revision", { projectPath, name, revision }, NEVER_ABORTED, call);
    return outcome.kind === "record" ? revisionGraphOf(outcome.record) : { kind: "failed", problem: outcomeMessage(outcome) };
  }

  function keep(key: string, read: RevisionRead): void {
    kept.set(key, read);
    for (const oldest of kept.keys()) {
      if (kept.size <= size) break;
      kept.delete(oldest);
    }
  }

  return {
    read(projectPath, name, revision) {
      const key = JSON.stringify([projectPath, name, revision]);
      const held = kept.get(key);
      if (held) return Promise.resolve(held);
      const joined = reading.get(key);
      if (joined) return joined;
      const read = fromHost(projectPath, name, revision).then((got) => {
        reading.delete(key);
        if (got.kind !== "failed") keep(key, got);
        return got;
      });
      reading.set(key, read);
      return read;
    },
  };
}

/** The builder's revision cache, which every graph run's detail reads through. */
export const REVISION_CACHE: RevisionCache = createRevisionCache();
