// The catalog reader and each workflow template's host state (#363, #449): the one model behind
// the list badges, the template form's status line, the Install dialog and the Run confirm. It
// has no UI of its own.
//
// It reads the host only through the Praxis CLI runner's commands (#446): one `workflows list`,
// then `workflows show` for each local template the host has installed, at most two at a time.
// Readings live in memory for the project's builder session, never on disk. Each is stamped
// with the time it was read and turns muted, not dropped, after `MUTED_AFTER_MS`. A verdict is
// tied to the saved file's digest it compared, so a save that changes the file invalidates it
// at once. When the host goes offline, every per-template reading is dropped.
import { invoke } from "@tauri-apps/api/core";
import { hostConditionView } from "./hostCondition.ts";
import { isHostLevelFailure, outcomeMessage, type CallOutcome, type HostCondition, type Invoker } from "./praxisHost.ts";

/** A local workflow template as the builder's list has it. */
export interface LocalTemplate {
  name: string;
  /** The saved file's digest as the host computes it; null when Quay can't compute it. */
  digest: string | null;
  /** The host's name rule, when the name breaks it. */
  nameProblem: string | null;
}

/** A template's host state, one of the six, or unknown. */
export type TemplateHostState =
  | { kind: "nameRefused"; rule: string }
  | { kind: "notInstalled" }
  | { kind: "invalidOnHost"; diagnostics: string[] }
  | { kind: "differs" }
  | { kind: "notReady"; reason: string }
  | { kind: "installed" }
  | {
      kind: "unknown";
      /**
       * `host`: the host condition is neither signed in nor simulated host. `notChecked`: no
       * reading yet, or the saved file changed since. `failed`: the last read failed.
       */
      why: "host" | "notChecked" | "failed";
      message?: string;
    };

export type KnownHostState = Exclude<TemplateHostState["kind"], "unknown">;

/** The six states, worst first: the order they are derived in. */
export const HOST_STATE_ORDER: readonly KnownHostState[] = [
  "nameRefused",
  "notInstalled",
  "invalidOnHost",
  "differs",
  "notReady",
  "installed",
];

/** How long a reading is current; after it, the state is shown muted ("may be out of date"). */
export const MUTED_AFTER_MS = 10 * 60_000;

/** The most `workflows show` calls the reader runs at once. */
export const MAX_SHOWS_IN_FLIGHT = 2;

/** One template's host state, and what it rests on. */
export interface TemplateHostView {
  state: TemplateHostState;
  /** When the reading the state rests on was taken (ms since the epoch); null for none. */
  checkedAt: number | null;
  /** True once the reading is `MUTED_AFTER_MS` old: the state may be out of date. */
  muted: boolean;
  /** True while a read that will update this template is in flight. */
  checking: boolean;
}

/** The host's installed copy of a template, as its latest `workflows show` names it. */
export interface HostCopy {
  revision: number | null;
  digest: string | null;
}

/** A host template with no local file of the same name, from the latest `list`. */
export interface HostOnlyTemplate {
  name: string;
  revision: number | null;
  description: string | null;
  valid: boolean;
  diagnostics: string[];
}

export interface HostCatalog {
  /** The local templates, from the builder's list. A changed digest invalidates that verdict. */
  setLocal(templates: readonly LocalTemplate[]): void;
  /** The project's host condition. A failing one drops every per-template reading. */
  setCondition(condition: HostCondition): void;
  /** The Workflow templates group is shown: the first time, reads everything. */
  groupShown(): Promise<void>;
  /** `name` was saved with `digest`: rechecks that template only. */
  saved(name: string, digest: string | null): Promise<void>;
  /** Check host: rereads everything. */
  checkHost(): Promise<void>;
  /** Check again: rereads one template. */
  checkAgain(name: string): Promise<void>;
  template(name: string): TemplateHostView;
  /**
   * The revision and `templateDigest` of the host's installed copy of `name`, from its latest
   * `workflows show`; null without one, or while the host is offline. A field the host left out
   * is null.
   */
  hostCopy(name: string): HostCopy | null;
  /** Host templates with no local file, matched by exact name; empty unless the host is online. */
  hostOnly(): HostOnlyTemplate[];
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Cancels every call in flight, clears the timer and keeps nothing more. */
  dispose(): void;
}

export interface HostCatalogOptions {
  projectPath: string;
  call?: Invoker;
}

/** A `list` entry, parsed. */
interface ListEntry {
  name: string;
  revision: number | null;
  description: string | null;
  valid: boolean;
  diagnostics: string[];
}

/** A `show` record, parsed, as far as the states need it. */
interface Detail {
  revision: number | null;
  valid: boolean;
  diagnostics: string[];
  templateDigest: string | null;
  runnable: boolean;
  reasons: string[];
}

type ShowReading =
  | { at: number; comparedDigest: string | null; detail: Detail }
  | { at: number; comparedDigest: string | null; failed: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function messages(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d) => (isObject(d) && typeof d.message === "string" ? [d.message] : []));
}

