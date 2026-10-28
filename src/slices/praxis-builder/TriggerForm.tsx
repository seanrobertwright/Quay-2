// The trigger form (#223): a trigger opens full width in the work area and shows only the
// fields that apply to its kind and action. `schedule` is for SCHEDULED, `conditionMode` for
// CONDITION and `waitId` for RESUME_WAIT; `filter` is required for CONDITION and optional for
// the rest. Changing the kind or action adds and removes those fields as one undo step. Quay
// links a trigger only to its contract: Praxis doesn't say which graph a triggered run
// attaches, and a wait id is known only at run time.
import { useEffect, useId, type FC, type ReactNode } from "react";
import { Info, Plus, X } from "lucide-react";
import { described, FieldMessages, inputBaseClass, inputClass, labelClass } from "./ConfigForms.tsx";
import type { Draft } from "./drafts.ts";
import {
  asString,
  Checkbox,
  DateTimeInput,
  DurationInput,
  hintClass,
  inline,
  IntegerInput,
  issuesByPath,
  ReadOnly,
  Section,
  Summary,
  TextInput,
  useSyncedText,
} from "./RecordFields.tsx";
import { isObject, type Json, type JsonObject } from "./model.ts";
import {
  CATCH_UP_MODES,
  CONDITION_MODES,
  contractIdProblem,
  equalsText,
  isTriggerAction,
  isTriggerKind,
  newFilter,
  parseEquals,
  TRIGGER_ACTIONS,
  TRIGGER_KINDS,
  type NestedKey,
  type TriggerEdit,
} from "./trigger.ts";
import { useValidation } from "./useValidation.ts";
import type { DefinitionRef, Diagnostic } from "./types.ts";

interface TriggerFormProps {
  draft: Draft;
  /** The ids of the contracts in the project, listed or drafted, for the contract picker. */
  contracts: readonly string[];
  /** The record's cross-record checks (#269), shown under the verdict. */
  crossRecord: ReactNode;
  onEdit: (edit: TriggerEdit) => void;
  onOpen: (ref: DefinitionRef) => void;
  onValidated: (verdict: string | null) => void;
}

const START_RUN_NOTE =
  "Praxis doesn't yet say which graph a triggered run attaches, so Quay doesn't link this trigger to a graph.";

const CATCH_UP_HINTS: Record<(typeof CATCH_UP_MODES)[number], string> = {
  SKIP: "skip the slots it missed",
  LATEST: "fire once for the latest slot it missed",
  ALL: "fire for each slot it missed, up to the most to catch up",
};

