// The host's authoring preview of a workflow template draft (#596), read with
// `praxis preview FILE --template --json` when Check on host is pressed, and never by itself. It
// says whether a run can be created from the draft as the form holds it, saved or not, and gives
// the host's diagnostics. The form shows them apart from the offline shape check's issues: they
// never reach the verdict that allows a save, and never block a save, an install or a run.
//
// The record's format, `aiws-authoring-preview/1`, is PROVISIONAL in AI-WS-SDK. A record in
// another format, or one whose fields aren't the ones read here, is no preview, and the form
// says in one line that the host couldn't check the draft.
import { invoke } from "@tauri-apps/api/core";
import { isObject, type Json } from "./model.ts";
import { outcomeMessage, praxisCall, type CallOutcome, type Invoker } from "./praxisHost.ts";
import type { Diagnostic, Severity } from "./types.ts";

/** The record format `praxis preview --json` prints. */
export const AUTHORING_PREVIEW_FORMAT = "aiws-authoring-preview/1";

/** The most host diagnostics the form shows. A template has far fewer fields than this. */
export const MAX_HOST_DIAGNOSTICS = 200;

/** One thing the host said of the draft. */
export interface HostDiagnostic {
  /** The draft's field it is about, as the host names it, such as `maxAttempts`. */
  field: string;
  /** The host's code. The set is open. */
  code: string;
  severity: "ERROR" | "WARNING";
  /** The host's own words. */
  message: string;
}

/** What a host said of a workflow template draft. */
export interface TemplatePreview {
  /** Whether a run can be created from the draft. */
  creatable: boolean;
  /** The host's diagnostics, in its order, at most `MAX_HOST_DIAGNOSTICS`. */
  diagnostics: readonly HostDiagnostic[];
  /** How many more diagnostics the host gave than are kept. */
  omitted: number;
}

function hostDiagnostic(value: unknown): HostDiagnostic | null {
  if (!isObject(value)) return null;
  const { field, code, severity, message } = value;
  if (typeof field !== "string" || typeof code !== "string" || typeof message !== "string") return null;
  if (severity !== "ERROR" && severity !== "WARNING") return null;
  return { field, code, severity, message };
}

/** The preview in a `praxis_host_template_preview` outcome, or null when it holds none Quay can read. */
export function templatePreviewOf(outcome: CallOutcome): TemplatePreview | null {
  if (outcome.kind !== "record") return null;
  const { format, form, creatable, diagnostics } = outcome.record;
  if (format !== AUTHORING_PREVIEW_FORMAT || form !== "TEMPLATE" || typeof creatable !== "boolean" || !Array.isArray(diagnostics)) return null;
  const read: HostDiagnostic[] = [];
  for (const diagnostic of diagnostics.slice(0, MAX_HOST_DIAGNOSTICS)) {
    const one = hostDiagnostic(diagnostic);
    if (!one) return null;
    read.push(one);
  }
  return { creatable, diagnostics: read, omitted: diagnostics.length - read.length };
}

/** What the form says when the installed `praxis` has no `preview` command. */
export const PRAXIS_TOO_OLD = "The host couldn't check this draft: the installed praxis is too old for this check. Update praxis, then check again.";

/** The one line the form shows when the preview couldn't be read, for `outcome`, which holds none. */
export function previewFailure(outcome: CallOutcome): string {
  if (outcome.kind === "commandUnknown") return PRAXIS_TOO_OLD;
  if (outcome.kind === "cancelled") return "The host couldn't check this draft: the check was stopped.";
  return `The host couldn't check this draft: ${outcomeMessage(outcome)}`;
}

/** What Check on host last came to. */
export type PreviewResult =
  /** The host answered. `checked` is the draft it was asked about, as text, to tell when the draft has changed since. */
  | { state: "answered"; preview: TemplatePreview; checked: string }
  | { state: "failed"; message: string };

/** The text a draft is compared by, to tell whether a result is still about it. */
export const draftText = (content: Json): string => JSON.stringify(content);

/** What the checks of one template form hold. */
export interface PreviewChecksState {
  /** The last check's result, or null before the first. It stays while the next check runs. */
  result: PreviewResult | null;
  checking: boolean;
}

/** The checks of the template one form shows. */
export interface PreviewChecks {
  /** Asks `projectPath`'s host about `content`. A check already running is cancelled and its answer dropped. */
  check(projectPath: string, content: Json): void;
  /** Cancels the check in flight and drops its answer, as when the form leaves the screen. */
  drop(): void;
  current(): PreviewChecksState;
  /** Calls `listener` whenever `current` changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * Checks through `call`. Only the newest check's answer is kept: starting a check, or dropping
 * them, cancels the one in flight and drops its answer.
 */
export function createPreviewChecks(call: Invoker = invoke): PreviewChecks {
  let state: PreviewChecksState = { result: null, checking: false };
  let inFlight: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PreviewChecksState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    inFlight?.abort();
    inFlight = null;
  };
  return {
    check(projectPath, content) {
      cancel();
      const own = new AbortController();
      inFlight = own;
      const checked = draftText(content);
      set({ result: state.result, checking: true });
      void praxisCall("praxis_host_template_preview", { projectPath, draft: content }, own.signal, call).then((outcome) => {
        if (inFlight !== own) return;
        inFlight = null;
        const preview = templatePreviewOf(outcome);
        const failed = outcome.kind === "record" ? "The host couldn't check this draft: praxis gave an answer Quay can't read." : previewFailure(outcome);
        set({ result: preview ? { state: "answered", preview, checked } : { state: "failed", message: failed }, checking: false });
      });
    },
    drop() {
      if (!inFlight) return;
      cancel();
      set({ result: state.result, checking: false });
    },
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** What a host diagnostic on a field says after the host's own words, so it isn't taken for the offline check's. */
export const HOST_SAYS = "The host says so.";
/** The same, for a result from before the draft's last edit. */
export const HOST_SAID_BEFORE = "The host said so before the draft changed.";

const SEVERITY: Record<HostDiagnostic["severity"], Severity> = { ERROR: "error", WARNING: "warning" };

/**
 * The JSON Pointer of the draft field the host names: `maxAttempts` is `/maxAttempts`, and a
 * nested name, `exposure.allowance` or `outputPaths[2]`, is `/exposure/allowance` or `/outputPaths/2`.
 */
export function fieldPointer(field: string): string {
  const parts = field.split(/[.[\]]/).filter((part) => part !== "");
  return parts.map((part) => `/${part.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

/**
 * The host's diagnostics as the form's fields show issues, by the JSON Pointer of the field each
 * is about. Each keeps the host's message verbatim and its code, and says it is the host's.
 * `stale` says the draft has changed since the host was asked.
 */
export function hostIssuesByPath(preview: TemplatePreview, stale: boolean): Map<string, Diagnostic[]> {
  const byPath = new Map<string, Diagnostic[]>();
  for (const d of preview.diagnostics) {
    const path = fieldPointer(d.field);
    const issue: Diagnostic = { code: d.code, severity: SEVERITY[d.severity], message: d.message, path, hint: stale ? HOST_SAID_BEFORE : HOST_SAYS };
    byPath.set(path, [...(byPath.get(path) ?? []), issue]);
  }
  return byPath;
}

/** The verdict line of an answered check. */
export function verdictLine(preview: TemplatePreview): string {
  const errors = preview.diagnostics.filter((d) => d.severity === "ERROR").length;
  if (preview.creatable) return "The host can create a run from this draft.";
  if (errors === 0) return "The host can't create a run from this draft.";
  return `The host can't create a run from this draft: ${errors} ${errors === 1 ? "problem" : "problems"}.`;
}