/** The entries of a `workflows list` record, or null when it holds none Quay can read. */
function parseList(record: Record<string, unknown>): ListEntry[] | null {
  if (!Array.isArray(record.templates)) return null;
  return record.templates.flatMap((t) =>
    isObject(t) && typeof t.name === "string"
      ? [
          {
            name: t.name,
            revision: typeof t.revision === "number" ? t.revision : null,
            description: typeof t.description === "string" ? t.description : null,
            valid: t.validity === "VALID",
            diagnostics: messages(t.diagnostics),
          },
        ]
      : [],
  );
}

/** A `workflows show` record, or null when it lacks what the states need. */
function parseDetail(record: Record<string, unknown>): Detail | null {
  if (typeof record.runnable !== "boolean") return null;
  const digest = record.templateDigest;
  if (digest !== null && typeof digest !== "string") return null;
  const readiness = record.readiness;
  return {
    revision: typeof record.revision === "number" ? record.revision : null,
    valid: record.validity === "VALID",
    diagnostics: messages(record.diagnostics),
    templateDigest: digest,
    runnable: record.runnable,
    reasons: isObject(readiness) && Array.isArray(readiness.reasons) ? readiness.reasons.filter((r) => typeof r === "string") : [],
  };
}

/** Why the host says a template can't run. */
function notReadyReason(detail: Detail): string {
  if (detail.reasons.length > 0) return detail.reasons.join(" ");
  if (detail.diagnostics.length > 0) return detail.diagnostics.join(" ");
  return "The host says this template can't run, and gave no reason.";
}

const online = (condition: HostCondition) => hostConditionView(condition).usable;

/**
 * Runs at most `limit` tasks at once, in the order they were queued. The limit is this queue's,
 * so no caller can run past it.
 */
function createLimiter(limit: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (running >= limit) return;
    const start = queue.shift();
    if (start) start();
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        running += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            next();
          });
      });
      next();
    });
  };
}

