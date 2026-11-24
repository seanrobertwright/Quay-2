// What a message is rejected for before the engine sees it: the forms of earlier versions that the
// engine lets through, what Quay does not take of 1.0, and the data path that is Quay's own.
import type { EngineError } from "../../surfaceTypes.ts";
import { CATALOG_ID, catalog } from "../catalog.ts";
import { hasOwn, invalid, isObject, messageAt, type Message, type Place } from "./callErrors.ts";

type Report = (place: Place, message: string) => void;

/** The keys of a component that 1.0 spells with an `@`. */
const ENVELOPE: ReadonlySet<string> = new Set(["accessibility", "checks", "catalogId", "metadata"]);

/** The keys of a binding that 1.0 spells with an `@`. */
const BINDING = ["path", "call"];

const spelled = (key: string) => `A2UI 1.0 spells this \`@${key}\`.`;

const FRAME_IS_QUAYS = 'Quay keeps "/frame" for itself. Use another path.';

/** What Quay takes of no message, by its key. */
const REFUSED: Readonly<Record<string, string>> = {
  callRendererFunction: "Quay offers no function an agent may call.",
  agentFunctionResponse: "Quay sends no function calls to an agent.",
};

/** Whether `path` is the frame's data path or under it. At a surface's root a relative path is one from there. */
const isFrames = (path: string) => path.split("/").find((step) => step !== "") === "frame";

/** Reports what is wrong with the property `value` of a component. The keys of a `free` object are its own, so none of them is a binding's. */
function checkValue(value: unknown, place: Place, report: Report, free = false): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkValue(item, [...place, i], report));
    return;
  }
  if (!isObject(value)) return;
  const isCall = "@call" in value || "call" in value;
  const isEvent = place[place.length - 1] === "event";
  for (const [key, inner] of Object.entries(value)) {
    const at = [...place, key];
    if (!free && BINDING.includes(key)) report(at, spelled(key));
    else if (key === "@path" && typeof inner === "string" && isFrames(inner)) report(at, FRAME_IS_QUAYS);
    else checkValue(inner, at, report, (isCall && key === "args") || (isEvent && key === "context"));
  }
}

function checkComponent(component: Record<string, unknown>, place: Place, report: Report): void {
  const type = String(component.component);
  const listRefs = hasOwn(catalog.componentRefMap, type) ? catalog.componentRefMap[type].listRefs : null;
  for (const [key, value] of Object.entries(component)) {
    const at = [...place, key];
    if (ENVELOPE.has(key)) report(at, spelled(key));
    else if (listRefs?.has(key) && isObject(value) && "componentId" in value) {
      // A template, whose path 1.0 spells without an @
      if (typeof value.path === "string" && isFrames(value.path)) report([...at, "path"], FRAME_IS_QUAYS);
    } else if (key !== "@metadata") checkValue(value, at, report);
  }
}

/** Reports `components` in the order they are written. */
function checkComponents(components: unknown, place: Place, report: Report): void {
  if (!Array.isArray(components)) return;
  components.forEach((component: unknown, i) => {
    if (isObject(component)) checkComponent(component, [...place, i], report);
  });
}

function checkRoot(data: unknown, place: Place, report: Report): void {
  if (isObject(data) && hasOwn(data, "frame")) report([...place, "frame"], FRAME_IS_QUAYS);
}

function checkCreate(body: Record<string, unknown>, place: Place, report: Report): void {
  for (const [key, value] of Object.entries(body)) {
    const at = [...place, key];
    if (key === "theme") report(at, "A2UI 1.0 has no `theme`. Leave it out.");
    else if (key === "sendDataModel") report(at, "Quay returns an action's context only. Put the values you need in the action's context.");
    else if (key === "catalogId" && value !== CATALOG_ID) report(at, `Quay's catalog is \`${CATALOG_ID}\`. Leave catalogId out, and see quay_surface_guide.`);
    else if (key === "components") checkComponents(value, at, report);
    else if (key === "dataModel") checkRoot(value, at, report);
  }
}

function checkDataUpdate({ path, value }: Record<string, unknown>, place: Place, report: Report): void {
  if (typeof path === "string" && isFrames(path)) report([...place, "path"], FRAME_IS_QUAYS);
  const setsAll = path === undefined || (typeof path === "string" && !/[^/]/.test(path));
  if (setsAll) checkRoot(value, [...place, "value"], report);
}

function checkBody({ kind, body, place }: Message, report: Report): void {
  if (!isObject(body)) return;
  if (kind === "createSurface") checkCreate(body, place, report);
  else if (kind === "updateComponents") checkComponents(body.components, [...place, "components"], report);
  else if (kind === "updateDataModel") checkDataUpdate(body, place, report);
}

export interface PrePassed {
  /** The message, or null when it is none that a raw call may hold. */
  message: Message | null;
  /** What is wrong with it. The engine sees a message with none only. */
  errors: readonly EngineError[];
}

/** The message `written` at `index` of a call. */
export function prePass(written: unknown, index: number): PrePassed {
  const place = ["messages", index];
  const message = messageAt(index, written);
  if (isObject(written)) {
    const { version, ...rest } = written;
    if (version !== "1.0" && Object.keys(rest).length > 0) {
      const says = version === undefined ? "no version" : JSON.stringify(version);
      return { message, errors: [invalid([...place, "version"], `Quay accepts A2UI 1.0 only. This message says ${says}.`, message?.surfaceId)] };
    }
    const refused = Object.keys(REFUSED).find((key) => hasOwn(rest, key));
    if (refused) return { message: null, errors: [invalid([...place, refused], REFUSED[refused])] };
  }
  if (!message) return { message, errors: [invalid(place, "A message has a version and one of createSurface, updateComponents, updateDataModel and deleteSurface.")] };
  const errors: EngineError[] = [];
  checkBody(message, (at, said) => errors.push(invalid(at, said, message.surfaceId)));
  return { message, errors };
}
