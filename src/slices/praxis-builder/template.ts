// The workflow template form's rules (#224): a new template's record, the edits, the
// argument lists of its three commands, its exposure choice and its stage strip. A template
// is a coding plan without identities, written as the host's bare template file, so it holds
// no id: the file name is its name. The backend checks its shape against the SDK's coding-plan
// schema; these rules only shape what the form shows. Quay never splits a command line and
// never runs or resolves a command.
import type { Step } from "./history.ts";
import { hasOwn, isObject, withField, type Json, type JsonObject } from "./model.ts";

/**
 * A new template's record (#224). Text, commands and output paths start empty and the two
 * durations unset, so they are flagged until filled. Corrections start off, attempts at the
 * authoring minimum of 2 and re-approval on. No exposure is declared and no agent named, which
 * selects the built-in local one. The name is the file name, so `_name` isn't stored.
 */
export function newTemplateContent(_name: string): JsonObject {
  return {
    description: "",
    implementation: [],
    validation: [],
    correction: [],
    outputPaths: [],
    criteriaRef: "",
    maxCorrections: 0,
    reapproveCorrections: true,
    maxAttempts: 2,
  };
}

/** The template's three commands, each an argument list with the executable first. */
export const COMMAND_KEYS = ["implementation", "validation", "correction"] as const;
export type CommandKey = (typeof COMMAND_KEYS)[number];

/** One change to a template draft. `live` marks a field being typed, which merges into the step before it. */
export type TemplateEdit =
  /** Sets a field, or removes it when `value` is undefined. */
  | { type: "set-field"; key: string; value: Json | undefined; live?: boolean }
  /** Sets or removes several fields as one undo step, named by `label`. */
  | { type: "set-fields"; values: Record<string, Json | undefined>; label: string };

/** The record after `edit`, or the same object when it changes nothing. */
export function applyTemplateEdit(content: JsonObject, edit: TemplateEdit): JsonObject {
  if (edit.type === "set-field") return withField(content, edit.key, edit.value);
  return Object.entries(edit.values).reduce((next, [key, value]) => withField(next, key, value), content);
}

/** The undo step for a template edit. Typing in one field merges until its blur or Enter. */
export function templateStepFor(edit: TemplateEdit): Step {
  if (edit.type === "set-fields") return { label: edit.label };
  if (edit.value === undefined) return { label: `Remove ${edit.key}` };
  const label = `Set ${edit.key}`;
  return edit.live ? { label, merge: { key: `template|${edit.key}` } } : { label };
}

/**
 * A count or duration as the template stores it: a JSON number. Digits past the largest safe
 * integer stay text, so the schema flags them instead of Quay rounding them silently.
 */
export function jsonInteger(digits: string): Json {
  const n = Number(digits);
  return /^[0-9]+$/.test(digits) && Number.isSafeInteger(n) ? n : digits;
}

/** A stored count or duration as the digits a field shows. */
export const integerDigits = (value: Json | undefined): string =>
  typeof value === "number" ? String(value) : typeof value === "string" ? value : "";

// --- argument lists ----------------------------------------------------------------------

/** The arguments with row `index` set to `value`; one past the end adds a row. */
export function setArgument(args: readonly string[], index: number, value: string): string[] {
  const next = [...args];
  next[index] = value;
  return next;
}

export function removeArgument(args: readonly string[], index: number): string[] {
  return args.filter((_, i) => i !== index);
}

/** The arguments with row `index` moved one row up (-1) or down (1); the same list when it can't move. */
export function moveArgument(args: readonly string[], index: number, by: -1 | 1): readonly string[] {
  const to = index + by;
  if (to < 0 || to >= args.length) return args;
  const next = [...args];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** A command as the JSON its "Edit as JSON" box shows: pretty, so each argument has a line. */
export function argumentsText(value: Json | undefined): string {
  return JSON.stringify(value ?? [], null, 2);
}

/** The argument list `text` holds, or why it doesn't hold one. A command line is never split. */
export function parseArguments(text: string): { ok: true; args: string[] } | { ok: false; problem: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'This isn\'t JSON. Enter an array of arguments, such as ["/usr/bin/node", "build.js"].' };
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      problem: "Enter an array of arguments, the executable first. Quay doesn't split a command line, since quoting differs between shells.",
    };
  }
  if (!value.every((a) => typeof a === "string")) return { ok: false, problem: "Every argument must be a string." };
  return { ok: true, args: value };
}