export function createHostCatalog({ projectPath, call = invoke }: HostCatalogOptions): HostCatalog {
  let local = new Map<string, LocalTemplate>();
  let condition: HostCondition = { state: "notCheckedYet" };
  let list: { at: number; entries: Map<string, ListEntry> } | null = null;
  const shows = new Map<string, ShowReading>();
  // Bumped whenever readings are dropped, so an answer to a call asked before is ignored.
  let generation = 0;
  let disposed = false;
  let shown = false;
  // One call in flight per read: a second ask for the same read joins it.
  let listInFlight: Promise<boolean> | null = null;
  const showsInFlight = new Map<string, Promise<void>>();
  const callIds = new Set<string>();
  const listeners = new Set<() => void>();
  const limit = createLimiter(MAX_SHOWS_IN_FLIGHT);
  let muteTimer: ReturnType<typeof setTimeout> | null = null;

  const changed = () => {
    if (disposed) return;
    scheduleMute();
    for (const listener of listeners) listener();
  };

  /** Wakes listeners when the next current reading turns muted. */
  function scheduleMute() {
    if (muteTimer !== null) clearTimeout(muteTimer);
    muteTimer = null;
    const now = Date.now();
    const stamps = [list?.at, ...[...shows.values()].map((s) => s.at)].filter(
      (at): at is number => at !== undefined && now - at < MUTED_AFTER_MS,
    );
    if (stamps.length === 0) return;
    muteTimer = setTimeout(changed, Math.min(...stamps) + MUTED_AFTER_MS - now);
  }

  /** One `praxis` call through the runner, cancelled by `dispose`. */
  async function praxis(command: string, args: Record<string, unknown>): Promise<CallOutcome> {
    const callId = crypto.randomUUID();
    callIds.add(callId);
    try {
      return (await call(command, { projectPath, callId, ...args })) as CallOutcome;
    } catch (e) {
      return { kind: "refused", message: String(e) };
    } finally {
      callIds.delete(callId);
    }
  }

  /** Reads `list`, joining one in flight; true when a reading was kept. */
  function readList(): Promise<boolean> {
    if (listInFlight) return listInFlight;
    const asked = generation;
    const read = praxis("praxis_host_workflows_list", {}).then((outcome) => {
      if (disposed || asked !== generation || outcome.kind !== "record") return false;
      const entries = parseList(outcome.record);
      if (!entries) return false;
      list = { at: Date.now(), entries: new Map(entries.map((e) => [e.name, e])) };
      for (const name of shows.keys()) if (!list.entries.has(name)) shows.delete(name);
      return true;
    });
    listInFlight = read.finally(() => {
      listInFlight = null;
      changed();
    });
    changed();
    return listInFlight;
  }

  /** Reads `show name`, joining one in flight, at most `MAX_SHOWS_IN_FLIGHT` at once. */
  function readShow(name: string): Promise<void> {
    const joined = showsInFlight.get(name);
    if (joined) return joined;
    const asked = generation;
    const read = limit(() => praxis("praxis_host_workflow_show", { name })).then((outcome) => {
      if (disposed || asked !== generation || outcome.kind === "cancelled") return;
      const at = Date.now();
      // The verdict compares the host's copy with the saved file as it is when the answer comes.
      const comparedDigest = local.get(name)?.digest ?? null;
      if (outcome.kind !== "record") {
        // A failing host condition drops readings anyway; any other failure is the template's.
        if (!isHostLevelFailure(outcome)) {
          shows.set(name, { at, comparedDigest, failed: outcomeMessage(outcome) });
        }
        return;
      }
      const detail = parseDetail(outcome.record);
      shows.set(name, detail ? { at, comparedDigest, detail } : { at, comparedDigest, failed: "praxis gave a template detail Quay can't read." });
    });
    const tracked = read.finally(() => {
      showsInFlight.delete(name);
      changed();
    });
    showsInFlight.set(name, tracked);
    changed();
    return tracked;
  }

  /** The local templates the latest `list` has installed, and whose names `praxis` accepts. */
  const installedLocals = () =>
    [...local.values()].filter((t) => t.nameProblem === null && list?.entries.has(t.name)).map((t) => t.name);

  async function readAll(): Promise<void> {
    if (!(await readList()) || disposed) return;
    await Promise.all(installedLocals().map(readShow));
  }

  async function readOne(name: string): Promise<void> {
    const template = local.get(name);
    if (template?.nameProblem) return;
    if (!list?.entries.has(name)) {
      if (!(await readList()) || disposed) return;
      if (!list?.entries.has(name)) return;
    }
    await readShow(name);
  }

  function drop() {
    generation += 1;
    list = null;
    shows.clear();
  }

  function stateOf(name: string): { state: TemplateHostState; checkedAt: number | null } {
    const template = local.get(name);
    if (template?.nameProblem) return { state: { kind: "nameRefused", rule: template.nameProblem }, checkedAt: null };
    if (!online(condition)) return { state: { kind: "unknown", why: "host" }, checkedAt: null };
    if (!list) return { state: { kind: "unknown", why: "notChecked" }, checkedAt: null };
    const entry = list.entries.get(name);
    if (!entry) return { state: { kind: "notInstalled" }, checkedAt: list.at };
    if (!entry.valid) return { state: { kind: "invalidOnHost", diagnostics: entry.diagnostics }, checkedAt: list.at };
    const show = shows.get(name);
    const digest = template?.digest ?? null;
    if (!show || show.comparedDigest !== digest) return { state: { kind: "unknown", why: "notChecked" }, checkedAt: null };
    if ("failed" in show) return { state: { kind: "unknown", why: "failed", message: show.failed }, checkedAt: show.at };
    const { detail } = show;
    if (!detail.valid) return { state: { kind: "invalidOnHost", diagnostics: detail.diagnostics }, checkedAt: show.at };
    if (digest === null || detail.templateDigest === null) {
      return { state: { kind: "unknown", why: "failed", message: "Quay can't tell whether the host's copy is this file." }, checkedAt: show.at };
    }
    if (detail.templateDigest !== digest) return { state: { kind: "differs" }, checkedAt: show.at };
    if (!detail.runnable) return { state: { kind: "notReady", reason: notReadyReason(detail) }, checkedAt: show.at };
    return { state: { kind: "installed" }, checkedAt: show.at };
  }

  return {
    setLocal(templates) {
      local = new Map(templates.map((t) => [t.name, t]));
      changed();
    },
    setCondition(next) {
      condition = next;
      if (hostConditionView(next).failing) drop();
      changed();
    },
    groupShown() {
      if (shown || disposed) return Promise.resolve();
      shown = true;
      return readAll();
    },
    saved(name, digest) {
      const template = local.get(name);
      local.set(name, { name, nameProblem: template?.nameProblem ?? null, digest });
      changed();
      // A template the host doesn't have stays not installed until the host restarts.
      if (disposed || !list?.entries.has(name)) return Promise.resolve();
      return readOne(name);
    },
    checkHost: () => (disposed ? Promise.resolve() : readAll()),
    checkAgain: (name) => (disposed ? Promise.resolve() : readOne(name)),
    template(name) {
      const { state, checkedAt } = stateOf(name);
      const checking = showsInFlight.has(name) || listInFlight !== null;
      return { state, checkedAt, muted: checkedAt !== null && Date.now() - checkedAt >= MUTED_AFTER_MS, checking };
    },
    hostCopy(name) {
      const show = online(condition) ? shows.get(name) : undefined;
      if (!show || !("detail" in show)) return null;
      return { revision: show.detail.revision, digest: show.detail.templateDigest };
    },
    hostOnly() {
      if (!online(condition) || !list) return [];
      return [...list.entries.values()].filter((e) => !local.has(e.name)).map((e) => ({ ...e }));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      drop();
      if (muteTimer !== null) clearTimeout(muteTimer);
      muteTimer = null;
      listeners.clear();
      for (const callId of callIds) void call("praxis_host_cancel", { callId }).catch(() => {});
    },
  };
}
