/**
 * The attention queue: every session waiting on the user, oldest first. It takes plain events
 * and returns the ordered list of waiting items. It knows nothing of Tauri or React; the hook
 * that feeds it (`useAttentionQueue`) turns bridge events into these events, and the status
 * strip badge renders its count.
 */

/** A permission request an agent is blocked on until the user answers it. */
export interface PermissionItem {
  kind: "permission";
  requestId: string;
  /** The terminal that asked, or null when the request named none. */
  terminalId: string | null;
  project: string | null;
  tool: string;
  /** When the item started waiting, in epoch milliseconds. */
  waitingSince: number;
}

/** An agent that finished its turn and sits idle until the user gives it the next one. */
export interface FinishedTurnItem {
  kind: "finishedTurn";
  terminalId: string;
  project: string | null;
  /** When the item started waiting, in epoch milliseconds. */
  waitingSince: number;
}

/** One thing waiting on the user. A tagged union on `kind`, so more kinds can join later. */
export type AttentionItem = PermissionItem | FinishedTurnItem;

/** A permission request as the backend lists it. */
export interface PendingPermission {
  requestId: string;
  terminalId: string | null;
  project: string | null;
  tool: string;
}

export type AttentionEvent =
  | {
      type: "permissionRequested";
      requestId: string;
      terminalId: string | null;
      project: string | null;
      tool: string;
      at: number;
    }
  /**
   * The requests the backend still holds, as it lists them when the webview (re)loads. The
   * backend gives no time a request was made, so a request not yet queued waits from `at`.
   */
  | { type: "pendingPermissionsLoaded"; requests: readonly PendingPermission[]; at: number }
  /** The request was answered, wherever it was answered. */
  | { type: "permissionResolved"; requestId: string }
  | {
      type: "turnCompleted";
      terminalId: string;
      project: string | null;
      /** Whether the turn was a subagent's rather than the terminal's own. */
      subagent: boolean;
      at: number;
    }
  /** A new turn started on the terminal, whoever started it: the user or a peer over A2A. */
  | {
      type: "turnStarted";
      terminalId: string;
      /** Whether the turn was a subagent's rather than the terminal's own. */
      subagent: boolean;
    }
  /** The user typed or pasted into the terminal. Focusing it is not input. */
  | { type: "userInput"; terminalId: string }
  /** The user dismissed the terminal's finished turn without acting on it. */
  | { type: "finishedTurnDismissed"; terminalId: string };

export interface AttentionQueue {
  /** Permission items by request id. */
  readonly permissions: ReadonlyMap<string, PermissionItem>;
  /** Finished-turn items by terminal id, so a terminal has at most one. */
  readonly finishedTurns: ReadonlyMap<string, FinishedTurnItem>;
}

export const emptyAttentionQueue: AttentionQueue = {
  permissions: new Map(),
  finishedTurns: new Map(),
};

/** The queue after `event`. Returns a new queue and leaves `queue` as it was. */
export function applyAttentionEvent(queue: AttentionQueue, event: AttentionEvent): AttentionQueue {
  switch (event.type) {
    case "permissionRequested": {
      if (queue.permissions.has(event.requestId)) return queue;
      const permissions = new Map(queue.permissions);
      permissions.set(event.requestId, {
        kind: "permission",
        requestId: event.requestId,
        terminalId: event.terminalId,
        project: event.project,
        tool: event.tool,
        waitingSince: event.at,
      });
      return { ...queue, permissions };
    }
    case "pendingPermissionsLoaded": {
      const permissions = new Map(queue.permissions);
      for (const request of event.requests) {
        if (permissions.has(request.requestId)) continue;
        permissions.set(request.requestId, { kind: "permission", ...request, waitingSince: event.at });
      }
      return { ...queue, permissions };
    }
    case "permissionResolved": {
      const permissions = new Map(queue.permissions);
      permissions.delete(event.requestId);
      return { ...queue, permissions };
    }
    case "turnCompleted": {
      // A subagent's turn says nothing about whether the terminal's own agent is idle
      if (event.subagent) return queue;
      const finishedTurns = new Map(queue.finishedTurns);
      // A newer turn replaces the older item but keeps when the terminal started waiting
      const older = finishedTurns.get(event.terminalId);
      finishedTurns.set(event.terminalId, {
        kind: "finishedTurn",
        terminalId: event.terminalId,
        project: event.project,
        waitingSince: older?.waitingSince ?? event.at,
      });
      return { ...queue, finishedTurns };
    }
    case "turnStarted":
      return event.subagent ? queue : clearFinishedTurn(queue, event.terminalId);
    case "userInput":
    case "finishedTurnDismissed":
      return clearFinishedTurn(queue, event.terminalId);
  }
}

/** The queue without `terminalId`'s finished-turn item. */
function clearFinishedTurn(queue: AttentionQueue, terminalId: string): AttentionQueue {
  if (!queue.finishedTurns.has(terminalId)) return queue;
  const finishedTurns = new Map(queue.finishedTurns);
  finishedTurns.delete(terminalId);
  return { ...queue, finishedTurns };
}

/** Every waiting item, oldest first by when it started waiting, across all kinds. */
export function attentionItems(queue: AttentionQueue): AttentionItem[] {
  return [...queue.permissions.values(), ...queue.finishedTurns.values()].sort(
    (a, b) => a.waitingSince - b.waitingSince
  );
}
