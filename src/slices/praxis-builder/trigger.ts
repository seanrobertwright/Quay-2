// The trigger form's rules (#223): a new trigger's record, and the edits that keep the
// fields that apply to its kind and action. `schedule` belongs to SCHEDULED, `conditionMode`
// to CONDITION and `waitId` to RESUME_WAIT, so changing the kind or action adds them with
// their smallest legal values and removes them when they stop applying. `filter` is optional
// on every kind but CONDITION, so it is kept. The backend validates the whole trigger with
// the SDK; these rules only shape what the form shows.
import type { Step } from "./history.ts";
import { idProblem } from "./lifecycle.ts";
import { isObject, withField, type Json, type JsonObject } from "./model.ts";

export const TRIGGER_KINDS = [
  "MANUAL",
  "SCHEDULED",
  "EVENT",
  "RESOURCE_CHANGE",
  "CONDITION",
  "WORKFLOW_LIFECYCLE",
  "EXTERNAL_RESPONSE",
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_ACTIONS = ["START_RUN", "RESUME_WAIT"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

export const isTriggerKind = (v: string): v is TriggerKind => (TRIGGER_KINDS as readonly string[]).includes(v);
export const isTriggerAction = (v: string): v is TriggerAction => (TRIGGER_ACTIONS as readonly string[]).includes(v);

export const CATCH_UP_MODES = ["SKIP", "LATEST", "ALL"] as const;
export const CONDITION_MODES = ["EDGE", "LEVEL"] as const;

/**
 * A new trigger's record (#223): a disabled MANUAL trigger that starts a run. Its counts
 * start at their smallest legal value, and its times and contract are left empty, so they
 * are flagged until set. The revision is a placeholder that the first save replaces with
 * the content digest.
 */
export function newTriggerContent(id: string): JsonObject {
  return {
    id,
    revision: "unsaved",
    kind: "MANUAL",
    source: "",
    eventType: "",
    contractId: "",
    action: "START_RUN",
    enabled: false,
    notBefore: "",
    expiresAt: "",
    maxAgeMs: "0",
    maxConcurrent: "1",
    rateLimit: "1",
    rateWindowMs: "1",
    maxDepth: "0",
  };
}

/** A SCHEDULED trigger's schedule as it starts: no start time guessed, and the smallest interval and catch-up. */
const newSchedule = (): JsonObject => ({ startMs: "", intervalMs: "1", catchUp: "SKIP", maxCatchUp: "1" });

/** A filter as it starts: no field, and an empty string to match. */
export const newFilter = (): JsonObject => ({ field: "", equals: "" });

/** The objects inside a trigger whose fields the form edits one at a time. */
export type NestedKey = "schedule" | "filter";

/** One change to a trigger draft. `live` marks a field being typed, which merges into the step before it. */
export type TriggerEdit =
  /** Sets a field, or removes it when `value` is undefined. */
  | { type: "set-field"; key: string; value: Json | undefined; live?: boolean }
  /** Sets a field of the schedule or filter; nothing when there is none. */
  | { type: "set-nested"; key: NestedKey; field: string; value: Json; live?: boolean }
  | { type: "set-kind"; kind: TriggerKind }
  | { type: "set-action"; action: TriggerAction };

/** The record after `edit`, or the same object when it changes nothing. */
export function applyTriggerEdit(content: JsonObject, edit: TriggerEdit): JsonObject {
  switch (edit.type) {
    case "set-field":
      return withField(content, edit.key, edit.value);
    case "set-nested": {
      const inner = content[edit.key];
      if (!isObject(inner)) return content;
      return withField(content, edit.key, withField(inner, edit.field, edit.value));
    }
    case "set-kind": {
      let next = withField(content, "kind", edit.kind);
      const scheduled = edit.kind === "SCHEDULED";
      const condition = edit.kind === "CONDITION";
      next = withField(next, "schedule", scheduled ? (isObject(next.schedule) ? next.schedule : newSchedule()) : undefined);
      if (condition && !isObject(next.filter)) next = withField(next, "filter", newFilter());
      const mode = typeof next.conditionMode === "string" ? next.conditionMode : CONDITION_MODES[0];
      return withField(next, "conditionMode", condition ? mode : undefined);
    }
    case "set-action": {
      const next = withField(content, "action", edit.action);
      const waitId = typeof next.waitId === "string" ? next.waitId : "";
      return withField(next, "waitId", edit.action === "RESUME_WAIT" ? waitId : undefined);
    }
  }
}

/** The undo step for a trigger edit. Typing in one field merges until its blur or Enter. */
export function triggerStepFor(edit: TriggerEdit): Step {
  switch (edit.type) {
    case "set-field":
    case "set-nested": {
      const field = edit.type === "set-field" ? edit.key : `${edit.key}.${edit.field}`;
      const label = `Set ${field}`;
      return edit.live ? { label, merge: { key: `trigger|${field}` } } : { label };
    }
    case "set-kind":
      return { label: `Set kind to ${edit.kind}` };
    case "set-action":
      return { label: `Set action to ${edit.action}` };
  }
}

/**
 * Why `id` can't be the trigger's contract, or null when it can. It may name a contract
 * that doesn't exist, which the form flags, but only a filename-safe id could ever name
 * one. Empty is left for the SDK to flag, as with any required field.
 */
export function contractIdProblem(id: string): string | null {
  return id === "" ? null : idProblem(id);
}

/** A filter's `equals` as the JSON the form shows, or "" when there is none. */
export function equalsText(value: Json | undefined): string {
  return value === undefined ? "" : JSON.stringify(value);
}

/** The JSON value `text` holds, or why it doesn't hold one. */
export function parseEquals(text: string): { ok: true; value: Json } | { ok: false; problem: string } {
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false, problem: 'Enter a JSON value, such as "done", 3 or true.' };
  }
}
