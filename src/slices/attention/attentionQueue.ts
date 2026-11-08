/**
 * The attention queue: every session waiting on the user, oldest first. It takes plain events
 * and returns the ordered list of waiting items. It knows nothing of Tauri or React; the hook
 * that feeds it (`useAttentionQueue`) turns bridge events into these events. The status strip
 * badge renders its count, the attention drawer its rows, and the permission modal its
 * `modalPermissions`.
 */

/** A permission request as the backend reports it: an agent is blocked until the user answers. */
export interface PendingPermission {
  requestId: string;
  /** The terminal that asked, or null when the request named none. */
  terminalId: string | null;
  /** The terminal's project, or null while the terminal is not known yet. */
  project: string | null;
  tool: string;
  /** The tool's arguments as the agent sent them, for the permission modal to show. */
  input?: unknown;
  /** Why the agent asks, when it said. */
  reason?: string;
}

/** A permission request an agent is blocked on until the user answers it. */
export interface PermissionItem extends PendingPermission {
  kind: "permission";
  /** When the item started waiting, in epoch milliseconds. */
  waitingSince: number;
  /**
   * Whether the user put the request off with the modal's Later. A deferred request still waits
   * and still counts, but the permission modal does not show it until it is reopened.
   */
  deferred: boolean;
}

/** An agent that finished its turn and sits idle until the user gives it the next one. */
export interface FinishedTurnItem {
  kind: "finishedTurn";
  terminalId: string;
  /** The terminal's project, or null while the terminal is not known yet. */
  project: string | null;
  /** When the item started waiting, in epoch milliseconds. */
  waitingSince: number;
}

/** One thing waiting on the user. A tagged union on `kind`, so more kinds can join later. */
export type AttentionItem = PermissionItem | FinishedTurnItem;

/** A terminal and the project it belongs to. */
export interface KnownTerminal {
  terminalId: string;
  project: string | null;
}

export type AttentionEvent =
  | { type: "permissionRequested"; request: PendingPermission; at: number }
  /**
   * The requests the backend still holds, as it lists them when the webview (re)loads. The
   * backend gives no time a request was made, so a request not yet queued waits from `at`.
   */
  | { type: "pendingPermissionsLoaded"; requests: readonly PendingPermission[]; at: number }
  /** The request was answered, wherever it was answered. */
  | { type: "permissionResolved"; requestId: string }
  /** The user chose Later on the permission modal while it showed `requestIds`. */
  | { type: "permissionsDeferred"; requestIds: readonly string[] }
  /** The user chose to see deferred requests again, so the permission modal shows them. */
  | { type: "permissionsReopened"; requestIds: readonly string[] }
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
  | { type: "finishedTurnDismissed"; terminalId: string }
  /**
   * The terminal closed, its process exited, or it was relaunched. Nothing it was waiting on can
   * be answered any more, so all its items go.
   */
  | { type: "terminalEnded"; terminalId: string }
  /**
   * The terminals the app knows now. An item queued before its terminal was known, such as a
   * permission rebuilt on a webview reload before the terminal list loads, takes its project.
   */
  | { type: "terminalsKnown"; terminals: readonly KnownTerminal[] };

/**
 * The most permission items one terminal keeps. Past it the oldest is dropped, so one runaway
 * agent cannot bury the other sessions. Requests that name no terminal share one such cap.
 */
export const PERMISSIONS_PER_TERMINAL = 20;

export interface AttentionQueue {
  /** Permission items by request id, at most `PERMISSIONS_PER_TERMINAL` per terminal. */
  readonly permissions: ReadonlyMap<string, PermissionItem>;
  /** Finished-turn items by terminal id, so a terminal has at most one. */
  readonly finishedTurns: ReadonlyMap<string, FinishedTurnItem>;
  /** By terminal id, how many permission items the cap dropped; a terminal with none is absent. */
  readonly droppedPermissions: ReadonlyMap<string | null, number>;
}

export const emptyAttentionQueue: AttentionQueue = {
  permissions: new Map(),
  finishedTurns: new Map(),
  droppedPermissions: new Map(),
};

/** The queue after `event`. Returns a new queue and leaves `queue` as it was. */
export function applyAttentionEvent(queue: AttentionQueue, event: AttentionEvent): AttentionQueue {
  switch (event.type) {
    case "permissionRequested":
      return addPermissions(queue, [event.request], event.at);
    case "pendingPermissionsLoaded":
      return addPermissions(queue, event.requests, event.at);
    case "permissionResolved": {
      const permissions = new Map(queue.permissions);
      permissions.delete(event.requestId);
      return { ...queue, permissions };
    }
    case "permissionsDeferred":
      return setDeferred(queue, event.requestIds, true);
    case "permissionsReopened":
      return setDeferred(queue, event.requestIds, false);
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
    case "terminalEnded":
      return endTerminal(queue, event.terminalId);
    case "terminalsKnown":
      return fillProjects(queue, event.terminals);
  }
}

/**
 * The queue with `requests` waiting from `at`. A request already queued keeps its item and its
 * original waiting time, so a request heard twice stays one item. A terminal pushed past
 * `PERMISSIONS_PER_TERMINAL` loses its oldest items, and the queue counts them as dropped.
 */
