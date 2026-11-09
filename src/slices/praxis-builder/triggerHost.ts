// Each graph trigger's state on the Praxis host (#469, #475): the one model behind the Triggers
// list's badge, the trigger form's status line and its Revisions panel. It has no UI of its own.
// A graph trigger is a trigger with a saved Starts target (#472); one without stays a local record
// and has no host state.
//
// It reads the host as the graph host model (#461) does, through the Praxis CLI runner's trigger
// commands (#474): `triggers list`, page by page, then `triggers show` for each local graph
// trigger the host has, at most two at a time. Readings live in memory for the project's builder
// session, never on disk, turn muted after `MUTED_AFTER_MS`, and are all dropped when the host
// goes offline. The trigger on screen is read every `CANDIDATE_POLL_MS` while it shows a pending
// candidate.
//
// The host's digest of a trigger revision covers the revision number (`graphTriggerDigest` stores
// the record with `revision` set to it), so Quay can't digest the saved files once in the listing,
// as it does a graph workflow's bundle. It asks the backend for the saved files' digest at the
// current revision (`praxis_trigger_digest`) after each read, and again whenever the listing
// changes, keeping the last one until the new one is in. Digests are kept by revision, so one at
// another revision is never compared with the current one's.
import { invoke } from "@tauri-apps/api/core";
import { CANDIDATE_POLL_MS, LIST_PAGE_LIMIT, MAX_LIST_PAGES } from "./graphHost.ts";
import { hostConditionView } from "./hostCondition.ts";
import { createHostReadSession, createLimiter, isObject, MAX_SHOWS_IN_FLIGHT, MUTED_AFTER_MS, online } from "./hostReadSession.ts";
import { isHostLevelFailure, outcomeMessage, type HostCondition, type Invoker } from "./praxisHost.ts";

/** A local graph trigger as the builder's list has it: a trigger with a saved Starts target. */
export interface LocalGraphTrigger {
  name: string;
  /** The graph workflow its saved target file names. */
  target: string;
  /** The saved file's `enabled`; null when it isn't a boolean. */
  enabled: boolean | null;
  /** The host's name rule, when the name breaks it. */
  nameProblem: string | null;
}

/** A graph trigger's host state, one of the eight, or unknown. */
export type TriggerHostState =
  | { kind: "nameRefused"; rule: string }
  | { kind: "notSubmitted" }
  /** `revision` is the retired current revision, when the host names one. */
  | { kind: "retired"; revision: number | null }
  /** `revision` is the newest pending candidate. */
  | { kind: "candidate"; revision: number }
  /** The saved files' digest at admitted revision `revision` isn't that revision's. */
  | { kind: "differs"; revision: number }
  /** Admitted revision `revision`, which doesn't fire until the owner enables it. */
  | { kind: "disabled"; revision: number }
  /** Admitted and enabled revision `revision`, which the host says can't fire: `blockers` are its codes. */
  | { kind: "blocked"; revision: number; blockers: string[] }
  /** Admitted and enabled revision `revision`, which nothing blocks. */
  | { kind: "admitted"; revision: number }
  | {
      kind: "unknown";
      /**
       * `host`: the host condition is neither signed in nor simulated host. `notChecked`: no
       * reading yet. `failed`: the last read failed.
       */
      why: "host" | "notChecked" | "failed";
      message?: string;
    };

export type KnownTriggerState = Exclude<TriggerHostState["kind"], "unknown">;

/** The eight states, worst first: the order they are derived in. */
export const TRIGGER_STATE_ORDER: readonly KnownTriggerState[] = [
  "nameRefused",
  "notSubmitted",
  "retired",
  "candidate",
  "differs",
  "disabled",
  "blocked",
  "admitted",
];

/** The `blockedBy` codes that only restate the trigger's own state, which the state already shows. */
const OWN_STATE_BLOCKERS = new Set(["TRIGGER_NOT_ADMITTED", "TRIGGER_RETIRED", "TRIGGER_DISABLED"]);

/** One revision as `triggers show` lists it. */
export interface TriggerRevision {
  revision: number;
  /** `CANDIDATE`, `ADMITTED`, `REJECTED` or `WITHDRAWN`, as the host gives it. */
  status: string;
  /** The revision it was submitted over; null for none or when the host doesn't say. */
  baseRevision: number | null;
  /** Null when the host gave none Quay can read. */
  digest: string | null;
  submittedAt: string | null;
}

