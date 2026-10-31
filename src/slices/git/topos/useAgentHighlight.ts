import { useEffect, useRef, useState } from "react";
import { AgentScan, type Highlight, type HighlightKind } from "./agentHighlight";
import type { GraphStore } from "./graphStore";

/** Rows one chunk scans before yielding, as Find's scan does. */
const CHUNK_ROWS = 100_000;

const OFF: Highlight = { active: false, matches: new Int32Array(0) };

interface RunningScan {
  scan: AgentScan;
  store: GraphStore;
  kinds: readonly HighlightKind[];
}

/**
 * The rows of `store` whose agent kind is among `kinds` (#401), scanned once per change of kinds
 * or store in chunks that yield to the page, and carried on over new rows as `rowCount` bumps. Off
 * while no kind is picked.
 */
export function useAgentHighlight(store: GraphStore | null, rowCount: number, kinds: readonly HighlightKind[]): Highlight {
  const [result, setResult] = useState<Highlight>(OFF);
  const running = useRef<RunningScan | null>(null);
  useEffect(() => {
    if (store === null || kinds.length === 0) {
      running.current = null;
      setResult(OFF);
      return;
    }
    let current = running.current;
    // A splice or reset swaps in a new store whose row numbers differ, so it starts over.
    if (current === null || current.store !== store || current.kinds !== kinds) {
      current = { scan: new AgentScan(kinds), store, kinds };
      running.current = current;
    }
    const scan = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      if (running.current !== scan) return;
      const done = scan.scan.scan(store, CHUNK_ROWS);
      setResult({ active: true, matches: scan.scan.matches });
      if (!done) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [store, rowCount, kinds]);
  // A highlight just turned off reads as off at once, before the effect clears it.
  return kinds.length === 0 ? OFF : result;
}