// --- exposure ----------------------------------------------------------------------------

/** The exposure radio group's choices, with "other" for a kind Quay doesn't know, as in a hand-edited file. */
export type ExposureChoice = "none" | "BOUNDED" | "NOT_APPLICABLE";

export function exposureChoice(content: JsonObject): ExposureChoice | "other" {
  if (!hasOwn(content, "exposure")) return "none";
  const kind = isObject(content.exposure) ? content.exposure.kind : undefined;
  return kind === "BOUNDED" || kind === "NOT_APPLICABLE" ? kind : "other";
}

/** The values each exposure choice had when the form last switched away from it, kept out of the record. */
export interface HiddenExposure {
  bounded?: { exposure: Json; maxTotalCost: Json | undefined };
  notApplicable?: { exposure: Json };
}

export const EMPTY_HIDDEN: HiddenExposure = {};

/**
 * The fields to write for exposure `choice`, and the hidden values after the switch. The
 * choice switched away from keeps its values in `hidden`, and a choice switched back to gets
 * them again, or empty fields the first time. `maxTotalCost` belongs to Bounded only, as the
 * schema's conditional says, so every other choice removes it.
 */
export function chooseExposure(
  content: JsonObject,
  hidden: HiddenExposure,
  choice: ExposureChoice
): { values: Record<string, Json | undefined>; hidden: HiddenExposure } {
  const current = exposureChoice(content);
  let kept = hidden;
  if (current === "BOUNDED") kept = { ...kept, bounded: { exposure: content.exposure, maxTotalCost: content.maxTotalCost } };
  if (current === "NOT_APPLICABLE") kept = { ...kept, notApplicable: { exposure: content.exposure } };
  switch (choice) {
    case "none":
      return { values: { exposure: undefined, maxTotalCost: undefined }, hidden: kept };
    case "BOUNDED": {
      const back = kept.bounded ?? { exposure: { kind: "BOUNDED", allowance: "", stopThreshold: "" }, maxTotalCost: "" };
      return { values: { exposure: back.exposure, maxTotalCost: back.maxTotalCost }, hidden: kept };
    }
    case "NOT_APPLICABLE": {
      const back = kept.notApplicable ?? { exposure: { kind: "NOT_APPLICABLE", justification: "" } };
      return { values: { exposure: back.exposure, maxTotalCost: undefined }, hidden: kept };
    }
  }
}

/**
 * The stop threshold "Use 80% of allowance" fills in: 80% of `allowance`, rounded down and
 * at least 1, computed with BigInt so an amount of any length stays exact. Null when the
 * allowance isn't a whole number of 1 or more.
 */
export function eightyPercent(allowance: string): string | null {
  if (!/^[1-9][0-9]*$/.test(allowance)) return null;
  const value = (BigInt(allowance) * 4n) / 5n;
  return (value < 1n ? 1n : value).toString();
}

// --- the stage strip ---------------------------------------------------------------------

export type StageKey = "approve" | "implementation" | "validation" | "correction" | "acceptance";

export interface Stage {
  key: StageKey;
  label: string;
  /** A short line under the label, or "" for none. */
  detail: string;
  /** Shown but not run: correction when corrections are 0. */
  muted?: boolean;
  /** Correction loops back to validation. */
  loop?: boolean;
  /** Each correction is approved again before it runs. */
  reapprove?: boolean;
}

/**
 * The fixed coding profile as the read-only strip draws it (#224): Approve → Implementation →
 * Validation → (Correction ↺ Validation) → Acceptance. The correction loop shows only when
 * `maxCorrections` is more than 0, marked when `reapproveCorrections` is true; otherwise the
 * correction stage is muted, since its command is still required.
 */
export function templateStages(content: JsonObject): Stage[] {
  const corrections = typeof content.maxCorrections === "number" && content.maxCorrections > 0 ? content.maxCorrections : 0;
  const loop = corrections > 0;
  return [
    { key: "approve", label: "Approve", detail: "a person approves the plan" },
    { key: "implementation", label: "Implementation", detail: "" },
    { key: "validation", label: "Validation", detail: "" },
    loop
      ? {
          key: "correction",
          label: "Correction",
          detail: `up to ${corrections}, then validation again`,
          loop: true,
          reapprove: content.reapproveCorrections === true,
        }
      : { key: "correction", label: "Correction", detail: "off: no corrections allowed", muted: true },
    { key: "acceptance", label: "Acceptance", detail: "checked against the criteria" },
  ];
}
