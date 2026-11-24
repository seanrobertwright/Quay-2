// The webview's side of the surfaces: it answers Rust's checks and keeps what Rust says is shown.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { paced } from "./paced.ts";
import { isLive, type CheckRequest, type SurfaceKey, type SurfaceRecord, type Verdict } from "./surfaceTypes.ts";
import { closePage, dropUnsent, keepEnded, keepUnsent, openPage, type Page } from "./unsent.ts";

/** The A2UI module. It is large, so nothing imports it until the shell has been drawn. */
export const loadA2ui = () => import("./a2ui/index.ts");

const NONE: readonly SurfaceRecord[] = [];
let byTerminal: ReadonlyMap<string, readonly SurfaceRecord[]> = new Map();
/** Whether the surfaces Rust held when the page loaded are kept, or could not be read. */
let listDone = false;
const subscribers = new Set<() => void>();

function set(next: typeof byTerminal): void {
  byTerminal = next;
  for (const subscriber of subscribers) subscriber();
}

/** Calls `changed` after every change to the surfaces kept, until the returned function is called. */
export function subscribeToSurfaces(changed: () => void): () => void {
  subscribers.add(changed);
  return () => void subscribers.delete(changed);
}

/** Every surface kept, by terminal, each terminal's oldest first. A terminal with none is absent. */
export const surfacesByTerminal = (): ReadonlyMap<string, readonly SurfaceRecord[]> => byTerminal;

/** Keeps `record`, unless what is kept of that surface is as new. */
function keep(record: SurfaceRecord): void {
  const surfaces = byTerminal.get(record.terminal_id) ?? NONE;
  const kept = surfaces.find((s) => s.id === record.id);
  if (kept && kept.change >= record.change) return;
  // Before anything draws again: what goes off the screen by it sends nothing more, and one that ended
  // is drawn with all that was put in it
  if (isLive(record)) keepUnsent(record);
  else if (record.ended_at !== null) keepEnded(record);
  else dropUnsent(record);
  const next = [...surfaces.filter((s) => s !== kept), record].sort((a, b) => a.order - b.order);
  set(new Map(byTerminal).set(record.terminal_id, next));
}

/** Drops the surface `terminal_id` had as `id`, if it is kept. */
function drop({ terminal_id, id }: SurfaceKey): void {
  dropUnsent({ terminal_id, id });
  const left = (byTerminal.get(terminal_id) ?? NONE).filter((s) => s.id !== id);
  const next = new Map(byTerminal);
  if (left.length > 0) next.set(terminal_id, left);
  else next.delete(terminal_id);
  set(next);
}

async function answerCheck(request: CheckRequest): Promise<void> {
  const { check } = await loadA2ui();
  const verdict: Verdict = check(request);
  await invoke("surface_verdict", { call: request.call, verdict });
}

/**
 * Starts answering checks and keeping surfaces, until the returned function is called. The webview
 * listens first, so nothing that comes while it reads the list is missed, then reads what is unsent in
 * the surfaces, which they are drawn with, then the list, then every check that has no verdict: a check
 * sent while it was loading reached nobody.
 */
export function startSurfaces(): () => void {
  let stopped = false;
  const failed = (what: string) => (error: unknown) => {
    if (!stopped) console.error(`[surfaces] ${what}`, error);
  };
  const onCheck = (request: CheckRequest) => {
    if (!stopped) answerCheck(request).catch(failed("A check could not be answered"));
  };
  // A board may be sent as often as its agent likes
  const boards = paced(keep);
  const onRecord = (record: SurfaceRecord) => {
    if (stopped) return;
    if (record.board) boards.take(record);
    else keep(record);
  };
  const leave = (key: SurfaceKey) => {
    boards.forget(key);
    drop(key);
  };
  // What left while the list was read, which may still be in it. Null once the list has been kept.
  let leftMeanwhile: SurfaceKey[] | null = [];
  const onRemoved = (key: SurfaceKey) => {
    if (stopped) return;
    leftMeanwhile?.push(key);
    leave(key);
  };
  const listening = Promise.all([
    listen<CheckRequest>("surface-check", (event) => onCheck(event.payload)),
    listen<SurfaceRecord>("surface-changed", (event) => onRecord(event.payload)),
    listen<SurfaceKey>("surface-removed", (event) => onRemoved(event.payload)),
  ]);
  const listRead = () => {
    if (stopped) return;
    listDone = true;
    set(byTerminal);
  };
  const readList = async () => {
    await listening;
    if (stopped) return;
    for (const record of await invoke<SurfaceRecord[]>("surface_list")) onRecord(record);
    if (stopped) return;
    leftMeanwhile?.forEach(leave);
    leftMeanwhile = null;
  };
  const readUnsent = async () => {
    await listening;
    if (stopped) return;
    const page = await invoke<Page>("surface_open_page");
    if (!stopped) openPage(page);
  };
  const start = async () => {
    await readUnsent().catch(failed("What was not sent could not be read"));
    if (stopped) return;
    await readList().finally(listRead);
    if (stopped) return;
    for (const request of await invoke<CheckRequest[]>("surface_checks")) onCheck(request);
  };
  start().catch(failed("The surfaces could not be read"));
  const frame = requestAnimationFrame(() => void loadA2ui().catch(failed("The A2UI module could not be loaded")));
  return () => {
    stopped = true;
    boards.stop();
    cancelAnimationFrame(frame);
    listDone = false;
    closePage();
    set(new Map());
    listening.then((unlisten) => unlisten.forEach((stop) => stop()), failed("The surfaces could not be listened for"));
  };
}

/** `terminalId`'s surfaces, oldest first. */
export function useSurfacesOf(terminalId: string | null): readonly SurfaceRecord[] {
  return useSyncExternalStore(subscribeToSurfaces, () => (terminalId === null ? NONE : (byTerminal.get(terminalId) ?? NONE)));
}

/**
 * Whether the surfaces Rust held when the page loaded are known, with what is unsent in them. Until
 * then a surface that comes may be one the operator has seen already. Also true once they could not
 * be read.
 */
export const useSurfacesRead = (): boolean => useSyncExternalStore(subscribeToSurfaces, () => listDone);

/** Dismisses a surface. It rejects with Quay's words for why it stays. */
export function dismissSurface({ terminal_id, id }: SurfaceKey): Promise<void> {
  return invoke("surface_dismiss", { terminalId: terminal_id, id });
}

/** Dismisses those of `terminalId`'s surfaces `ids` that are locked, of which no agent is told. It rejects with why they stay. */
export function dismissLocked(terminalId: string, ids: readonly string[]): Promise<void> {
  return invoke("surface_dismiss_locked", { terminalId, ids });
}

/** Sends the operator's answer. It rejects with Quay's words for why it was not taken. */
export function answerSurface(record: SurfaceRecord, answer: unknown): Promise<void> {
  return invoke("surface_answer", { terminalId: record.terminal_id, id: record.id, revision: record.revision, answer });
}