export const TriggerForm: FC<TriggerFormProps> = ({ draft, contracts, crossRecord, onEdit, onOpen, onValidated }) => {
  const status = useValidation("triggers", draft.content);
  const verdict = status.state === "done" ? status.validation.verdict : undefined;
  useEffect(() => {
    if (verdict !== undefined) onValidated(verdict);
  }, [verdict, onValidated]);

  // Each field takes the issues at its path. Whatever no shown field takes, such as a field
  // that doesn't apply to the kind, shows with the verdict.
  const byPath = issuesByPath(status);
  const taken = new Set<string>();
  const at = (path: string) => {
    taken.add(path);
    return byPath.get(path);
  };

  const t = draft.content;
  const kind = asString(t.kind);
  const action = asString(t.action);
  const schedule = isObject(t.schedule) ? t.schedule : null;
  const filter = isObject(t.filter) ? t.filter : null;
  const set = (key: string, value: Json | undefined, live = false) => onEdit({ type: "set-field", key, value, live });
  const setIn = (key: NestedKey, field: string, value: Json, live = false) => onEdit({ type: "set-nested", key, field, value, live });

  const fields = (
    <>
      <Section title="Trigger">
        <ReadOnly label="Id" value={draft.ref.id} issues={at("/id")} hint="Rename the trigger from the list." />
        <ReadOnly label="Revision" value={asString(t.revision)} issues={at("/revision")} hint="Set from the content each time the trigger is saved." />
        <ContractPicker value={asString(t.contractId)} contracts={contracts} issues={at("/contractId")} onChange={(v) => set("contractId", v, true)} onOpen={onOpen} />
        <Checkbox
          label="Enabled"
          checked={t.enabled === true}
          issues={at("/enabled")}
          onChange={(v) => set("enabled", v)}
          hint="A disabled trigger never fires. A new trigger starts disabled."
        />
      </Section>

      <Section title="What fires it">
        <Select
          label="Kind"
          value={kind}
          options={TRIGGER_KINDS}
          issues={at("/kind")}
          // A kind outside the list, as in a hand-edited file, is shown but can't be picked back.
          onChange={(v) => isTriggerKind(v) && onEdit({ type: "set-kind", kind: v })}
          hint="Changing the kind adds or removes the fields that only some kinds have."
        />
        <TextInput label="Source" value={asString(t.source)} issues={at("/source")} onChange={(v) => set("source", v, true)} hint="Where the events that fire it come from." />
        <TextInput label="Event type" value={asString(t.eventType)} issues={at("/eventType")} onChange={(v) => set("eventType", v, true)} hint="The type of event that fires it." />
        {kind === "SCHEDULED" && (
          <Group title="Schedule" issues={at("/schedule")}>
            {schedule && (
              <>
                <DateTimeInput label="First slot" value={schedule.startMs} issues={at("/schedule/startMs")} onChange={(v) => setIn("schedule", "startMs", v)} />
                <DurationInput
                  label="Interval"
                  value={schedule.intervalMs}
                  issues={at("/schedule/intervalMs")}
                  onChange={(v) => setIn("schedule", "intervalMs", v, true)}
                  hint="The time between slots. At least 1 ms."
                />
                <Select
                  label="Catch-up"
                  value={asString(schedule.catchUp)}
                  options={CATCH_UP_MODES}
                  issues={at("/schedule/catchUp")}
                  onChange={(v) => setIn("schedule", "catchUp", v)}
                  hint={`After slots are missed: ${CATCH_UP_MODES.map((m) => `${m} to ${CATCH_UP_HINTS[m]}`).join("; ")}.`}
                />
                <IntegerInput
                  label="Most to catch up"
                  value={schedule.maxCatchUp}
                  min={1n}
                  issues={at("/schedule/maxCatchUp")}
                  onChange={(v) => setIn("schedule", "maxCatchUp", v, true)}
                  hint="How many missed slots it fires for at once. From 1 to 1000."
                />
              </>
            )}
          </Group>
        )}
        {kind === "CONDITION" && (
          <Select
            label="Condition mode"
            value={asString(t.conditionMode)}
            options={CONDITION_MODES}
            issues={at("/conditionMode")}
            onChange={(v) => set("conditionMode", v)}
            hint="EDGE fires when the filter starts to match; LEVEL fires on every event while it matches."
          />
        )}
        <FilterGroup
          filter={filter}
          required={kind === "CONDITION"}
          issues={at("/filter")}
          fieldIssues={at("/filter/field")}
          equalsIssues={at("/filter/equals")}
          onSet={(value) => set("filter", value)}
          onSetIn={(field, value, live) => setIn("filter", field, value, live)}
        />
      </Section>

      <Section title="What it does">
        <Select
          label="Action"
          value={action}
          options={TRIGGER_ACTIONS}
          issues={at("/action")}
          onChange={(v) => isTriggerAction(v) && onEdit({ type: "set-action", action: v })}
        />
        {action === "START_RUN" && (
          <p role="note" className="flex items-start gap-1.5 text-[11px] text-[#79c0ff]">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            <span>{START_RUN_NOTE}</span>
          </p>
        )}
        {action === "RESUME_WAIT" && (
          <TextInput
            label="Wait id"
            value={asString(t.waitId)}
            issues={at("/waitId")}
            onChange={(v) => set("waitId", v, true)}
            hint="A run-time wait id: Praxis makes one when a run waits, so it isn't linked to a graph node here."
          />
        )}
      </Section>

      <Section title="Timing">
        <DateTimeInput label="Not before" value={t.notBefore} issues={at("/notBefore")} onChange={(v) => set("notBefore", v)} />
        <DateTimeInput label="Expires at" value={t.expiresAt} issues={at("/expiresAt")} onChange={(v) => set("expiresAt", v)} />
        <DurationInput
          label="Max event age"
          value={t.maxAgeMs}
          issues={at("/maxAgeMs")}
          onChange={(v) => set("maxAgeMs", v, true)}
          hint="How old an event may be and still fire the trigger."
        />
      </Section>

      <Section title="Limits">
        <IntegerInput
          label="Max concurrent runs"
          value={t.maxConcurrent}
          min={1n}
          issues={at("/maxConcurrent")}
          onChange={(v) => set("maxConcurrent", v, true)}
          hint="How many of its runs may be active at once. At least 1."
        />
        <IntegerInput
          label="Rate limit"
          value={t.rateLimit}
          min={1n}
          issues={at("/rateLimit")}
          onChange={(v) => set("rateLimit", v, true)}
          hint="How many times it may fire in each rate window. At least 1."
        />
        <DurationInput
          label="Rate window"
          value={t.rateWindowMs}
          issues={at("/rateWindowMs")}
          onChange={(v) => set("rateWindowMs", v, true)}
          hint="The window the rate limit counts over. At least 1 ms."
        />
        <IntegerInput
          label="Max depth"
          value={t.maxDepth}
          issues={at("/maxDepth")}
          onChange={(v) => set("maxDepth", v, true)}
          hint="How long a chain of triggered runs may lead to the event. 0 accepts only events no run caused."
        />
      </Section>
    </>
  );
  const untaken = [...byPath].filter(([path]) => !taken.has(path)).flatMap(([, issues]) => issues);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <form className="max-w-3xl mx-auto px-6 py-5 space-y-6" onSubmit={(e) => e.preventDefault()} aria-label={`Trigger ${draft.ref.id}`}>
        <Summary noun="trigger" status={status} recordIssues={untaken} />
        {crossRecord}
        {fields}
      </form>
    </div>
  );
};