/** One graph trigger's host state, and what it rests on. */
export interface GraphTriggerHostView {
  state: TriggerHostState;
  /** When the reading the state rests on was taken (ms since the epoch); null for none. */
  checkedAt: number | null;
  /** True once the reading is `MUTED_AFTER_MS` old: the state may be out of date. */
  muted: boolean;
  /** True while a read, or a digest of the saved files, that will update this trigger is in flight. */
  checking: boolean;
  /** The admission page of the newest pending candidate, when the host gave one. */
  admissionPageAddress: string | null;
  /** The host's current revision and when it was submitted; null without one. */
  current: { revision: number; submittedAt: string | null } | null;
  /**
   * True when Quay compared the saved files' digest at the current revision with that revision's.
   * False when either is missing, so Differs can't be told: the status line then gives `current`.
   */
  compared: boolean;
  /** The host's enabled state of an active trigger with a current revision; null otherwise. */
  hostEnabled: boolean | null;
  /** The saved file's `enabled`; null when it isn't a boolean or the trigger isn't listed. */
  savedEnabled: boolean | null;
  /** The revisions the latest `triggers show` listed, newest first; empty without one. */
  revisions: (TriggerRevision & { current: boolean })[];
  /** True when the host holds revisions older than those listed. */
  olderRevisions: boolean;
}

export interface TriggerHost {
  /** The local graph triggers, from the builder's list. Each new list digests the saved files again. */
  setLocal(triggers: readonly LocalGraphTrigger[]): void;
  /** The project's host condition. A failing one drops every reading. */
  setCondition(condition: HostCondition): void;
  /** The Triggers group is shown: the first time, reads everything. */
  groupShown(): Promise<void>;
  /** Check host: rereads everything. */
  checkHost(): Promise<void>;
  /** Check again: rereads one graph trigger. */
  checkAgain(name: string): Promise<void>;
  /**
   * Rereads one graph trigger after a write to it (#477): the read starts after any read of it in
   * flight, so it sees what the write did.
   */
  reread(name: string): Promise<void>;
  /**
   * The graph trigger whose form is on screen, or null when none is. While it shows a pending
   * candidate it is read again `CANDIDATE_POLL_MS` after each read ends; nothing else polls.
   */
  watch(name: string | null): void;
  /** True when `name` is a local graph trigger, so it has a host state at all. */
  has(name: string): boolean;
  trigger(name: string): GraphTriggerHostView;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Cancels every call in flight, clears the timers and keeps nothing more. */
  dispose(): void;
}

export interface TriggerHostOptions {
  projectPath: string;
  call?: Invoker;
}

/** A `triggers show` record, as far as the states and the Revisions panel need it. */
interface Detail {
  state: "PENDING" | "ACTIVE" | "RETIRED";
  enabled: boolean;
  currentRevision: number | null;
  /** Newest first, as the host lists them. */
  revisions: TriggerRevision[];
  olderRevisions: boolean;
  admissionPageAddress: string | null;
  /** What the host says blocks the trigger from firing, as its codes. */
  blockedBy: string[];
}

/** What one graph trigger's latest read found. */
type Reading =
  | { at: number; absent: true }
  | { at: number; failed: string }
  | { at: number; detail: Detail };

const stringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const revisionNumber = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 1 ? (v as number) : null);
const TRIGGER_STATES = new Set(["PENDING", "ACTIVE", "RETIRED"]);

function parseRevision(v: unknown): TriggerRevision[] {
  if (!isObject(v)) return [];
  const revision = revisionNumber(v.revision);
  if (revision === null || typeof v.status !== "string") return [];
  return [{ revision, status: v.status, baseRevision: revisionNumber(v.baseRevision), digest: stringOrNull(v.digest), submittedAt: stringOrNull(v.submittedAt) }];
}

