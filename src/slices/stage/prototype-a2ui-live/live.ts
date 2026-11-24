// PROTOTYPE (#711), throwaway. The A2UI module's live half: answers Rust's check on a scratch engine,
// keeps one live engine per surface outside React, and hands the unsent answer to Rust.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CATALOG_ID, MAX_COMPONENTS, draws, engine, errorBody } from "./catalog.tsx";
import { collapse, expand, questionsIn, type AskArgs } from "./ask.ts";

export const PAUSE_MS = 400;

interface SurfaceRecord {
  terminal_id: string;
  terminal_name: string;
  id: string;
  tool: "quay_ask" | "quay_surface";
  place: string;
  title: string | null;
  state: any;
  revision: number;
  draft: Record<string, unknown>;
  settled: unknown;
  asks: boolean;
  messages?: any[];
}

export interface Live {
  record: SurfaceRecord;
  surface: any;
  processor: any;
  /** What the agent's accepted state holds, to tell what the operator changed. */
  base: any;
  lastSent: string;
  timer: ReturnType<typeof setTimeout> | null;
  stop: () => void;
}

/** What a measurement reads: every step with the page's clock. */
export const probe = { events: [] as { at: number; what: string; detail?: unknown }[] };
const note = (what: string, detail?: unknown) => void probe.events.push({ at: performance.now(), what, detail });

const lives = new Map<string, Live>();
const keyOf = (r: { terminal_id: string; id: string }) => `${r.terminal_id} ${r.id}`;
let version = 0;
const subscribers = new Set<() => void>();
const changed = () => {
  version += 1;
  for (const s of subscribers) s();
};
export const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => void subscribers.delete(f);
};
export const getVersion = () => version;
export const livesOf = (terminalId: string) =>
  [...lives.values()].filter((l) => l.record.terminal_id === terminalId && l.record.place === "companion");

/** The latest asking arrival, so the companion can switch to its view. */
let arrival: { seq: number; terminalId: string } | null = null;
export const getArrival = () => arrival;

// --- unsent answer -------------------------------------------------------------------------

const token = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
/**
 * Data path to value for every leaf of `now` that differs from `base`. An array is a leaf unless
 * it holds objects.
 */
export function differences(base: any, now: any, at = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  const isBranch = (v: any) =>
    v !== null && typeof v === "object" && (!Array.isArray(v) || v.some((x) => x !== null && typeof x === "object"));
  if (isBranch(now)) {
    for (const key of Object.keys(now)) differences(base?.[key], now[key], `${at}/${token(key)}`, out);
  } else if (JSON.stringify(base) !== JSON.stringify(now)) out[at] = now;
  return out;
}

export function sendDraft(live: Live, why: string): void {
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;
  if (live.record.settled) return;
  const started = performance.now();
  const draft = differences(live.base, live.surface.dataModel.get("/"));
  const text = JSON.stringify(draft);
  if (text === live.lastSent) return;
  live.lastSent = text;
  const { terminal_id, id, revision } = live.record;
  note("draft-send", { why, id, bytes: text.length, diffMs: performance.now() - started });
  invoke("a2ui711_draft", { terminalId: terminal_id, id, revision, draft, why }).then(
    () => note("draft-ack", { id, ms: performance.now() - started }),
    (e) => note("draft-refused", String(e)),
  );
}

// --- live engine ---------------------------------------------------------------------------

function build(record: SurfaceRecord): Live {
  const processor = engine((a) => void act(live, a));
  processor.processMessages([structuredClone(record.state)]);
  const surface = processor.getSurface(record.id);
  const live: Live = {
    record,
    surface,
    processor,
    base: structuredClone(surface.dataModel.get("/")),
    lastSent: JSON.stringify(record.draft),
    timer: null,
    stop: () => {},
  };
  for (const [path, value] of Object.entries(record.draft)) surface.dataModel.set(path, value);
  // `subscribe("/")` hears every write at any depth.
  const sub = surface.dataModel.subscribe("/", () => {
    if (live.record.settled) return;
    if (live.timer) clearTimeout(live.timer);
    live.timer = setTimeout(() => sendDraft(live, "pause"), PAUSE_MS);
  });
  live.stop = () => {
    sub.unsubscribe();
    if (live.timer) clearTimeout(live.timer);
  };
  return live;
}

async function act(live: Live, action: any): Promise<void> {
  const { terminal_id, id, revision, tool } = live.record;
  note("action", action);
  const questions = () => questionsIn(live.surface).map((q) => q.text);
  const result = tool === "quay_ask" ? collapse(questions(), action.context) : { version: "1.0", action };
  await invoke("a2ui711_answer", { terminalId: terminal_id, id, revision, result }).then(
    (how) => note("answered", how),
    (e) => note("answer-refused", String(e)),
  );
}

function show(record: SurfaceRecord): void {
  const key = keyOf(record);
  const old = lives.get(key);
  if (old && record.settled) {
    old.stop();
    old.record = record;
  } else if (old && record.revision === old.record.revision + 1 && record.messages) {
    // An update goes into the engine that is on screen, so focus and what was typed stay.
    old.processor.processMessages(structuredClone(record.messages));
    old.base = structuredClone(record.state.createSurface.dataModel ?? {});
    old.record = record;
    note("update-applied", { id: record.id, revision: record.revision });
    sendDraft(old, "update");
  } else if (!old || record.revision !== old.record.revision) {
    old?.stop();
    lives.set(key, build(record));
    note("shown", { id: record.id });
  }
  if (record.asks && !record.settled && record.place === "companion" && !old)
    arrival = { seq: (arrival?.seq ?? 0) + 1, terminalId: record.terminal_id };
  changed();
}

