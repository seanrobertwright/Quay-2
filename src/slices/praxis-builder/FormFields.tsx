// The fields the contract and trigger forms share (#223): sections, the SDK's verdict, and
// inputs for text, whole numbers, durations, times and flags. Each shows the SDK's issues
// for its field, and the integer, duration and time inputs refuse what can't be stored as
// the user types.
import { useId, useState, type FC, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert, Info, LoaderCircle } from "lucide-react";
import {
  epochMsFromLocalParts,
  formatDateTime,
  formatLocalDateTimeInput,
  formatUtcDateTime,
  localTimeZoneName,
  wallClockPartsOf,
} from "../../lib/dates.ts";
import { described, FieldMessages, inputBaseClass, inputClass, labelClass } from "./ConfigForms.tsx";
import { DURATION_UNITS, durationMs, durationParts, integerProblem, timeMs, type DurationUnit } from "./contract.ts";
import type { Json } from "./model.ts";
import type { ValidationStatus } from "./ProblemsPanel.tsx";
import type { Diagnostic } from "./types.ts";

export const hintClass = "mt-1 text-[11px] text-[#6e7681]";
const sectionHeading = "text-[11px] font-semibold uppercase tracking-wider text-[#8b949e]";

/** The field a diagnostic is about: the first segment of its pointer, or "" for the record. */
const fieldOf = (d: Diagnostic) => d.path.split("/")[1]?.replace(/~1/g, "/").replace(/~0/g, "~") ?? "";

function groupIssues(status: ValidationStatus, keyOf: (d: Diagnostic) => string): Map<string, Diagnostic[]> {
  const out = new Map<string, Diagnostic[]>();
  if (status.state !== "done") return out;
  for (const d of status.validation.diagnostics) {
    const key = keyOf(d);
    out.set(key, [...(out.get(key) ?? []), d]);
  }
  return out;
}

/** The issues by the top-level field they are about, "" for the record as a whole. */
export const issuesByField = (status: ValidationStatus) => groupIssues(status, fieldOf);

/** The issues by their JSON Pointer, for a form that shows fields inside objects. */
export const issuesByPath = (status: ValidationStatus) => groupIssues(status, (d) => d.path);

export const asString = (v: Json | undefined) => (typeof v === "string" ? v : "");
export const asStrings = (v: Json | undefined) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className={sectionHeading}>
        {title}
      </h3>
      {children}
    </section>
  );
};