function addPermissions(
  queue: AttentionQueue,
  requests: readonly PendingPermission[],
  at: number
): AttentionQueue {
  const fresh = requests.filter((request) => !queue.permissions.has(request.requestId));
  if (fresh.length === 0) return queue;
  const permissions = new Map(queue.permissions);
  for (const request of fresh) {
    permissions.set(request.requestId, { kind: "permission", ...request, waitingSince: at, deferred: false });
  }
  let droppedPermissions = queue.droppedPermissions;
  for (const terminalId of new Set(fresh.map((request) => request.terminalId))) {
    // Oldest first; the sort is stable, so items that started waiting together keep arrival order
    const held = [...permissions.values()]
      .filter((item) => item.terminalId === terminalId)
      .sort((a, b) => a.waitingSince - b.waitingSince);
    const excess = held.length - PERMISSIONS_PER_TERMINAL;
    if (excess <= 0) continue;
    for (const item of held.slice(0, excess)) permissions.delete(item.requestId);
    const dropped = new Map(droppedPermissions);
    dropped.set(terminalId, (dropped.get(terminalId) ?? 0) + excess);
    droppedPermissions = dropped;
  }
  return { ...queue, permissions, droppedPermissions };
}

/** The queue with each of `requestIds` that still waits set to `deferred`. */
function setDeferred(queue: AttentionQueue, requestIds: readonly string[], deferred: boolean): AttentionQueue {
  let permissions: Map<string, PermissionItem> | null = null;
  for (const requestId of requestIds) {
    const item = queue.permissions.get(requestId);
    if (!item || item.deferred === deferred) continue;
    permissions ??= new Map(queue.permissions);
    permissions.set(requestId, { ...item, deferred });
  }
  return permissions ? { ...queue, permissions } : queue;
}

/** The queue with each item that has no project given its terminal's project from `terminals`. */
function fillProjects(queue: AttentionQueue, terminals: readonly KnownTerminal[]): AttentionQueue {
  const projects = new Map(terminals.map((t) => [t.terminalId, t.project]));
  const fill = <T extends AttentionItem>(items: ReadonlyMap<string, T>): ReadonlyMap<string, T> => {
    let filled: Map<string, T> | null = null;
    for (const [key, item] of items) {
      if (item.project !== null || item.terminalId === null) continue;
      const project = projects.get(item.terminalId);
      if (!project) continue;
      filled ??= new Map(items);
      filled.set(key, { ...item, project });
    }
    return filled ?? items;
  };
  const permissions = fill(queue.permissions);
  const finishedTurns = fill(queue.finishedTurns);
  if (permissions === queue.permissions && finishedTurns === queue.finishedTurns) return queue;
  return { ...queue, permissions, finishedTurns };
}

/** The queue without any of `terminalId`'s items, and with its dropped count back at zero. */
function endTerminal(queue: AttentionQueue, terminalId: string): AttentionQueue {
  const permissions = new Map(
    [...queue.permissions].filter(([, item]) => item.terminalId !== terminalId)
  );
  const droppedPermissions = new Map(queue.droppedPermissions);
  droppedPermissions.delete(terminalId);
  return { ...clearFinishedTurn(queue, terminalId), permissions, droppedPermissions };
}

/** The queue without `terminalId`'s finished-turn item. */
function clearFinishedTurn(queue: AttentionQueue, terminalId: string): AttentionQueue {
  if (!queue.finishedTurns.has(terminalId)) return queue;
  const finishedTurns = new Map(queue.finishedTurns);
  finishedTurns.delete(terminalId);
  return { ...queue, finishedTurns };
}

/**
 * The permission requests the permission modal shows: every request not deferred with Later,
 * oldest first by when it started waiting. The modal is open while this holds any request.
 */
export function modalPermissions(queue: AttentionQueue): PermissionItem[] {
  return [...queue.permissions.values()]
    .filter((item) => !item.deferred)
    .sort((a, b) => a.waitingSince - b.waitingSince);
}

/** The ids of every permission request still waiting, deferred or not, oldest first. */
export function pendingPermissionIds(queue: AttentionQueue): string[] {
  return [...queue.permissions.values()]
    .sort((a, b) => a.waitingSince - b.waitingSince)
    .map((item) => item.requestId);
}

/** Every waiting item, oldest first by when it started waiting, across all kinds. */
export function attentionItems(queue: AttentionQueue): AttentionItem[] {
  return [...queue.permissions.values(), ...queue.finishedTurns.values()].sort(
    (a, b) => a.waitingSince - b.waitingSince
  );
}

/**
 * A key for `item` that names the thing waiting, never its place in the list: the request id
 * for a permission, the terminal for a finished turn (a terminal has at most one).
 */
export function attentionItemKey(item: AttentionItem): string {
  return item.kind === "permission" ? `permission:${item.requestId}` : `finishedTurn:${item.terminalId}`;
}

/**
 * How long an item that started waiting at `waitingSince` has waited by `now`, both in epoch
 * milliseconds, in its two largest units: "45s", "3m", "1h 5m", "1d 2h". A `now` before
 * `waitingSince` reads "0s".
 */
export function waitedLabel(waitingSince: number, now: number): string {
  const seconds = Math.floor(Math.max(0, now - waitingSince) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const pair = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small === 0 ? `${big}${bigUnit}` : `${big}${bigUnit} ${small}${smallUnit}`;
  if (hours < 24) return pair(hours, "h", minutes % 60, "m");
  return pair(Math.floor(hours / 24), "d", hours % 24, "h");
}

/**
 * How many of `terminalId`'s permission requests the queue dropped to stay within
 * `PERMISSIONS_PER_TERMINAL`, since the terminal was launched. Null counts the requests that
 * named no terminal.
 */
export function droppedPermissionCount(queue: AttentionQueue, terminalId: string | null): number {
  return queue.droppedPermissions.get(terminalId) ?? 0;
}
