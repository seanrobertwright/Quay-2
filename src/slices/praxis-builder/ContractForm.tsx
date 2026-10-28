// The contract form (#223): a contract opens full width in the work area, in sections for
// scope, limits, timing and delivery, with its binding record's graphs and grants and the
// triggers that name it. Every change is a step in the draft's undo history, and saving
// writes the contract and its bindings file together. The SDK's issues show on the field
// they are about; the integer, duration and time inputs refuse what can't be stored as the
// user types (#231 settles how `budget` reads).
import { useEffect, useId, useState, type FC } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { described, FieldMessages, inputClass, labelClass } from "./ConfigForms.tsx";
import {
  bindingIdProblem,
  CONTRACT_FEATURES,
  type BindingList,
  type Bindings,
  type ContractEdit,
} from "./contract.ts";
import type { Draft } from "./drafts.ts";
import type { Json } from "./model.ts";
import {
  asString,
  asStrings,
  Checkbox,
  COST_HINT,
  COST_UNIT_LABEL,
  DateTimeInput,
  DurationInput,
  hintClass,
  inline,
  IntegerInput,
  issuesByField,
  ReadOnly,
  Section,
  StringList,
  Summary,
  TextInput,
} from "./RecordFields.tsx";
import { useValidation } from "./useValidation.ts";
import type { ContractTriggers, DefinitionRef, Diagnostic, FileProblem } from "./types.ts";

/** The triggers that name the contract, as the form last read them. */
export type TriggersStatus = { state: "loading" } | { state: "failed"; error: string } | { state: "done"; found: ContractTriggers };

interface ContractFormProps {
  draft: Draft;
  /** Why the bindings file was ignored, when it couldn't be read. */
  bindingsProblem: FileProblem | undefined;
  /** The ids of the graphs and grants in the project, listed or drafted, for the pickers. */
  known: Bindings;
  triggers: TriggersStatus;
  onEdit: (edit: ContractEdit) => void;
  onOpen: (ref: DefinitionRef) => void;
  onValidated: (verdict: string | null) => void;
}


export const ContractForm: FC<ContractFormProps> = ({ draft, bindingsProblem, known, triggers, onEdit, onOpen, onValidated }) => {
  const status = useValidation("contracts", draft.content);
  const verdict = status.state === "done" ? status.validation.verdict : undefined;
  useEffect(() => {
    if (verdict !== undefined) onValidated(verdict);
  }, [verdict, onValidated]);
  const issues = issuesByField(status);
  const c = draft.content;
  const bindings = draft.bindings ?? { graphs: [], grants: [] };
  const set = (key: string, value: Json, live = false) => onEdit({ type: "set-field", key, value, live });
  const features = asStrings(c.features);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <form className="max-w-3xl mx-auto px-6 py-5 space-y-6" onSubmit={(e) => e.preventDefault()} aria-label={`Contract ${draft.ref.id}`}>
        <Summary noun="contract" status={status} recordIssues={issues.get("")} />
        {bindingsProblem && (
          <p role="status" className="flex items-start gap-1.5 text-[11px] text-[#e3b341]">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            <span className="break-words">
              .praxis/bindings/{draft.ref.id}.json was ignored, so no graphs or grants are listed. Saving replaces it:{" "}
              {bindingsProblem.message}
            </span>
          </p>
        )}

        <Section title="Contract">
          <ReadOnly label="Id" value={draft.ref.id} hint="Rename the contract from the list." />
          <TextInput
            label="Mission id"
            value={asString(c.missionId)}
            issues={issues.get("missionId")}
            onChange={(v) => set("missionId", v, true)}
            hint="The mission Praxis opens under this contract. A new contract uses its id."
          />
          <div className="grid grid-cols-2 gap-4">
            <ReadOnly label="AIWS edition" value={asString(c.aiwsEdition)} issues={issues.get("aiwsEdition")} />
            <ReadOnly label="Profile" value={asString(c.profile)} issues={issues.get("profile")} />
          </div>
        </Section>

        <Section title="Scope">
          <StringList label="Actions" addLabel="Add an action" items={asStrings(c.actions)} issues={issues.get("actions")} onChange={(v) => set("actions", v)} />
          <StringList label="Resources" addLabel="Add a resource" items={asStrings(c.resources)} issues={issues.get("resources")} onChange={(v) => set("resources", v)} />
          <Features value={features} issues={issues.get("features")} onChange={(v) => set("features", v)} />
        </Section>

        <Section title="Limits">
          <IntegerInput
            label="Budget"
            labelNote={COST_UNIT_LABEL}
            value={c.budget}
            issues={issues.get("budget")}
            onChange={(v) => set("budget", v, true)}
            hint={COST_HINT}
          />
          <IntegerInput
            label="Max attempts"
            value={c.maxAttempts}
            min={1n}
            issues={issues.get("maxAttempts")}
            onChange={(v) => set("maxAttempts", v, true)}
            hint="How many times a run may try. At least 1."
          />
          <DurationInput
            label="Max authorization age"
            value={c.maxAuthorizationAgeMs}
            issues={issues.get("maxAuthorizationAgeMs")}
            onChange={(v) => set("maxAuthorizationAgeMs", v, true)}
            hint="How old an approval may be when a step uses it."
          />
        </Section>

        <Section title="Timing">
          <DateTimeInput label="Deadline" value={c.deadline} issues={issues.get("deadline")} onChange={(v) => set("deadline", v)} />
        </Section>

        <Section title="Delivery">
          <StringList
            label="Acceptance criteria"
            addLabel="Add a criterion"
            items={asStrings(c.criteria)}
            issues={issues.get("criteria")}
            onChange={(v) => set("criteria", v)}
          />
          <Checkbox
            label="Requires approval"
            checked={c.requiresApproval === true}
            issues={issues.get("requiresApproval")}
            onChange={(v) => set("requiresApproval", v)}
            hint="A human approves the work in Praxis before it is accepted."
          />
        </Section>

        <BindingSection list="graphs" title="Graphs" kindName="graph" bound={bindings.graphs} known={known.graphs} onEdit={onEdit} onOpen={onOpen} />
        <BindingSection list="grants" title="Grants" kindName="grant" bound={bindings.grants} known={known.grants} onEdit={onEdit} onOpen={onOpen} />
        <TriggerSection triggers={triggers} onOpen={onOpen} />
      </form>
    </div>
  );
};


