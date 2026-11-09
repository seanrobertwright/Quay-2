// Each graph workflow's state on the Praxis host (#444, #461): the one model behind the list
// badge, the graph workflow form's status line and its Revisions panel. It has no UI of its own.
//
// It reaches the host only through the Praxis CLI runner's graph commands (#460). It reads with
// `graphs list`, page by page, then `graphs show` for each local graph workflow the host has, at
// most two at a time. Its one write is `graphs withdraw` for a pending candidate (#463), after
// which it reads that graph workflow again. Readings live in memory for the project's builder
// session, never on disk. Each is stamped with the time it was read and turns muted, not dropped,
// after `MUTED_AFTER_MS`, ten minutes, as a template's do. When the host goes offline, every
// reading is dropped.
import { invoke } from "@tauri-apps/api/core";
import { hostConditionView } from "./hostCondition.ts";
import { createHostReadSession, createLimiter, isObject, MAX_SHOWS_IN_FLIGHT, MUTED_AFTER_MS, online } from "./hostReadSession.ts";
import { isHostLevelFailure, outcomeMessage, type CallOutcome, type HostCondition, type Invoker } from "./praxisHost.ts";

/** A local graph workflow as the builder's list has it. */
export interface LocalGraphWorkflow {
  name: string;
  /** The bundle digest of the saved files it names, as the host computes it; null when Quay can't compute it. */
  bundleDigest: string | null;
  /** The host's name rule, when the name breaks it. */
  nameProblem: string | null;
}

/** A graph workflow's host state, one of the seven, or unknown. */
export type GraphHostState =
  | { kind: "nameRefused"; rule: string }
  | { kind: "notSubmitted" }
  /** `revision` is the retired current revision, when the host names one. */
  | { kind: "retired"; revision: number | null }
  /** `revision` is the newest pending candidate. */
  | { kind: "candidate"; revision: number }
  /** The saved files' bundle digest isn't admitted revision `revision`'s. */
  | { kind: "differs"; revision: number }
  /** Admitted revision `revision`, which the host says can't run, and why. */
  | { kind: "notReady"; revision: number; reason: string }
  /** Admitted revision `revision`, which the host can run. */
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

/** What one Withdraw came to, in the words the confirm shows. */
export type WithdrawOutcome =
  | { kind: "withdrawn" }
  /** No withdrawal: the host refused it, such as for a candidate already decided, or couldn't be asked. */
  | { kind: "refused"; message: string }
  /** Quay can't tell whether the host withdrew it. */
  | { kind: "unknown"; message: string };

export type KnownGraphState = "nameRefused" | "notSubmitted" | "retired" | "candidate" | "differs" | "notReady" | "admitted";

/** The seven states, worst first: the order they are derived in. */
export const GRAPH_STATE_ORDER: readonly KnownGraphState[] = ["nameRefused", "notSubmitted", "retired", "candidate", "differs", "notReady", "admitted"];

/** How often a form showing a pending candidate reads it again. */
export const CANDIDATE_POLL_MS = 15_000;

/** The graph workflows a `graphs list` page holds, as the runner bounds it. */
export const LIST_PAGE_LIMIT = 100;

/** The most `graphs list` pages one read follows: as many names as the builder lists. */
export const MAX_LIST_PAGES = 10;

/** One graph workflow's host state, and what it rests on. */
export interface GraphWorkflowHostView {
  state: GraphHostState;
  /** When the reading the state rests on was taken (ms since the epoch); null for none. */
  checkedAt: number | null;
  /** True once the reading is `MUTED_AFTER_MS` old: the state may be out of date. */
  muted: boolean;
  /** True while a read that will update this graph workflow is in flight. */
  checking: boolean;
  /** The admission page of the newest pending candidate, when the host gave one. */
  admissionPageAddress: string | null;
  /** The host's current revision and when it was submitted; null without one. */
  current: { revision: number; submittedAt: string | null } | null;
  /**
   * True when Quay compared the saved files' bundle digest with the current revision's. False
   * when either is missing, so Differs can't be told: the status line then gives `current`.
   */
  compared: boolean;
  /**
   * True when Quay compared the bundle digests and the saved files aren't the current revision's,
   * whatever the state: a pending candidate outranks Differs, but the current revision still runs.
   */
  differsFromCurrent: boolean;
  /** The review digest of the host's review of the current revision, for Run's confirm; null when the host gave none. */
  reviewDigest: string | null;
  /** The revisions the latest `graphs show` listed, newest first; empty without one. */
  revisions: (HostRevision & { current: boolean })[];
  /** True when the host holds revisions older than those listed. */
  olderRevisions: boolean;
}