/** A choice of one value from a fixed list. A value outside it, as in a hand-edited file, shows as it is. */
const Select: FC<{
  label: string;
  value: string;
  options: readonly string[];
  hint?: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: string) => void;
}> = ({ label, value, options, hint, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const shown = options.includes(value) ? options : [value, ...options];
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputBaseClass} w-56 text-[#c9d1d9] font-mono`}
        {...described(messagesId, issues, hint ? hintId : undefined)}
      >
        {shown.map((o) => (
          <option key={o} value={o}>
            {o === "" ? "(not set)" : o}
          </option>
        ))}
      </select>
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

/** A titled group of fields inside a section, with the issues about the group as a whole. */
const Group: FC<{ title: string; issues: readonly Diagnostic[] | undefined; action?: ReactNode; children?: ReactNode }> = ({
  title,
  issues,
  action,
  children,
}) => {
  const messagesId = useId();
  return (
    <fieldset aria-describedby={issues?.length ? messagesId : undefined} className="space-y-3 border-l-2 border-[#30363d] pl-3">
      <legend className={`${labelClass} flex items-center gap-2`}>
        {title}
        {action}
      </legend>
      <FieldMessages id={messagesId} issues={issues} />
      {children}
    </fieldset>
  );
};

/**
 * The trigger's contract (#223): a picker over the project's contracts that also takes an
 * id for one not made yet, which is flagged until it exists.
 */
const ContractPicker: FC<{
  value: string;
  contracts: readonly string[];
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: string) => void;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ value, contracts, issues, onChange, onOpen }) => {
  const id = useId();
  const optionsId = useId();
  const messagesId = useId();
  const hintId = useId();
  const { text, setText, onKeyDown } = useSyncedText(value);
  const problem = contractIdProblem(text.trim());
  const exists = contracts.includes(value);
  const missing: Diagnostic[] =
    value !== "" && !exists && !problem ? [{ code: "MISSING_CONTRACT", severity: "info", message: "No contract has this id.", path: "/contractId" }] : [];
  const shown = problem ? inline(problem) : [...(issues ?? []), ...missing];
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Contract
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          list={optionsId}
          spellCheck={false}
          value={text}
          placeholder="contract id"
          onKeyDown={onKeyDown}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            if (contractIdProblem(next.trim()) === null) onChange(next.trim());
          }}
          className={`${inputClass} font-mono`}
          {...described(messagesId, shown, hintId)}
        />
        <datalist id={optionsId}>
          {contracts.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {exists && (
          <button
            type="button"
            onClick={() => onOpen({ kind: "contracts", id: value })}
            className="shrink-0 text-xs text-[#58a6ff] hover:underline"
            title={`Open contract ${value}`}
          >
            Open
          </button>
        )}
      </div>
      <p id={hintId} className={hintClass}>
        Pick an existing contract, or type an id for one not made yet. The contract must have the triggers feature.
      </p>
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

/** The filter: a field and the JSON value it must equal. Required for CONDITION, optional for the other kinds. */
const FilterGroup: FC<{
  filter: JsonObject | null;
  required: boolean;
  issues: readonly Diagnostic[] | undefined;
  fieldIssues: readonly Diagnostic[] | undefined;
  equalsIssues: readonly Diagnostic[] | undefined;
  onSet: (value: JsonObject | undefined) => void;
  onSetIn: (field: string, value: Json, live: boolean) => void;
}> = ({ filter, required, issues, fieldIssues, equalsIssues, onSet, onSetIn }) => {
  const buttonClass =
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[11px] font-normal normal-case text-[#c9d1d9]";
  const action = required ? null : filter ? (
    <button type="button" onClick={() => onSet(undefined)} className={buttonClass}>
      <X className="w-3 h-3" aria-hidden="true" />
      Remove the filter
    </button>
  ) : (
    <button type="button" onClick={() => onSet(newFilter())} className={buttonClass}>
      <Plus className="w-3 h-3" aria-hidden="true" />
      Add a filter
    </button>
  );
  return (
    <Group title={required ? "Filter" : "Filter (optional)"} issues={issues} action={action}>
      {filter ? (
        <>
          <TextInput
            label="Field"
            value={asString(filter.field)}
            issues={fieldIssues}
            onChange={(v) => onSetIn("field", v, true)}
            hint="The event data field to compare."
          />
          <EqualsInput value={filter.equals} issues={equalsIssues} onChange={(v) => onSetIn("equals", v, true)} />
        </>
      ) : (
        !required && <p className="text-xs text-[#6e7681]">Every event of this source and type fires it.</p>
      )}
    </Group>
  );
};

/** The value a filter's field must equal, typed as JSON and stored only when it parses. */
const EqualsInput: FC<{ value: Json | undefined; issues: readonly Diagnostic[] | undefined; onChange: (value: Json) => void }> = ({
  value,
  issues,
  onChange,
}) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const applied = equalsText(value);
  const { text, setText, onKeyDown } = useSyncedText(applied);
  const parsed = parseEquals(text);
  const problem = text === applied || parsed.ok ? null : parsed.problem;
  const shown = problem ? inline(problem) : issues;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Equals
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const result = parseEquals(next);
          if (result.ok) onChange(result.value);
        }}
        className={`${inputClass} font-mono`}
        {...described(messagesId, shown, hintId)}
      />
      <p id={hintId} className={hintClass}>
        A JSON value, such as &quot;done&quot;, 3 or true. Text needs its quotes.
      </p>
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};