/** A `triggers show` record (`aiws-graph-trigger/1`), or null when it lacks what the states need. */
function parseDetail(record: Record<string, unknown>): Detail | null {
  if (typeof record.state !== "string" || !TRIGGER_STATES.has(record.state)) return null;
  if (typeof record.enabled !== "boolean" || !Array.isArray(record.revisions) || !Array.isArray(record.blockedBy)) return null;
  if (record.currentRevision !== null && revisionNumber(record.currentRevision) === null) return null;
  return {
    state: record.state as Detail["state"],
    enabled: record.enabled,
    currentRevision: revisionNumber(record.currentRevision),
    revisions: record.revisions.flatMap(parseRevision),
    olderRevisions: record.nextBefore !== null && record.nextBefore !== undefined,
    admissionPageAddress: stringOrNull(record.admissionPageAddress),
    blockedBy: record.blockedBy.filter((b): b is string => typeof b === "string"),
  };
}

/** The names on a `triggers list` page and its cursor, or null when it holds none Quay can read. */
function parseListPage(record: Record<string, unknown>): { names: string[]; nextAfter: string | null } | null {
  if (!Array.isArray(record.triggers)) return null;
  const names = record.triggers.flatMap((t) => (isObject(t) && typeof t.name === "string" ? [t.name] : []));
  return { names, nextAfter: typeof record.nextAfter === "string" ? record.nextAfter : null };
}

/** The host's current revision, as its revisions list it; one the list doesn't reach has only its number. */
function currentOf(detail: Detail): TriggerRevision | null {
  const revision = detail.currentRevision;
  if (revision === null) return null;
  return detail.revisions.find((r) => r.revision === revision) ?? { revision, status: "ADMITTED", baseRevision: null, digest: null, submittedAt: null };
}

/**
 * The saved files' digest at each revision, as the backend last gave it, by revision; null for
 * one it can't compute.
 */
type LocalDigests = Map<number, string | null>;

/** The saved files' digest at `revision`, when the backend gave one for that revision. */
const digestAt = (local: LocalDigests | undefined, revision: number) => local?.get(revision) ?? null;

/** The state a `triggers show` gives, worst first, for saved files whose digests are `local`. */
function detailState(detail: Detail, local: LocalDigests | undefined): TriggerHostState {
  if (detail.state === "RETIRED") return { kind: "retired", revision: detail.currentRevision };
  // Revisions are newest first, so the first candidate is the newest.
  const candidate = detail.revisions.find((r) => r.status === "CANDIDATE");
  if (candidate) return { kind: "candidate", revision: candidate.revision };
  // A rejected or withdrawn candidate leaves the admitted revision's state; without one, nothing
  // the host holds can fire.
  const current = currentOf(detail);
  if (current === null) return { kind: "notSubmitted" };
  const { revision } = current;
  const saved = digestAt(local, revision);
  if (saved !== null && current.digest !== null && saved !== current.digest) return { kind: "differs", revision };
  if (!detail.enabled) return { kind: "disabled", revision };
  const blockers = detail.blockedBy.filter((b) => !OWN_STATE_BLOCKERS.has(b));
  if (blockers.length > 0) return { kind: "blocked", revision, blockers };
  return { kind: "admitted", revision };
}

/** The one key for `name`'s digest at `revision`: the revision, a number, follows the last line break. */
const digestKey = (name: string, revision: number) => `${name}\n${revision}`;