export interface GraphHost {
  /** The local graph workflows, from the builder's list. */
  setLocal(workflows: readonly LocalGraphWorkflow[]): void;
  /** The project's host condition. A failing one drops every reading. */
  setCondition(condition: HostCondition): void;
  /** The Graph workflows group is shown: the first time, reads everything. */
  groupShown(): Promise<void>;
  /** Check host: rereads everything. */
  checkHost(): Promise<void>;
  /** Check again, and after a submit or a withdrawal: rereads one graph workflow. */
  checkAgain(name: string): Promise<void>;
  /**
   * Withdraws pending candidate `revision` of `name` (`praxis graphs withdraw`), then rereads it,
   * and resolves once that read is in. A repeat while one is in flight joins it. After an outcome
   * praxis couldn't confirm, the next withdrawal of the same revision resends its request id.
   */
  withdraw(name: string, revision: number): Promise<WithdrawOutcome>;
  /**
   * The graph workflow whose form is on screen, or null when none is. While it shows a pending
   * candidate it is read again `CANDIDATE_POLL_MS` after each read ends; nothing else polls.
   */
  watch(name: string | null): void;
  workflow(name: string): GraphWorkflowHostView;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Cancels every call in flight, clears the timers and keeps nothing more. */
  dispose(): void;
}

export interface GraphHostOptions {
  projectPath: string;
  call?: Invoker;
}

/** One revision as `graphs show` lists it. */
export interface HostRevision {
  revision: number;
  /** `CANDIDATE`, `ADMITTED`, `REJECTED`, `WITHDRAWN`, `CURRENT` or `RETIRED`, as the host gives it. */
  status: string;
  /** Null when the host gave none Quay can read. */
  bundleDigest: string | null;
  submittedAt: string | null;
  /** When the owner admitted or rejected it, or it was withdrawn; null when the host doesn't say. */
  decidedAt: string | null;
}

/** A `graphs show` record, as far as the states and the Revisions panel need it. */
interface Detail {
  retired: boolean;
  currentRevision: number | null;
  runnable: boolean;
  /** Newest first, as the host lists them. */
  revisions: HostRevision[];
  /** True when the host holds revisions older than those listed. */
  olderRevisions: boolean;
  admissionPageAddress: string | null;
  /** Why the host says the current revision can't run: each not-ready agent's reasons, by node. */
  notReadyReasons: string[];
  /** The `reviewDigest` of the host's review of the current revision, when it gave one. */
  reviewDigest: string | null;
}

/** What one graph workflow's latest read found. */
type Reading =
  | { at: number; absent: true }
  | { at: number; failed: string }
  | { at: number; detail: Detail };

const stringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const revisionNumber = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 1 ? (v as number) : null);

function parseRevision(v: unknown): HostRevision[] {
  if (!isObject(v)) return [];
  const revision = revisionNumber(v.revision);
  if (revision === null || typeof v.status !== "string") return [];
  return [
    {
      revision,
      status: v.status,
      bundleDigest: stringOrNull(v.bundleDigest),
      submittedAt: stringOrNull(v.submittedAt),
      decidedAt: stringOrNull(v.decidedAt),
    },
  ];
}