/** The SDK's verdict on the record, `noun` such as "contract", and the issues about the record as a whole. */
export const RecordSummary: FC<{ noun: string; status: ValidationStatus; recordIssues: readonly Diagnostic[] | undefined }> = ({
  noun,
  status,
  recordIssues,
}) => {
  const id = useId();
  if (status.state === "checking") {
    return (
      <p role="status" className="flex items-center gap-1.5 text-[11px] text-[#8b949e]">
        <LoaderCircle className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Checking…
      </p>
    );
  }
  if (status.state === "failed") {
    return (
      <p role="alert" className="text-[11px] text-[#ff7b72] break-words">
        Couldn&apos;t check this {noun}: {status.error}
      </p>
    );
  }
  const { diagnostics, omitted } = status.validation;
  const errors = diagnostics.filter((d) => d.severity === "error").length + omitted.errors;
  return (
    <div>
      <p role="status" className={`flex items-center gap-1.5 text-[11px] ${errors > 0 ? "text-[#ff7b72]" : "text-[#3fb950]"}`}>
        {errors > 0 ? <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" /> : <Info className="w-3.5 h-3.5" aria-hidden="true" />}
        {errors > 0
          ? `Praxis refuses this ${noun}: ${errors} ${errors === 1 ? "problem" : "problems"}, shown on the fields below. It still saves.`
          : `Praxis accepts this ${noun}.`}
      </p>
      <FieldMessages id={id} issues={recordIssues} />
    </div>
  );
};

export const ReadOnly: FC<{ label: string; value: string; hint?: string; issues?: readonly Diagnostic[] }> = ({ label, value, hint, issues }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} readOnly value={value} className={`${inputBaseClass} w-full font-mono text-[#8b949e]`} {...described(messagesId, issues, hint ? hintId : undefined)} />
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

export const TextInput: FC<{
  label: string;
  value: string;
  hint?: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: string) => void;
}> = ({ label, value, hint, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} font-mono`}
        {...described(messagesId, issues, hint ? hintId : undefined)}
      />
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

/** An inline problem as a diagnostic, so it shows like the SDK's issues. */
export const inline = (message: string | null): Diagnostic[] =>
  message ? [{ code: "INPUT", severity: "error", message, path: "" }] : [];

/**
 * Text that edits a stored value only when it is valid. A change from outside (an undo, a
 * reload) replaces what is typed; Escape puts back the stored value.
 */
export function useSyncedText(applied: string) {
  const [text, setText] = useState(applied);
  const [synced, setSynced] = useState(applied);
  if (synced !== applied) {
    setSynced(applied);
    setText(applied);
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && text !== applied) {
      // Handled here, so the builder doesn't close.
      e.preventDefault();
      setText(applied);
    }
  };
  return { text, setText, onKeyDown };
}

/** A count or amount: a whole number stored as the SDK's decimal string, refused inline when it isn't one. */
export const IntegerInput: FC<{
  label: string;
  labelNote?: string;
  value: Json | undefined;
  min?: bigint;
  hint: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: string) => void;
}> = ({ label, labelNote, value, min = 0n, hint, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const applied = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const { text, setText, onKeyDown } = useSyncedText(applied);
  const problem = text === applied ? null : integerProblem(text, min);
  // While the text is refused, the stored value's issues would be about something else.
  const shown = problem ? inline(problem) : issues;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        {labelNote && <span className="font-normal"> {labelNote}</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        spellCheck={false}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (integerProblem(next, min) === null) onChange(next.trim());
        }}
        className={`${inputBaseClass} w-48 text-[#c9d1d9] font-mono`}
        {...described(messagesId, shown, hintId)}
      />
      <p id={hintId} className={hintClass}>
        {hint}
      </p>
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

/** A duration: an amount and a unit, stored as milliseconds. */
export const DurationInput: FC<{
  label: string;
  value: Json | undefined;
  hint: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (ms: string) => void;
}> = ({ label, value, hint, issues, onChange }) => {
  const id = useId();
  const unitId = useId();
  const messagesId = useId();
  const hintId = useId();
  const storedMs = typeof value === "string" ? value : "";
  const stored = durationParts(storedMs);
  const [text, setText] = useState(stored?.amount ?? "");
  const [unit, setUnit] = useState<DurationUnit>(stored?.unit ?? "min");
  const result = durationMs(text, unit);
  // A change from outside (an undo, a reload) replaces what is typed. The value the typing
  // stored doesn't: 60 minutes stays 60 minutes rather than turning into 1 hour mid-word.
  const [synced, setSynced] = useState(storedMs);
  if (synced !== storedMs) {
    setSynced(storedMs);
    if (!(result.ok && result.ms === storedMs)) {
      setText(stored?.amount ?? "");
      setUnit(stored?.unit ?? "min");
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && !(result.ok && result.ms === storedMs)) {
      // Handled here, so the builder doesn't close.
      e.preventDefault();
      setText(stored?.amount ?? "");
      setUnit(stored?.unit ?? "min");
    }
  };
  // Text as stored is the stored value's to judge, so only the SDK's issues show for it.
  const problem = text === (stored?.amount ?? "") || result.ok ? null : result.problem;
  const shown = problem ? inline(problem) : issues;
  const apply = (amount: string, u: DurationUnit) => {
    const r = durationMs(amount, u);
    if (r.ok) onChange(r.ms);
  };
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          spellCheck={false}
          value={text}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setText(e.target.value);
            apply(e.target.value, unit);
          }}
          className={`${inputBaseClass} w-32 text-[#c9d1d9] font-mono`}
          {...described(messagesId, shown, hintId)}
        />
        <label htmlFor={unitId} className="sr-only">
          {label} unit
        </label>
        <select
          id={unitId}
          value={unit}
          onChange={(e) => {
            const u = e.target.value as DurationUnit;
            setUnit(u);
            apply(text, u);
          }}
          className={`${inputBaseClass} w-36 text-[#c9d1d9]`}
        >
          {DURATION_UNITS.map((u) => (
            <option key={u.unit} value={u.unit}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <p id={hintId} className={hintClass}>
        {hint}
        {stored && ` Stored as ${typeof value === "string" ? value : ""} ms.`}
      </p>
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

/**
 * An absolute time, picked in this machine's zone, which the field names along with the
 * UTC equivalent. The picker's digits become epoch milliseconds through the date helper,
 * so no string is parsed.
 */
export const DateTimeInput: FC<{
  label: string;
  value: Json | undefined;
  issues: readonly Diagnostic[] | undefined;
  onChange: (ms: string) => void;
}> = ({ label, value, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const ms = timeMs(value);
  const zone = localTimeZoneName();
  const shown = problem ? inline(problem) : issues;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label} <span className="font-normal">({zone})</span>
      </label>
      <input
        id={id}
        type="datetime-local"
        value={ms === null ? "" : formatLocalDateTimeInput(ms)}
        onChange={(e) => {
          const input = e.currentTarget;
          if (input.value === "") {
            setProblem(null);
            onChange("");
            return;
          }
          // The picker counts its digits as if they were UTC; only the digits are used.
          const parts = wallClockPartsOf(input.valueAsNumber);
          const picked = Number.isFinite(input.valueAsNumber) ? epochMsFromLocalParts(parts) : null;
          if (picked === null) return setProblem(`That time doesn't exist in ${zone}, as when the clocks change.`);
          if (picked < 0) return setProblem("Pick a time after 1 January 1970 UTC.");
          setProblem(null);
          onChange(String(picked));
        }}
        className={`${inputBaseClass} w-64 text-[#c9d1d9]`}
        {...described(messagesId, shown, hintId)}
      />
      <p id={hintId} className={hintClass}>
        {ms === null ? "Not set." : `${formatDateTime(ms)} in ${zone}, which is ${formatUtcDateTime(ms)}.`}
      </p>
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

export const Checkbox: FC<{
  label: string;
  checked: boolean;
  hint: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, hint, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  return (
    <div>
      <div className="flex items-center gap-2">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...described(messagesId, issues, hintId)} />
        <label htmlFor={id} className="text-xs text-[#c9d1d9]">
          {label}
        </label>
      </div>
      <p id={hintId} className={hintClass}>
        {hint}
      </p>
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};