const Features: FC<{ value: readonly string[]; issues: readonly Diagnostic[] | undefined; onChange: (value: string[]) => void }> = ({
  value,
  issues,
  onChange,
}) => {
  const messagesId = useId();
  return (
    <fieldset aria-describedby={issues?.length ? messagesId : undefined}>
      <legend className={labelClass}>Features</legend>
      <div className="flex gap-4">
        {CONTRACT_FEATURES.map((f) => (
          <label key={f} className="flex items-center gap-1.5 text-xs font-mono text-[#c9d1d9]">
            <input
              type="checkbox"
              checked={value.includes(f)}
              onChange={(e) => onChange(e.target.checked ? [...value, f] : value.filter((x) => x !== f))}
            />
            {f}
          </label>
        ))}
      </div>
      <p className={hintClass}>A graph runs only under a contract with the graphs feature.</p>
      <FieldMessages id={messagesId} issues={issues} />
    </fieldset>
  );
};

/** A binding list (#223): the graphs or grants run under the contract, added from a picker over existing ids. */
const BindingSection: FC<{
  list: BindingList;
  title: string;
  kindName: string;
  bound: readonly string[];
  known: readonly string[];
  onEdit: (edit: ContractEdit) => void;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ list, title, kindName, bound, known, onEdit, onOpen }) => {
  const id = useId();
  const optionsId = useId();
  const messagesId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const value = text.trim();
  const problem = value === "" ? null : bindingIdProblem(value, bound);
  const knownSet = new Set(known);
  const unbound = known.filter((k) => !bound.includes(k));
  const add = () => {
    if (value === "" || problem) return;
    onEdit({ type: "add-binding", list, id: value });
    setText("");
  };
  return (
    <Section title={title}>
      {bound.length === 0 ? (
        <p className="text-xs text-[#6e7681]">No {kindName}s are bound to this contract.</p>
      ) : (
        <ul className="space-y-1">
          {bound.map((boundId) => {
            const exists = knownSet.has(boundId);
            return (
              <li key={boundId} className="flex items-center gap-1.5 text-xs">
                {exists ? (
                  <button
                    type="button"
                    onClick={() => onOpen({ kind: list, id: boundId })}
                    className="font-mono text-[#58a6ff] hover:underline"
                    title={`Open ${kindName} ${boundId}`}
                  >
                    {boundId}
                  </button>
                ) : (
                  <span className="font-mono text-[#c9d1d9]">{boundId}</span>
                )}
                {!exists && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#e3b341]">
                    <TriangleAlert className="w-3 h-3" aria-hidden="true" />
                    No {kindName} has this id.
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Unbind ${kindName} ${boundId}`}
                  onClick={() => onEdit({ type: "remove-binding", list, id: boundId })}
                  className="p-0.5 text-[#8b949e] hover:text-white rounded"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <label htmlFor={id} className={labelClass}>
          Bind a {kindName}
        </label>
        <div className="flex gap-2">
          <input
            id={id}
            type="text"
            list={optionsId}
            spellCheck={false}
            value={text}
            placeholder={`${kindName} id`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className={`${inputClass} font-mono`}
            {...described(messagesId, inline(problem), hintId)}
          />
          <datalist id={optionsId}>
            {unbound.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={add}
            aria-disabled={value === "" || problem !== null}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs aria-disabled:opacity-50"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            Bind
          </button>
        </div>
        <p id={hintId} className={hintClass}>
          Pick an existing {kindName}, or type an id for one not made yet, which is flagged until it exists.
        </p>
        <FieldMessages id={messagesId} issues={inline(problem)} />
      </div>
    </Section>
  );
};

/** The triggers whose `contractId` names this contract, as links. They bind through their own record. */
const TriggerSection: FC<{ triggers: TriggersStatus; onOpen: (ref: DefinitionRef) => void }> = ({ triggers, onOpen }) => (
  <Section title="Triggers">
    {triggers.state === "loading" ? (
      <p className="text-xs text-[#6e7681]">Looking for triggers…</p>
    ) : triggers.state === "failed" ? (
      <p role="alert" className="text-xs text-[#ff7b72] break-words">
        {triggers.error}
      </p>
    ) : (
      <>
        {triggers.found.ids.length === 0 ? (
          <p className="text-xs text-[#6e7681]">No saved trigger names this contract.</p>
        ) : (
          <ul className="space-y-1">
            {triggers.found.ids.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onOpen({ kind: "triggers", id })}
                  className="text-xs font-mono text-[#58a6ff] hover:underline"
                >
                  {id}
                </button>
              </li>
            ))}
          </ul>
        )}
        {triggers.found.unchecked.length > 0 && (
          <ul className="space-y-0.5">
            {/* Each line names a different file, so it is its own key. */}
            {triggers.found.unchecked.map((line) => (
              <li key={line} className="text-[11px] text-[#e3b341] break-words">
                Not searched: {line}
              </li>
            ))}
          </ul>
        )}
        <p className={hintClass}>A trigger names its contract in its own file, so it is set from the trigger.</p>
      </>
    )}
  </Section>
);