/** A `graphs show` record (`aiws-graph-workflow/1`), or null when it lacks what the states need. */
function parseDetail(record: Record<string, unknown>): Detail | null {
  if ((record.state !== "ACTIVE" && record.state !== "RETIRED") || typeof record.runnable !== "boolean" || !Array.isArray(record.revisions)) return null;
  if (record.currentRevision !== null && revisionNumber(record.currentRevision) === null) return null;
  return {
    retired: record.state === "RETIRED",
    currentRevision: revisionNumber(record.currentRevision),
    runnable: record.runnable,
    revisions: record.revisions.flatMap(parseRevision),
    olderRevisions: record.nextBefore !== null && record.nextBefore !== undefined,
    admissionPageAddress: stringOrNull(record.admissionPageAddress),
    notReadyReasons: notReadyReasons(record.review),
    reviewDigest: isObject(record.review) ? stringOrNull(record.review.reviewDigest) : null,
  };
}

/** `node: reason` for each reason of each agent a `review` says isn't ready. */
function notReadyReasons(review: unknown): string[] {
  if (!isObject(review) || !Array.isArray(review.agents)) return [];
  return review.agents.flatMap((a) => {
    if (!isObject(a) || a.ready !== false || !Array.isArray(a.reasons)) return [];
    const node = typeof a.nodeId === "string" ? `${a.nodeId}: ` : "";
    return a.reasons.filter((r): r is string => typeof r === "string").map((r) => `${node}${r}`);
  });
}

/** What a `praxis_host_graph_withdraw` outcome means for the person who pressed Withdraw. */
function withdrawOutcomeOf(outcome: CallOutcome, name: string, revision: number): WithdrawOutcome {
  const which = `revision ${revision} of ${name}`;
  switch (outcome.kind) {
    case "record":
      return { kind: "withdrawn" };
    case "hostRefused":
      if (outcome.hostCode === "REVISION_NOT_PENDING") {
        return { kind: "refused", message: `The host refused: ${which} is no longer pending. The owner has admitted or rejected it, or it was withdrawn already.` };
      }
      return { kind: "refused", message: `The host refused to withdraw ${which}: ${outcome.message}` };
    case "unknown":
      return {
        kind: "unknown",
        message: `Quay can't tell whether the host withdrew ${which}: ${outcome.detail}${outcome.requestId ? " Withdraw again resends the same request." : ""}`,
      };
    case "timedOut":
      return { kind: "unknown", message: `praxis didn't answer in time, so Quay can't tell whether the host withdrew ${which}.` };
    case "cancelled":
      return { kind: "unknown", message: `praxis was stopped before it said whether the host withdrew ${which}.` };
    default:
      return { kind: "refused", message: `Quay didn't withdraw ${which}: ${outcomeMessage(outcome)}` };
  }
}

const NO_REASON = "The host says this graph workflow can't run, and gave no reason.";

/** The names on a `graphs list` page and its cursor, or null when it holds none Quay can read. */
function parseListPage(record: Record<string, unknown>): { names: string[]; nextAfter: string | null } | null {
  if (!Array.isArray(record.workflows)) return null;
  const names = record.workflows.flatMap((w) => (isObject(w) && typeof w.name === "string" ? [w.name] : []));
  return { names, nextAfter: typeof record.nextAfter === "string" ? record.nextAfter : null };
}

/**
 * The host's current revision, as its revisions list it; a revision the list doesn't reach has
 * only its number. Null when the host has none.
 */
function currentOf(detail: Detail): HostRevision | null {
  const revision = detail.currentRevision;
  if (revision === null) return null;
  return detail.revisions.find((r) => r.revision === revision) ?? { revision, status: "CURRENT", bundleDigest: null, submittedAt: null, decidedAt: null };
}

