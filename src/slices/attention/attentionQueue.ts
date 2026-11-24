/**
 * The attention queue: every session waiting on the user, oldest first. It takes plain events
 * and returns the ordered list of waiting items. It knows nothing of Tauri or React; the hook
 * that feeds it (`useAttentionQueue`) turns bridge events into these events. The module bar's
 * Agents icon renders its count, the Agents panel's Waiting on you its rows, and the companion's
 * Activity view a terminal's permission requests. An asking surface's item says only that it waits;
 * the companion's Surface view draws the surface from the surface store.
 */

/** A permission request as the backend reports it: an agent is blocked until the user answers. */
export interface PendingPermission {
  requestId: string;
  /** The terminal that asked, or null when the request named none. */
  terminalId: string | null;
  /** The terminal's project, or null while the terminal is not known yet. */
  project: string | null;
  tool: string;
  /** The tool's arguments as the agent sent them, for the Activity view to show. */
  input?: unknown;
  /** Why the agent asks, when it said. */
  reason?: string;
}

/** A permission request an agent is blocked on until the user answers it. */
export interface PermissionItem extends PendingPermission {
  kind: "permission";
  /** When the item started waiting, in epoch milliseconds. */
  waitingSince: number;
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

/** A live surface that asks the user for something. */
export interface AskingSurface {
  terminalId: string;
  /** The terminal's project, or null while the terminal is not known yet. */
  project: string | null;
  /** The surface's id, one among its terminal's. */
  surfaceId: string;
  /** The tool that showed it. */
  tool: string;
  /** Where it stands among the surfaces of every terminal: one shown later has a higher order. */
  order: number;
}

/** An asking surface that waits for the user's answer. Its terminal's own status says nothing of it. */
export interface SurfaceItem extends AskingSurface {
  kind: "surface";
  /** When the item started waiting, in epoch milliseconds. */
  waitingSince: number;
}

/** One thing waiting on the user. A tagged union on `kind`, so more kinds can join later. */
export type AttentionItem = PermissionItem | FinishedTurnItem | SurfaceItem;

/**
 * An answer the user gave that reached no agent, because the agent had stopped waiting for it.
 * The app tells the user, so they do not take the request as answered.
 */
export interface UndeliveredAnswer {
  requestId: string;
  /** The terminal that asked, or null when the request named none or was no longer queued. */
  terminalId: string | null;
  /** The tool the request was for, or null when the request was no longer queued. */
  tool: string | null;
  /** Why the answer was not delivered, as the backend said it. */
  error: string;
}

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
  /**
   * The user answered the request, and the backend said no agent was waiting for the answer any
   * more. The request goes, and the queue keeps `error` to tell the user.
   */
  | { type: "permissionAnswerUndelivered"; requestId: string; error: string }
  /** The user closed the notice about the answer that reached nobody. */
  | { type: "undeliveredAnswerDismissed" }
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
  /**
   * Every surface that asks now. One that is no longer among them goes, one that still is keeps its
   * waiting time, and a new one waits from `at`.
   */
  | { type: "surfacesAsking"; surfaces: readonly AskingSurface[]; at: number }
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
  /** Asking surfaces by `surfaceKey`. */
  readonly surfaces: ReadonlyMap<string, SurfaceItem>;
  /** The keys of surfaces that were waiting when their terminal ended, while they are still said to ask. */
  readonly endedSurfaces: ReadonlySet<string>;
  /** By terminal id, how many permission items the cap dropped; a terminal with none is absent. */
  readonly droppedPermissions: ReadonlyMap<string | null, number>;
  /** The latest answer that reached nobody, until the user closes its notice. */
  readonly undeliveredAnswer: UndeliveredAnswer | null;
}