export function createTriggerHost({ projectPath, call = invoke }: TriggerHostOptions): TriggerHost {
  let local = new Map<string, LocalGraphTrigger>();
  let condition: HostCondition = { state: "notCheckedYet" };
  const readings = new Map<string, Reading>();
  const digests = new Map<string, LocalDigests>();
  // Bumped whenever readings are dropped, so an answer to a call asked before is ignored.
  let generation = 0;
  let shown = false;
  // One call in flight per read: a second ask for the same read joins it.
  let listInFlight: Promise<Set<string> | null> | null = null;
  const showsInFlight = new Map<string, Promise<void>>();
  const limit = createLimiter(MAX_SHOWS_IN_FLIGHT);
  // The latest digest asked for each name and revision, by `digestKey`, so an older answer never
  // replaces a newer one, and those in flight.
  const digestsAsked = new Map<string, number>();
  let digestAsks = 0;
  const digestsInFlight = new Set<string>();
  let watched: string | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const session = createHostReadSession({
    projectPath,
    call,
    stamps: () => [...readings.values()].map((r) => r.at),
    onChange: () => schedulePoll(),
  });
  const { praxis, changed } = session;

  /** Keeps the candidate poll's one timer set while the watched trigger shows a pending candidate and no read of it is in flight. */
  function schedulePoll() {
    const due = watched !== null && !session.disposed && !showsInFlight.has(watched) && stateOf(watched).state.kind === "candidate";
    if (!due) {
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      return;
    }
    if (pollTimer !== null) return;
    const name = watched as string;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void readShow(name);
    }, CANDIDATE_POLL_MS);
  }

  /**
   * Asks the backend for `name`'s saved files' digest at `revision`, and keeps it unless a later
   * ask for the same revision has been made since. A digest that can't be computed, or an ask
   * that fails, keeps null: Quay then doesn't claim Differs.
   */
  async function digest(name: string, revision: number): Promise<void> {
    const key = digestKey(name, revision);
    const asked = ++digestAsks;
    digestsAsked.set(key, asked);
    digestsInFlight.add(key);
    let found: string | null = null;
    try {
      const answer = await limit(() => call("praxis_trigger_digest", { projectPath, name, revision }));
      found = typeof answer === "string" ? answer : null;
    } catch {
      found = null;
    }
    if (session.disposed || digestsAsked.get(key) !== asked) return;
    digestsAsked.delete(key);
    digestsInFlight.delete(key);
    if (!local.has(name)) return;
    const kept = digests.get(name) ?? new Map<number, string | null>();
    kept.set(revision, found);
    digests.set(name, kept);
  }

  /** Keeps only `name`'s digest at `revision`, its current one, so each trigger keeps few. */
  function keepOnly(name: string, revision: number | null) {
    const kept = digests.get(name);
    if (!kept) return;
    for (const r of [...kept.keys()]) if (r !== revision) kept.delete(r);
  }

  /** Digests the saved files of each local graph trigger the host holds a current revision of. */
  function digestAll() {
    for (const name of local.keys()) {
      const reading = readings.get(name);
      const revision = reading && "detail" in reading ? reading.detail.currentRevision : null;
      if (revision !== null) void digest(name, revision).then(changed);
    }
  }

  /** Reads every `triggers list` page, up to `MAX_LIST_PAGES`; the names, or null when a page failed. */
  async function listNames(asked: number): Promise<Set<string> | null> {
    const names = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const outcome = await praxis("praxis_host_triggers_list", { limit: LIST_PAGE_LIMIT, after });
      if (session.disposed || asked !== generation || outcome.kind !== "record") return null;
      const parsed = parseListPage(outcome.record);
      if (!parsed) return null;
      for (const name of parsed.names) names.add(name);
      if (parsed.nextAfter === null) return names;
      after = parsed.nextAfter;
    }
    return names;
  }

  /** Reads the list, joining one in flight. Each local graph trigger it lacks is not submitted. */
  function readList(): Promise<Set<string> | null> {
    if (listInFlight) return listInFlight;
    const asked = generation;
    const read = listNames(asked).then((names) => {
      if (!names || session.disposed || asked !== generation) return null;
      const at = Date.now();
      for (const name of local.keys()) if (!names.has(name)) readings.set(name, { at, absent: true });
      return names;
    });
    listInFlight = read.finally(() => {
      listInFlight = null;
      changed();
    });
    changed();
    return listInFlight;
  }

  /**
   * Reads `triggers show name`, joining one in flight, at most `MAX_SHOWS_IN_FLIGHT` at once, and
   * then the saved files' digest at its current revision, so the state never shows before it can
   * tell Differs.
   */
  function readShow(name: string): Promise<void> {
    const joined = showsInFlight.get(name);
    if (joined) return joined;
    const asked = generation;
    const read = limit(() => praxis("praxis_host_trigger_show", { name })).then(async (outcome) => {
      if (session.disposed || asked !== generation || outcome.kind === "cancelled") return;
      const at = Date.now();
      if (outcome.kind === "record") {
        const detail = parseDetail(outcome.record);
        if (detail?.currentRevision != null && local.has(name)) await digest(name, detail.currentRevision);
        if (session.disposed || asked !== generation) return;
        readings.set(name, detail ? { at, detail } : { at, failed: "praxis gave a graph trigger Quay can't read." });
        keepOnly(name, detail?.currentRevision ?? null);
      } else if (outcome.kind === "hostRefused" && outcome.hostCode === "NOT_FOUND") readings.set(name, { at, absent: true });
      // A failing host condition drops readings anyway; any other failure is the trigger's.
      else if (!isHostLevelFailure(outcome)) readings.set(name, { at, failed: outcomeMessage(outcome) });
    });
    const tracked = read.finally(() => {
      showsInFlight.delete(name);
      changed();
    });
    showsInFlight.set(name, tracked);
    changed();
    return tracked;
  }

  /** The local graph triggers whose names `praxis` accepts. */
  const sendable = () => [...local.values()].filter((t) => t.nameProblem === null).map((t) => t.name);

  async function readAll(): Promise<void> {
    const names = await readList();
    if (!names || session.disposed) return;
    await Promise.all(sendable().filter((n) => names.has(n)).map(readShow));
  }

  /** The latest `triggers show` of `name`, while the host is online and its name is sendable. */
  function shownDetail(name: string): Detail | null {
    if (local.get(name)?.nameProblem || !online(condition)) return null;
    const reading = readings.get(name);
    return reading && "detail" in reading ? reading.detail : null;
  }

  function stateOf(name: string): { state: TriggerHostState; checkedAt: number | null } {
    const trigger = local.get(name);
    if (trigger?.nameProblem) return { state: { kind: "nameRefused", rule: trigger.nameProblem }, checkedAt: null };
    if (!online(condition)) return { state: { kind: "unknown", why: "host" }, checkedAt: null };
    const reading = readings.get(name);
    if (!reading) return { state: { kind: "unknown", why: "notChecked" }, checkedAt: null };
    if ("failed" in reading) return { state: { kind: "unknown", why: "failed", message: reading.failed }, checkedAt: reading.at };
    if ("absent" in reading) return { state: { kind: "notSubmitted" }, checkedAt: reading.at };
    return { state: detailState(reading.detail, digests.get(name)), checkedAt: reading.at };
  }

  return {
    setLocal(triggers) {
      local = new Map(triggers.map((t) => [t.name, t]));
      for (const name of [...digests.keys()]) if (!local.has(name)) digests.delete(name);
      digestAll();
      changed();
    },
    setCondition(next) {
      condition = next;
      if (hostConditionView(next).failing) {
        generation += 1;
        readings.clear();
      }
      changed();
    },
    groupShown() {
      if (shown || session.disposed) return Promise.resolve();
      shown = true;
      return readAll();
    },
    checkHost: () => (session.disposed ? Promise.resolve() : readAll()),
    checkAgain(name) {
      if (session.disposed || !local.has(name) || local.get(name)?.nameProblem) return Promise.resolve();
      return readShow(name);
    },
    reread(name) {
      if (session.disposed || !local.has(name) || local.get(name)?.nameProblem) return Promise.resolve();
      const joined = showsInFlight.get(name);
      return joined ? joined.then(() => readShow(name)) : readShow(name);
    },
    watch(name) {
      if (name === watched) return;
      watched = name;
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      schedulePoll();
    },
    has: (name) => local.has(name),
    trigger(name) {
      const { state, checkedAt } = stateOf(name);
      const detail = shownDetail(name);
      const current = detail ? currentOf(detail) : null;
      const saved = current === null ? null : digestAt(digests.get(name), current.revision);
      return {
        state,
        checkedAt,
        muted: checkedAt !== null && Date.now() - checkedAt >= MUTED_AFTER_MS,
        checking: showsInFlight.has(name) || listInFlight !== null || (current !== null && digestsInFlight.has(digestKey(name, current.revision))),
        admissionPageAddress: detail?.admissionPageAddress ?? null,
        current: current && { revision: current.revision, submittedAt: current.submittedAt },
        compared: current !== null && current.digest !== null && saved !== null,
        hostEnabled: detail?.state === "ACTIVE" && current !== null ? detail.enabled : null,
        savedEnabled: local.get(name)?.enabled ?? null,
        revisions: (detail?.revisions ?? []).map((r) => ({ ...r, current: r.revision === detail?.currentRevision })),
        olderRevisions: detail?.olderRevisions ?? false,
      };
    },
    subscribe: session.subscribe,
    dispose() {
      session.dispose();
      generation += 1;
      readings.clear();
      digests.clear();
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      watched = null;
    },
  };
}