// --- check ---------------------------------------------------------------------------------

const BARE = new Set(["accessibility", "checks", "catalogId", "metadata"]);
/** The pre-pass, as far as this proof needs it: the version and bare envelope keys. */
function prePass(messages: any[]): object | null {
  for (const [n, m] of messages.entries()) {
    if (m?.version !== "1.0")
      return {
        code: "VALIDATION_FAILED",
        path: `/messages/${n}/version`,
        message: `Quay accepts A2UI 1.0 only. This message says "${m?.version}".`,
      };
    const body = m.createSurface ?? m.updateComponents;
    for (const [k, c] of (body?.components ?? []).entries())
      for (const key of Object.keys(c))
        if (BARE.has(key))
          return {
            code: "VALIDATION_FAILED",
            path: `/messages/${n}/components/${k}/${key}`,
            message: `A2UI 1.0 spells this @${key}.`,
          };
  }
  return null;
}

/** The surface's accepted state as one compact `createSurface`. */
const compact = (surface: any) => ({
  version: "1.0",
  createSurface: {
    surfaceId: surface.id,
    catalogId: CATALOG_ID,
    components: [...surface.componentsModel.values].map((c: any) => ({ id: c.id, component: c.type, ...c.properties })),
    dataModel: surface.dataModel.get("/"),
  },
});

interface CheckRequest {
  tool: string;
  id: string | null;
  arguments: any;
  states: Record<string, any>;
}
export function check(request: CheckRequest): any {
  const scratch = engine(() => {});
  let id = "";
  // All of it, so that arguments of the wrong shape are refused and not left without a verdict
  try {
    const messages: any[] =
      request.tool === "quay_ask"
        ? [expand(request.arguments as AskArgs, request.id ?? "ask", CATALOG_ID)]
        : (request.arguments.messages ?? []).map((m: any) =>
            m?.createSurface ? { ...m, createSurface: { catalogId: CATALOG_ID, ...m.createSurface } } : m,
          );
    const refused = prePass(messages);
    if (refused) return { errors: [refused] };
    const bodies: any[] = messages.map((m) => Object.values(m).find((v: any) => v?.surfaceId));
    id = bodies[0]?.surfaceId ?? "";
    const stored = new Map(Object.entries(request.states)).get(id);
    if (stored && !messages[0].createSurface) scratch.processMessages([structuredClone(stored)]);
    scratch.processMessages(structuredClone(messages));
    const surface = scratch.getSurface(id);
    const components = surface.componentsModel.size;
    if (components > MAX_COMPONENTS)
      return {
        errors: [
          {
            code: "VALIDATION_FAILED",
            message: `A surface has at most ${MAX_COMPONENTS} components; this one would have ${components}.`,
          },
        ],
      };
    const asks = [...surface.componentsModel.values].some((c: any) => c.properties.action?.event);
    const sets = messages.filter((m) => m.updateDataModel).map((m) => m.updateDataModel.path ?? "/");
    return { id, state: structuredClone(compact(surface)), asks, components, sets };
  } catch (e) {
    return { errors: [errorBody(e, id || undefined)] };
  } finally {
    scratch.dispose();
  }
}

// --- wiring --------------------------------------------------------------------------------

async function start(): Promise<void> {
  // Listen first, so nothing that arrives while the list is read is missed.
  const onCheck = (payload: any) => {
    const started = performance.now();
    const verdict = check(payload);
    verdict.webview_ms = Math.round((performance.now() - started) * 10) / 10;
    note("check", { call: payload.call, ms: verdict.webview_ms, components: verdict.components });
    invoke("a2ui711_verdict", { call: payload.call, verdict }).catch((e) => note("verdict-refused", String(e)));
  };
  await listen<any>("a2ui711-check", ({ payload }) => onCheck(payload));
  await listen<SurfaceRecord>("a2ui711-show", ({ payload }) => show(payload));
  const asked = performance.now();
  const list = await invoke<SurfaceRecord[]>("a2ui711_list");
  for (const record of list) if (!lives.has(keyOf(record))) lives.set(keyOf(record), build(record));
  const at = performance.now();
  note("rebuilt", { count: list.length, ms: at - asked, sinceNavigation: at });
  const line = `rebuilt ${list.length} in ${(at - asked).toFixed(1)}ms, ${at.toFixed(0)}ms after navigation`;
  invoke("a2ui711_log", { line }).catch((e) => note("log-refused", String(e)));
  changed();
  // A check sent while this page was loading reached no listener
  for (const missed of await invoke<any[]>("a2ui711_checks")) onCheck(missed);
}

const flushAll = (why: string) => {
  for (const live of lives.values()) sendDraft(live, why);
};
window.addEventListener("pagehide", () => flushAll("pagehide"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAll("hidden");
});

Object.assign(window, { __a2ui711: { probe, lives, check, engine, draws } });
start().catch((e) => console.error("[a2ui711] the surfaces could not be rebuilt", e));