export const emptyAttentionQueue: AttentionQueue = {
  permissions: new Map(),
  finishedTurns: new Map(),
  surfaces: new Map(),
  endedSurfaces: new Set(),
  droppedPermissions: new Map(),
  undeliveredAnswer: null,
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
    case "permissionAnswerUndelivered": {
      const item = queue.permissions.get(event.requestId);
      const permissions = new Map(queue.permissions);
      permissions.delete(event.requestId);
      const undeliveredAnswer: UndeliveredAnswer = {
        requestId: event.requestId,
        terminalId: item?.terminalId ?? null,
        tool: item?.tool ?? null,
        error: event.error,
      };
      return { ...queue, permissions, undeliveredAnswer };
    }
    case "undeliveredAnswerDismissed":
      return queue.undeliveredAnswer ? { ...queue, undeliveredAnswer: null } : queue;
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
    case "surfacesAsking":
      return setSurfaces(queue, event.surfaces, event.at);
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
    permissions.set(request.requestId, { kind: "permission", ...request, waitingSince: at });
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

/** Names one asking of a surface: a terminal may use an id again, for a surface of a higher order. */
const surfaceKey = ({ terminalId, surfaceId, order }: AskingSurface): string => JSON.stringify([terminalId, surfaceId, order]);

/** The queue with `asking` as its surfaces, except those that were waiting when their terminal ended. */
function setSurfaces(queue: AttentionQueue, asking: readonly AskingSurface[], at: number): AttentionQueue {
  const surfaces = new Map<string, SurfaceItem>();
  const endedSurfaces = new Set<string>();
  for (const surface of asking) {
    const key = surfaceKey(surface);
    if (queue.endedSurfaces.has(key)) endedSurfaces.add(key);
    else surfaces.set(key, queue.surfaces.get(key) ?? { kind: "surface", ...surface, waitingSince: at });
  }
  const sameKeys = surfaces.size === queue.surfaces.size && [...surfaces.keys()].every((key) => queue.surfaces.has(key));
  if (sameKeys && endedSurfaces.size === queue.endedSurfaces.size) return queue;
  return { ...queue, surfaces, endedSurfaces };
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
  const surfaces = fill(queue.surfaces);
  if (permissions === queue.permissions && finishedTurns === queue.finishedTurns && surfaces === queue.surfaces) return queue;
  return { ...queue, permissions, finishedTurns, surfaces };
}

/** The queue without any of `terminalId`'s items, and with its dropped count back at zero. */
function endTerminal(queue: AttentionQueue, terminalId: string): AttentionQueue {
  const permissions = new Map(
    [...queue.permissions].filter(([, item]) => item.terminalId !== terminalId)
  );
  const droppedPermissions = new Map(queue.droppedPermissions);
  droppedPermissions.delete(terminalId);
  const surfaces = new Map(queue.surfaces);
  const endedSurfaces = new Set(queue.endedSurfaces);
  for (const [key, item] of queue.surfaces) {
    if (item.terminalId !== terminalId) continue;
    surfaces.delete(key);
    endedSurfaces.add(key);
  }
  return { ...clearFinishedTurn(queue, terminalId), permissions, surfaces, endedSurfaces, droppedPermissions };
}

/** The queue without `terminalId`'s finished-turn item. */
function clearFinishedTurn(queue: AttentionQueue, terminalId: string): AttentionQueue {
  if (!queue.finishedTurns.has(terminalId)) return queue;
  const finishedTurns = new Map(queue.finishedTurns);
  finishedTurns.delete(terminalId);
  return { ...queue, finishedTurns };
}

/** The ids of every permission request still waiting, oldest first. */
export function pendingPermissionIds(queue: AttentionQueue): string[] {
  return [...queue.permissions.values()]
    .sort((a, b) => a.waitingSince - b.waitingSince)
    .map((item) => item.requestId);
}

/**
 * Every waiting item, oldest first by when it started waiting, across all kinds. Surfaces that
 * started waiting together are in the order they were shown. A terminal's finished turn stands
 * aside while one of its surfaces asks.
 */
export function attentionItems(queue: AttentionQueue): AttentionItem[] {
  const surfaces = [...queue.surfaces.values()].sort((a, b) => a.order - b.order);
  const asking = new Set(surfaces.map((item) => item.terminalId));
  const finishedTurns = [...queue.finishedTurns.values()].filter((item) => !asking.has(item.terminalId));
  return [...queue.permissions.values(), ...finishedTurns, ...surfaces].sort((a, b) => a.waitingSince - b.waitingSince);
}

/**
 * A key for `item` that names the thing waiting, never its place in the list: the request id
 * for a permission, the terminal for a finished turn (a terminal has at most one), and the
 * terminal, id and order of a surface.
 */
export function attentionItemKey(item: AttentionItem): string {
  switch (item.kind) {
    case "permission":
      return `permission:${item.requestId}`;
    case "finishedTurn":
      return `finishedTurn:${item.terminalId}`;
    case "surface":
      return `surface:${surfaceKey(item)}`;
  }
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

/** The latest answer the user gave that reached no agent, or null when there is none to show. */
export function undeliveredAnswer(queue: AttentionQueue): UndeliveredAnswer | null {
  return queue.undeliveredAnswer;
}

/**
 * The newest permission request `terminalId` has waiting among `items`, or null
 * when it waits on none. The lens reply strip shows it as the terminal's last question.
 */
export function latestPermission(items: readonly AttentionItem[], terminalId: string): PermissionItem | null {
  let last: PermissionItem | null = null;
  for (const item of items) {
    if (item.kind !== "permission" || item.terminalId !== terminalId) continue;
    if (!last || item.waitingSince >= last.waitingSince) last = item;
  }
  return last;
}