/** The state a `graphs show` gives, worst first, for saved files with bundle digest `digest`. */
function detailState(detail: Detail, digest: string | null): GraphHostState {
  if (detail.retired) return { kind: "retired", revision: detail.currentRevision };
  // Revisions are newest first, so the first candidate is the newest.
  const candidate = detail.revisions.find((r) => r.status === "CANDIDATE");
  if (candidate) return { kind: "candidate", revision: candidate.revision };
  // A rejected or withdrawn candidate leaves the admitted revision's state; without one, nothing
  // the host holds can run.
  const current = currentOf(detail);
  if (current === null) return { kind: "notSubmitted" };
  const { revision } = current;
  const hostDigest = current.bundleDigest;
  if (digest !== null && hostDigest !== null && hostDigest !== digest) return { kind: "differs", revision };
  if (!detail.runnable) return { kind: "notReady", revision, reason: detail.notReadyReasons.join(" ") || NO_REASON };
  return { kind: "admitted", revision };
}

/**
 * The one key for a withdrawal of `name`'s revision `revision`, in the in-flight and unconfirmed
 * maps. The revision, a number, follows the last line break, so no two pairs share a key.
 */
const withdrawalKey = (name: string, revision: number) => `${name}\n${revision}`;

export function createGraphHost({ projectPath, call = invoke }: GraphHostOptions): GraphHost {
  let local = new Map<string, LocalGraphWorkflow>();
  let condition: HostCondition = { state: "notCheckedYet" };
  const readings = new Map<string, Reading>();
  // Bumped whenever readings are dropped, so an answer to a call asked before is ignored.
  let generation = 0;
  let shown = false;
  // One call in flight per read: a second ask for the same read joins it.
  let listInFlight: Promise<Set<string> | null> | null = null;
  const showsInFlight = new Map<string, Promise<void>>();
  const limit = createLimiter(MAX_SHOWS_IN_FLIGHT);
  const withdrawalsInFlight = new Map<string, Promise<WithdrawOutcome>>();
  // The request id of each withdrawal praxis couldn't confirm, by `withdrawalKey`, to resend.
  const unconfirmed = new Map<string, string>();
  let watched: string | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const session = createHostReadSession({
    projectPath,
    call,
    stamps: () => [...readings.values()].map((r) => r.at),
    onChange: () => schedulePoll(),
  });
  const { praxis, changed } = session;

  /**
   * Keeps the candidate poll's one timer set while the watched graph workflow shows a pending
   * candidate and no read of it is in flight, and clear otherwise.
   */
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

  /** Reads every `graphs list` page, up to `MAX_LIST_PAGES`; the names, or null when a page failed. */
  async function listNames(asked: number): Promise<Set<string> | null> {
    const names = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const outcome = await praxis("praxis_host_graphs_list", { limit: LIST_PAGE_LIMIT, after });
      if (session.disposed || asked !== generation || outcome.kind !== "record") return null;
      const parsed = parseListPage(outcome.record);
      if (!parsed) return null;
      for (const name of parsed.names) names.add(name);
      if (parsed.nextAfter === null) return names;
      after = parsed.nextAfter;
    }
    return names;
  }

  /** Reads the list, joining one in flight. Each local graph workflow it lacks is not submitted. */
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

  /** Reads `graphs show name`, joining one in flight, at most `MAX_SHOWS_IN_FLIGHT` at once. */
  function readShow(name: string): Promise<void> {
    const joined = showsInFlight.get(name);
    if (joined) return joined;
    const asked = generation;
    const read = limit(() => praxis("praxis_host_graph_show", { name })).then((outcome) => {
      if (session.disposed || asked !== generation || outcome.kind === "cancelled") return;
      const at = Date.now();
      if (outcome.kind === "record") {
        const detail = parseDetail(outcome.record);
        readings.set(name, detail ? { at, detail } : { at, failed: "praxis gave a graph workflow Quay can't read." });
      }
      else if (outcome.kind === "hostRefused" && outcome.hostCode === "NOT_FOUND") readings.set(name, { at, absent: true });
      // A failing host condition drops readings anyway; any other failure is the graph workflow's.
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

  /** A read of `name` that starts after any read of it in flight, so it sees what came before. */
  function rereadShow(name: string): Promise<void> {
    const joined = showsInFlight.get(name);
    return joined ? joined.then(() => readShow(name)) : readShow(name);
  }

  async function sendWithdrawal(name: string, revision: number, key: string): Promise<WithdrawOutcome> {
    const nameProblem = local.get(name)?.nameProblem;
    if (nameProblem) return { kind: "refused", message: nameProblem };
    const outcome = await praxis("praxis_host_graph_withdraw", { name, revision, requestId: unconfirmed.get(key) ?? null });
    if (outcome.kind === "unknown" && outcome.requestId) unconfirmed.set(key, outcome.requestId);
    else if (outcome.kind === "record" || outcome.kind === "hostRefused") unconfirmed.delete(key);
    if (!session.disposed) await rereadShow(name);
    return withdrawOutcomeOf(outcome, name, revision);
  }

  /** The local graph workflows whose names `praxis` accepts. */
  const sendable = () => [...local.values()].filter((w) => w.nameProblem === null).map((w) => w.name);

  async function readAll(): Promise<void> {
    const names = await readList();
    if (!names || session.disposed) return;
    await Promise.all(sendable().filter((n) => names.has(n)).map(readShow));
  }

  /** The latest `graphs show` of `name`, while the host is online and its name is sendable. */
  function shownDetail(name: string): Detail | null {
    if (local.get(name)?.nameProblem || !online(condition)) return null;
    const reading = readings.get(name);
    return reading && "detail" in reading ? reading.detail : null;
  }

  function stateOf(name: string): { state: GraphHostState; checkedAt: number | null } {
    const workflow = local.get(name);
    if (workflow?.nameProblem) return { state: { kind: "nameRefused", rule: workflow.nameProblem }, checkedAt: null };
    if (!online(condition)) return { state: { kind: "unknown", why: "host" }, checkedAt: null };
    const reading = readings.get(name);
    if (!reading) return { state: { kind: "unknown", why: "notChecked" }, checkedAt: null };
    if ("failed" in reading) return { state: { kind: "unknown", why: "failed", message: reading.failed }, checkedAt: reading.at };
    if ("absent" in reading) return { state: { kind: "notSubmitted" }, checkedAt: reading.at };
    return { state: detailState(reading.detail, workflow?.bundleDigest ?? null), checkedAt: reading.at };
  }

  return {
    setLocal(workflows) {
      local = new Map(workflows.map((w) => [w.name, w]));
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
      if (session.disposed || local.get(name)?.nameProblem) return Promise.resolve();
      return readShow(name);
    },
    withdraw(name, revision) {
      const key = withdrawalKey(name, revision);
      const joined = withdrawalsInFlight.get(key);
      if (joined) return joined;
      const sent = sendWithdrawal(name, revision, key).finally(() => {
        withdrawalsInFlight.delete(key);
        changed();
      });
      withdrawalsInFlight.set(key, sent);
      changed();
      return sent;
    },
    watch(name) {
      if (name === watched) return;
      watched = name;
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      schedulePoll();
    },
    workflow(name) {
      const { state, checkedAt } = stateOf(name);
      const detail = shownDetail(name);
      const current = detail ? currentOf(detail) : null;
      const localDigest = local.get(name)?.bundleDigest ?? null;
      const compared = current !== null && current.bundleDigest !== null && localDigest !== null;
      return {
        state,
        checkedAt,
        muted: checkedAt !== null && Date.now() - checkedAt >= MUTED_AFTER_MS,
        checking: showsInFlight.has(name) || listInFlight !== null,
        admissionPageAddress: detail?.admissionPageAddress ?? null,
        current: current && { revision: current.revision, submittedAt: current.submittedAt },
        compared,
        differsFromCurrent: compared && current?.bundleDigest !== localDigest,
        reviewDigest: current === null ? null : (detail?.reviewDigest ?? null),
        revisions: (detail?.revisions ?? []).map((r) => ({ ...r, current: r.revision === detail?.currentRevision })),
        olderRevisions: detail?.olderRevisions ?? false,
      };
    },
    subscribe: session.subscribe,
    dispose() {
      session.dispose();
      generation += 1;
      readings.clear();
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = null;
      watched = null;
    },
  };
}
