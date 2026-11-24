// The webview's side of the surfaces: it answers Rust's checks and keeps what Rust says is shown.
import { useCallback, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CheckRequest, SurfaceRecord, Verdict } from "./surfaceTypes.ts";

/** The A2UI module. It is large, so nothing imports it until the shell has been drawn. */
export const loadA2ui = () => import("./a2ui/index.ts");

const NONE: readonly SurfaceRecord[] = [];
let byTerminal: ReadonlyMap<string, readonly SurfaceRecord[]> = new Map();
const subscribers = new Set<() => void>();

function set(next: typeof byTerminal): void {
  byTerminal = next;
  for (const subscriber of subscribers) subscriber();
}

/** Keeps `record`, unless what is kept of that surface is as new. */
function keep(record: SurfaceRecord): void {
  const surfaces = byTerminal.get(record.terminal_id) ?? NONE;
  const kept = surfaces.find((s) => s.id === record.id);
  if (kept && kept.change >= record.change) return;
  const next = [...surfaces.filter((s) => s !== kept), record].sort((a, b) => a.order - b.order);
  set(new Map(byTerminal).set(record.terminal_id, next));
}

async function answerCheck(request: CheckRequest): Promise<void> {
  const { check } = await loadA2ui();
  const verdict: Verdict = check(request);
  await invoke("surface_verdict", { call: request.call, verdict });
}

/**
 * Starts answering checks and keeping surfaces, until the returned function is called. The webview
 * listens first, so nothing that comes while it reads the list is missed, then reads the list, then
 * every check that has no verdict: a check sent while it was loading reached nobody.
 */
export function startSurfaces(): () => void {
  let stopped = false;
  const failed = (what: string) => (error: unknown) => {
    if (!stopped) console.error(`[surfaces] ${what}`, error);
  };
  const onCheck = (request: CheckRequest) => {
    if (!stopped) answerCheck(request).catch(failed("A check could not be answered"));
  };
  const onRecord = (record: SurfaceRecord) => {
    if (!stopped) keep(record);
  };
  const listening = Promise.all([
    listen<CheckRequest>("surface-check", (event) => onCheck(event.payload)),
    listen<SurfaceRecord>("surface-changed", (event) => onRecord(event.payload)),
  ]);
  const start = async () => {
    await listening;
    if (stopped) return;
    for (const record of await invoke<SurfaceRecord[]>("surface_list")) onRecord(record);
    if (stopped) return;
    for (const request of await invoke<CheckRequest[]>("surface_checks")) onCheck(request);
  };
  start().catch(failed("The surfaces could not be read"));
  const frame = requestAnimationFrame(() => void loadA2ui().catch(failed("The A2UI module could not be loaded")));
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    set(new Map());
    listening.then((unlisten) => unlisten.forEach((stop) => stop()), failed("The surfaces could not be listened for"));
  };
}

/** `terminalId`'s surfaces, oldest first. */
export function useSurfacesOf(terminalId: string | null): readonly SurfaceRecord[] {
  const subscribe = useCallback((changed: () => void) => {
    subscribers.add(changed);
    return () => void subscribers.delete(changed);
  }, []);
  return useSyncExternalStore(subscribe, () => (terminalId === null ? NONE : (byTerminal.get(terminalId) ?? NONE)));
}

/** Sends the operator's answer. It rejects with Quay's words for why it was not taken. */
export function answerSurface(record: SurfaceRecord, answer: unknown): Promise<void> {
  return invoke("surface_answer", { terminalId: record.terminal_id, id: record.id, revision: record.revision, answer });
}
