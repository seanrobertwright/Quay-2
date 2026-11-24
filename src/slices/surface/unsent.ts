// The unsent answer: what the operator has put in a surface and not sent. Rust holds it beside the
// surface, so a page that loads has it again. The page keeps it too, for a surface that comes back to
// the screen. It holds only what differs from the accepted state, and none of what the frame works out
// again.
import { invoke } from "@tauri-apps/api/core";
import { differences, type DataValues } from "./differences.ts";
import type { SurfaceData } from "./layout.ts";
import type { SurfaceKey, SurfaceRecord } from "./surfaceTypes.ts";
import { READY } from "./typed/ask.ts";

/** How long after the operator's last change it is sent to Rust, in milliseconds. */
export const PAUSE_MS = 400;

/** What is unsent in a surface, as Rust holds it. Mirrors `Unsent`. */
interface Unsent extends SurfaceKey {
  order: number;
  revision: number;
  values: DataValues;
}

/** What Rust gives a page that loads. Mirrors `Page`. */
export interface Page {
  page: number;
  unsent: Unsent[];
}

/** What is kept of a live surface. */
interface Kept {
  order: number;
  revision: number;
  /** What is unsent, as JSON, so nothing the engine does to its lists reaches it. */
  values: string;
}

const NOTHING = "{}";
const kept = new Map<string, Kept>();
/** This page's number, or null until Rust has given it. */
let page: number | null = null;
let saves = 0;

const keyOf = ({ terminal_id, id }: SurfaceKey) => JSON.stringify([terminal_id, id]);

/** Starts saving as the page `opened` says, with what Rust held. */
export function openPage(opened: Page): void {
  page = opened.page;
  for (const { terminal_id, id, order, revision, values } of opened.unsent) {
    const key = keyOf({ terminal_id, id });
    const its = kept.get(key);
    // A surface that came while the page opened is newer than what Rust had of that id
    if (its && (its.order !== order || its.revision !== revision)) continue;
    kept.set(key, { order, revision, values: JSON.stringify(values) });
  }
}

/** Keeps and saves nothing more, until a page is opened. */
export function closePage(): void {
  page = null;
  kept.clear();
}

/** Says that `record` is live, so what is unsent in it is kept from here on. */
export function keepUnsent({ terminal_id, id, order, revision }: SurfaceRecord): void {
  const key = keyOf({ terminal_id, id });
  const its = kept.get(key);
  if (its?.order !== order || its.revision !== revision) kept.set(key, { order, revision, values: NOTHING });
}

/** Drops what is unsent in a surface that is settled, or that Quay no longer has. */
export function dropUnsent(key: SurfaceKey): void {
  kept.delete(keyOf(key));
}

/** What is kept for `record`: not for another surface of the same id, nor for another revision of it. */
function keptFor(record: SurfaceRecord): Kept | null {
  const its = kept.get(keyOf(record));
  return its?.order === record.order && its.revision === record.revision ? its : null;
}

/** What is unsent in `record`. */
export const unsentIn = (record: SurfaceRecord): DataValues => JSON.parse(keptFor(record)?.values ?? NOTHING);

function save(record: SurfaceRecord, data: SurfaceData): void {
  const its = keptFor(record);
  if (!its) return;
  const { [READY]: _ready, ...values } = differences(record.state.createSurface.dataModel, data.get("/"));
  const text = JSON.stringify(values);
  if (text === its.values) return;
  its.values = text;
  if (page === null) return;
  const { terminal_id, id, order, revision } = record;
  saves += 1;
  const unsent = { page, save: saves, order, revision, values };
  invoke("surface_save_unsent", { terminalId: terminal_id, id, unsent }).catch((error) =>
    console.error("[surfaces] What was not sent could not be kept for a reload", error),
  );
}

/** Keeps what the operator puts in `record`, whose data model is `data`, until the returned function is called. */
export function followUnsent(record: SurfaceRecord, data: SurfaceData): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const saveNow = () => {
    clearTimeout(timer);
    save(record, data);
  };
  const unsubscribe = data.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(saveNow, PAUSE_MS);
  });
  window.addEventListener("pagehide", saveNow);
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", saveNow);
    saveNow();
  };
}
