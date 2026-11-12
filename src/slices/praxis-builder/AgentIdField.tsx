// The field that names a catalog agent (#482): the agent id of a Runs as entry and a workflow
// template's Agent. It is free text. It suggests the agents of the host's catalog and the ids the
// project already uses, and shows the picker's warnings under the record's own validation issues,
// in a list of their own, so neither is taken for the other.
import { useId, type FC } from "react";
import { agentSuggestions, agentWarnings, NO_CATALOG_NOTE, type AgentPicker } from "./agentPicker.ts";
import { described, FieldMessages, inputClass, labelClass } from "./ConfigForms.tsx";
import { hintClass } from "./RecordFields.tsx";
import type { Diagnostic } from "./types.ts";

export const AgentIdField: FC<{
  label: string;
  value: string;
  hint?: string;
  /** The record's validation issues for this field. */
  issues: readonly Diagnostic[] | undefined;
  /** The host's agent picker, or null when it couldn't be read. */
  picker: AgentPicker | null;
  /** The agent ids the project already uses. */
  used: readonly string[];
  onChange: (value: string) => void;
}> = ({ label, value, hint, issues, picker, used, onChange }) => {
  const id = useId();
  const listId = useId();
  const hintId = useId();
  const messagesId = useId();
  const warningsId = useId();
  const suggestions = agentSuggestions(picker, used);
  const warnings = agentWarnings(picker, value);
  const hints = [hint, picker && !picker.catalog ? NO_CATALOG_NOTE : undefined].filter((h) => h !== undefined).join(" ");
  const also = [hints ? hintId : "", warnings.length > 0 ? warningsId : ""].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        list={suggestions.length > 0 ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} font-mono`}
        {...described(messagesId, issues, also)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s.id} value={s.id} label={s.note} />
          ))}
        </datalist>
      )}
      {hints && (
        <p id={hintId} className={hintClass}>
          {hints}
        </p>
      )}
      <FieldMessages id={messagesId} issues={issues} />
      <FieldMessages id={warningsId} issues={warnings} />
    </div>
  );
};
