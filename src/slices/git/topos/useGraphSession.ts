import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { GraphFeed, SOFT_CAP, type WatchState } from "./graphFeed";
import { errorMessage } from "./gitVersion";
import { SLOW_FIRST_ROWS_MS } from "./speedup";

export interface GraphSession {
  /** The feed for the repo asked for, or null while there is none yet. */
  feed: GraphFeed | null;
  /** Bumps whenever the feed changes, so readers re-render. */
  version: number;
  /** Tells the session the rendered rows now reach `windowEnd`, so it can load more in time. */
  reachedRow: (windowEnd: number) => void;
  /**
   * Re-runs the session's `git log` and splices or resets its rows (#379). Resolves once the
   * backend has sent the `Splice` or `Reset` and its rows; does nothing before the session starts.
   */
  refresh: () => Promise<void>;
  /**
   * Points the session's repository watch at `worktreePath`, watching its files only while
   * `visible`, and records whether live updates are on. Calling it again is Retry.
   */
  watch: (worktreePath: string, visible: boolean) => Promise<WatchState | null>;
}

// Opens and closes run one at a time, in the order they were asked for. Two opens in flight at
// once could reach the backend in either order, and the older one would replace the newer.
let sessionCalls: Promise<unknown> = Promise.resolve();
function inOrder<T>(call: () => Promise<T>): Promise<T> {
  const result = sessionCalls.then(call);
  sessionCalls = result.catch(() => undefined);
  return result;
}

/** Commit order for a session: date order, or topo order from the toolbar toggle (#375). */
export type GraphOrder = "date" | "topo";

/**
 * The graph session for `repoPath` in `order` (#374, #375). A new path or order closes the old
 * session and opens one; while both stay the same the session lives on, including while Topos is
 * hidden.
 */
export function useGraphSession(repoPath: string | null, order: GraphOrder): GraphSession {
  const [opened, setOpened] = useState<{ repoPath: string; order: GraphOrder; feed: GraphFeed } | null>(null);
  const [version, setVersion] = useState(0);
  const frame = useRef<number | null>(null);
  // The feed on screen, so a late answer for a replaced feed changes nothing.
  const current = useRef<GraphFeed | null>(null);

  // Pages arrive in bursts; re-render once per frame, not once per page.
  const bump = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    if (repoPath === null) {
      current.current = null;
      setOpened(null);
      return;
    }
    const feed = new GraphFeed();
    current.current = feed;
    setOpened({ repoPath, order, feed });
    let openedId: number | null = null;
    const close = (sessionId: number) =>
      inOrder(() => invoke("git_graph_close", { sessionId })).catch(console.error);

    // First rows slower than a second offer the speed-ups (#385), as soon as the second is up.
    let firstRows: number | null = window.setTimeout(() => {
      firstRows = null;
      if (current.current !== feed || feed.status.state !== "loading") return;
      feed.slowFirstRows = true;
      bump();
    }, SLOW_FIRST_ROWS_MS);
    const stopFirstRowsTimer = () => {
      if (firstRows !== null) window.clearTimeout(firstRows);
      firstRows = null;
    };

    const channel = new Channel<unknown>();
    channel.onmessage = (message) => {
      if (current.current !== feed) return;
      if (message instanceof ArrayBuffer) stopFirstRowsTimer();
      const wasFailed = feed.status.state === "failed";
      feed.accept(message);
      // A page the frontend couldn't read fails the feed; stop the walk behind it too.
      if (!wasFailed && feed.status.state === "failed" && feed.sessionId !== null) close(feed.sessionId);
      bump();
    };
    inOrder(() =>
      invoke<number>("git_graph_open", {
        repoPath,
        options: { order, refs: { kind: "branches" }, softCap: SOFT_CAP },
        onEvent: channel,
      })
    ).then(
      (sessionId) => {
        openedId = sessionId;
      },
      (e: unknown) => {
        if (current.current !== feed) return;
        feed.fail(errorMessage(e));
        bump();
      }
    );

    return () => {
      stopFirstRowsTimer();
      if (current.current === feed) current.current = null;
      // Queued behind the open, so the id is known by the time this runs.
      inOrder(async () => {
        const sessionId = openedId ?? feed.sessionId;
        if (sessionId !== null) await invoke("git_graph_close", { sessionId });
      }).catch(console.error);
    };
  }, [repoPath, order, bump]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  // A feed opened for another path or order is never handed out, not even for the render before
  // the effect above replaces it.
  const feed = opened !== null && opened.repoPath === repoPath && opened.order === order ? opened.feed : null;

  const reachedRow = useCallback(
    (windowEnd: number) => {
      if (feed === null || feed.sessionId === null) return;
      const rows = feed.rowsToRequest(windowEnd);
      if (rows === null) return;
      invoke("git_graph_more", { sessionId: feed.sessionId, rows }).catch((e: unknown) => {
        if (current.current !== feed) return;
        feed.fail(errorMessage(e));
        bump();
      });
      bump();
    },
    [feed, bump]
  );

  const refresh = useCallback(async () => {
    if (feed === null || feed.sessionId === null) return;
    await invoke("git_graph_refresh", { sessionId: feed.sessionId });
    bump();
  }, [feed, bump]);

  const watch = useCallback(
    async (worktreePath: string, visible: boolean): Promise<WatchState | null> => {
      if (feed === null || feed.sessionId === null) return null;
      let state: WatchState;
      try {
        state = await invoke<WatchState>("git_graph_watch", { sessionId: feed.sessionId, worktreePath, visible });
      } catch (e: unknown) {
        state = { state: "off", reason: errorMessage(e) };
      }
      if (current.current !== feed) return null;
      feed.watch = state;
      bump();
      return state;
    },
    [feed, bump]
  );

  return { feed, version, reachedRow, refresh, watch };
}
