// The unsent answer: what the operator has put in a surface and not sent. Rust holds it beside the
// surface, so a page that loads has it again. The page keeps it too, for a surface that comes back to
// the screen. It holds only what differs from the accepted state, and none of what the frame works out
// again.
import { invoke } from "@tauri-apps/api/core";
import { carriedOn, touches } from "./carried.ts";
import { differences, type DataValues } from "./differences.ts";
import type { SurfaceData } from "./layout.ts";
import type { Carried, SurfaceKey, SurfaceRecord } from "./surfaceTypes.ts";
import { typedTool } from "./typed/index.ts";

/** How long after the operator's last change it is sent to Rust, in milliseconds. */
const PAUSE_MS = 400;

/** Which of the surfaces a terminal has had by one id, and which revision of it. */
type Version = Pick<SurfaceRecord, "order" | "revision">;

const sameVersion = (a: Version, b: Version) => a.order === b.order && a.revision === b.revision;

/** What is unsent in a surface, as Rust holds it. Mirrors `Unsent`. */
interface Unsent extends SurfaceKey, Version {
  values: DataValues;
}

/** What Rust gives a page that loads. Mirrors `Page`. */
export interface Page {
  page: number;
  unsent: Unsent[];
}

/** What is kept of a surface that is not settled. */
interface Kept extends Version {
  /** What of an earlier revision's is kept, when it is known. */
  carried: Carried | null;
  /** What is unsent, as JSON, so nothing the engine does to its lists reaches it. */
  values: string;
  /** What of it the surface on the screen has no room for. */
  leftOut: DataValues;
}

const NOTHING = "{}";
const kept = new Map<string, Kept>();
/** By surface, what saves at once what the operator has put in the one on the screen. */
const followed = new Map<string, () => void>();
/** This page's number, or null until Rust has given it. */
let page: number | null = null;
let saves = 0;

const keyOf = ({ terminal_id, id }: SurfaceKey) => JSON.stringify([terminal_id, id]);

/** Starts saving as the page `opened` says, with what Rust held. */
export function openPage(opened: Page): void {
  page = opened.page;
  for (const unsent of opened.unsent) {
    const key = keyOf(unsent);
    const its = kept.get(key);
    const { order, revision, values } = unsent;
    // A surface that came while the page opened is newer than what Rust had of that id
    if (its && its.order !== order) continue;
    if (its && its.revision > revision) {
      if (its.carried) its.values = JSON.stringify(carriedOn(its.carried, revision, values));
      continue;
    }
    kept.set(key, { order, revision, carried: its?.carried ?? null, values: JSON.stringify(values), leftOut: {} });
  }
}

/** Keeps and saves nothing more, until a page is opened. */
export function closePage(): void {
  page = null;
  kept.clear();
}

/**
 * Says that `record` is not settled, so what is unsent in it is kept from here on, and what was put in an
 * earlier revision of it up to now as far as that is carried on.
 */
export function keepUnsent(record: SurfaceRecord): void {
  saveUnsentNow(record);
  if (keptFor(record)) return;
  const { order, revision, carried } = record;
  const before = kept.get(keyOf(record));
  const goesOn = before !== undefined && before.order === order && before.revision < revision;
  const values = goesOn ? JSON.stringify(carriedOn(carried, before.revision, JSON.parse(before.values))) : NOTHING;
  kept.set(keyOf(record), { order, revision, carried, values, leftOut: {} });
}

/** Saves at once what is unsent in the surface `key`, if it is drawn. */
export function saveUnsentNow(key: SurfaceKey): void {
  followed.get(keyOf(key))?.();
}

/** Drops what is unsent in a surface that is settled, or that Quay no longer has. */
export function dropUnsent(key: SurfaceKey): void {
  kept.delete(keyOf(key));
}

/** What is kept for `record`: not for another surface of the same id, nor for another revision of it. */
function keptFor(record: SurfaceRecord): Kept | null {
  const its = kept.get(keyOf(record));
  return its && sameVersion(its, record) ? its : null;
}

/** What is unsent in `record`. */
export const unsentIn = (record: SurfaceRecord): DataValues => JSON.parse(keptFor(record)?.values ?? NOTHING);

/** Says that `values`, of what is unsent in `record`, are not in the surface on the screen. They stay unsent until the operator puts something else there. */
export function leaveOut(record: SurfaceRecord, values: DataValues): void {
  const its = keptFor(record);
  if (its) its.leftOut = values;
}

function save(record: SurfaceRecord, data: SurfaceData): void {
  const its = keptFor(record);
  if (!its) return;
  const workedOut = typedTool(record.tool)?.workedOut ?? [];
  const differing = Object.entries(differences(record.state.createSurface.dataModel, data.get("/")));
  const put = Object.fromEntries(differing.filter(([path]) => !workedOut.includes(path)));
  its.leftOut = Object.fromEntries(Object.entries(its.leftOut).filter(([path]) => !Object.keys(put).some((other) => touches(other, path))));
  const values = { ...its.leftOut, ...put };
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
  const key = keyOf(record);
  followed.set(key, saveNow);
  return () => {
    unsubscribe();
    if (followed.get(key) === saveNow) followed.delete(key);
    window.removeEventListener("pagehide", saveNow);
    saveNow();
  };
}
