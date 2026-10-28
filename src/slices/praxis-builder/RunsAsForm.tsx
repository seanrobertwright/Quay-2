// The inspector's graph binding sections (#247, #273). With a binding chosen in the Binding
// picker, a TASK, LOOP or COMPENSATION node's inspector gets **Runs as**, which edits the node's
// entry, and the canvas background's gets **Binding**, which edits the binding's graph-level
// fields. Every edit is a step of the graph workspace's history. The backend shape-checks the
// binding; each field shows the issues whose JSON Pointer points into it.
import { useId, useState, type FC, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { formatDuration } from "../../lib/dates.ts";
import { described, FieldMessages, inputBaseClass, inputClass, labelClass } from "./ConfigForms.tsx";
import { integerProblem } from "./contract.ts";
import { entriesOf, type BindingEdit, type BindingRole, type SuggestedField } from "./graphBinding.ts";
import { isObject, type Json, type JsonObject, type PraxisNode } from "./model.ts";
import { COST_UNIT_LABEL, DurationInput, hintClass, inline, StringList, TextInput } from "./RecordFields.tsx";
import type { Diagnostic } from "./types.ts";

/** The binding chosen for the graph shown, as the inspector edits it. */
export interface ShownBinding {
  id: string;
  content: JsonObject;
  /** The binding's validation issues against the graph draft, or none while it is checked. */
  diagnostics: readonly Diagnostic[];
  /** Ids already used in the project's bindings, for the id fields' suggestions. */
  suggestions: Readonly<Record<SuggestedField, readonly string[]>>;
  onEdit: (edit: BindingEdit) => void;
}

/** What Praxis checks only at attach, so the builder can't (#247). */
export const ATTACH_NOTE = "Agents, protocol bindings and readiness are checked by Praxis when a run is attached.";

/** Why FUNCTION and HUMAN can't be chosen for a LOOP or COMPENSATION (#247). */
export const NOT_RUN_YET = "Praxis doesn't run these yet";

const headingClass = "text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]";
const sectionClass = "px-4 py-3 border-b border-[#21262d] space-y-3";

/** Keys for a list whose items have no id: the item and how many equal items come before it. */
function occurrenceKeys(items: readonly unknown[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = JSON.stringify(item);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

/** A JSON Pointer segment (RFC 6901). */
const segment = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** The issues at `path` or inside it. */
function issuesIn(diagnostics: readonly Diagnostic[], path: string): Diagnostic[] {
  return diagnostics.filter((d) => d.path === path || d.path.startsWith(`${path}/`));
}

/** A whole number field that may be left empty, which removes the value. */
const OptionalCount: FC<{
  label: string;
  labelNote?: string;
  value: Json | undefined;
  /** How the value is stored: a JSON number, or the SDK's decimal string. */
  as: "number" | "string";
  min: bigint;
  hint: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: Json | undefined) => void;
}> = ({ label, labelNote, value, as, min, hint, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const applied = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const [text, setText] = useState(applied);
  const [synced, setSynced] = useState(applied);
  if (synced !== applied) {
    setSynced(applied);
    setText(applied);
  }
  const problemOf = (t: string) => {
    if (t.trim() === "") return null;
    const p = integerProblem(t, min);
    if (p) return p;
    return as === "number" && !Number.isSafeInteger(Number(t.trim())) ? "This is larger than Praxis can store." : null;
  };
  const problem = text === applied ? null : problemOf(text);
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
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (problemOf(next) !== null) return;
          const t = next.trim();
          onChange(t === "" ? undefined : as === "number" ? Number(t) : t);
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

/** A free-text id with suggestions from the ids already used in the project (#247). */
const SuggestedText: FC<{
  label: string;
  value: Json | undefined;
  suggestions: readonly string[];
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: string) => void;
}> = ({ label, value, suggestions, issues, onChange }) => {
  const id = useId();
  const listId = useId();
  const messagesId = useId();
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
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} font-mono`}
        {...described(messagesId, issues)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

/** Raw JSON, applied whenever it parses. `optional` lets an empty field remove the value. */
const JsonField: FC<{
  label: string;
  value: Json | undefined;
  optional?: boolean;
  hint?: string;
  issues: readonly Diagnostic[] | undefined;
  onChange: (value: Json | undefined) => void;
}> = ({ label, value, optional, hint, issues, onChange }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const applied = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(applied);
  const [synced, setSynced] = useState(applied);
  if (synced !== applied) {
    setSynced(applied);
    setText(applied);
  }
  const parse = (t: string): { ok: true; value: Json | undefined } | { ok: false; problem: string } => {
    if (t.trim() === "") return optional ? { ok: true, value: undefined } : { ok: false, problem: "Enter JSON." };
    try {
      return { ok: true, value: JSON.parse(t) as Json };
    } catch (e) {
      return { ok: false, problem: `Not valid JSON: ${(e as Error).message}` };
    }
  };
  const result = text === applied ? null : parse(text);
  const shown = result && !result.ok ? inline(result.problem) : issues;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea
        id={id}
        spellCheck={false}
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parse(e.target.value);
          if (parsed.ok) onChange(parsed.value);
        }}
        className={`${inputClass} font-mono resize-y`}
        {...described(messagesId, shown, hint ? hintId : undefined)}
      />
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      <FieldMessages id={messagesId} issues={shown} />
    </div>
  );
};

/** One choice of several, as native radio buttons with their own labels. */
const Choice: FC<{
  legend: string;
  options: readonly { value: string; label: string }[];
  value: Json | undefined;
  issues?: readonly Diagnostic[];
  onChange: (value: string) => void;
}> = ({ legend, options, value, issues, onChange }) => {
  const name = useId();
  const messagesId = useId();
  return (
    <fieldset {...described(messagesId, issues)}>
      <legend className={labelClass}>{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <label
            key={o.value}
            className="px-2 py-1 rounded-md text-[11px] border cursor-pointer bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white has-checked:bg-[#1f6feb]/25 has-checked:border-[#58a6ff] has-checked:text-white has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-[#58a6ff]"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      <FieldMessages id={messagesId} issues={issues} />
    </fieldset>
  );
};

/**
 * The commands an AGENT runs, each an argument list with the program first (#224): arguments
 * are added one at a time, so nothing is split the way a shell would split it.
 */
const CommandsField: FC<{
  value: Json | undefined;
  /** The pointer to the entry's `commands`. */
  base: string;
  issues: readonly Diagnostic[];
  onChange: (commands: string[][]) => void;
}> = ({ value, base, issues, onChange }) => {
  const headingId = useId();
  const messagesId = useId();
  const commands = Array.isArray(value)
    ? value.map((c) => (Array.isArray(c) ? c.filter((a): a is string => typeof a === "string") : []))
    : [];
  const set = (i: number, args: string[]) => onChange(commands.map((c, j) => (j === i ? args : c)));
  // Keyed by program, so adding an argument keeps the command's field, and its focus.
  const keys = occurrenceKeys(commands.map((c) => c[0] ?? ""));
  const own = issues.filter((d) => d.path === base);
  return (
    <div>
      <h4 id={headingId} className={labelClass}>
        Commands
      </h4>
      {commands.length === 0 && <p className="text-[11px] text-[#6e7681]">None yet. An agent runs at least one.</p>}
      <ol aria-labelledby={headingId} className="space-y-2" {...described(messagesId, own)}>
        {commands.map((args, i) => (
          <li key={keys[i]} className="rounded-md border border-[#30363d] p-1.5 space-y-1">
            <CommandArgs
              index={i}
              args={args}
              issues={issuesIn(issues, `${base}/${i}`)}
              onChange={(next) => set(i, next)}
              onRemove={() => onChange(commands.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => onChange([...commands, []])}
        className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        Add command
      </button>
      <FieldMessages id={messagesId} issues={own} />
    </div>
  );
};

const CommandArgs: FC<{
  index: number;
  args: string[];
  issues: readonly Diagnostic[];
  onChange: (args: string[]) => void;
  onRemove: () => void;
}> = ({ index, args, issues, onChange, onRemove }) => {
  const id = useId();
  const messagesId = useId();
  const [text, setText] = useState("");
  const add = () => {
    if (text === "" && args.length === 0) return;
    onChange([...args, text]);
    setText("");
  };
  const name = `command ${index + 1}`;
  const keys = occurrenceKeys(args);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {args.map((arg, j) => (
          <span key={keys[j]} className="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 rounded bg-[#21262d] border border-[#30363d] text-[11px] font-mono">
            {arg === "" ? <span className="text-[#6e7681]">(empty)</span> : arg}
            <button
              type="button"
              aria-label={`Remove argument ${j + 1} of ${name}`}
              onClick={() => onChange(args.filter((_, k) => k !== j))}
              className="p-0.5 rounded hover:bg-[#30363d]"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="ml-auto p-0.5 rounded text-[#8b949e] hover:text-[#ff7b72]"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <label htmlFor={id} className="sr-only">
        {args.length === 0 ? `Program of ${name}` : `Next argument of ${name}`}
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        value={text}
        placeholder={args.length === 0 ? "Program, then Enter" : "Argument, then Enter"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        className={`${inputClass} font-mono`}
        {...described(messagesId, issues)}
      />
      <FieldMessages id={messagesId} issues={issues} />
    </>
  );
};

/** Bounded (an allowance and a stop threshold in the ledger unit) or Not applicable (a justification). */
const ExposureField: FC<{
  value: Json | undefined;
  issues: readonly Diagnostic[];
  base: string;
  onChange: (exposure: JsonObject) => void;
}> = ({ value, issues, base, onChange }) => {
  const exposure = isObject(value) ? value : {};
  const kind = exposure.kind === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "BOUNDED";
  const at = (key: string) => issuesIn(issues, `${base}/${key}`);
  return (
    <div className="space-y-2">
      <Choice
        legend="Exposure"
        options={[
          { value: "BOUNDED", label: "Bounded" },
          { value: "NOT_APPLICABLE", label: "Not applicable" },
        ]}
        value={exposure.kind}
        issues={issues.filter((d) => d.path === base)}
        onChange={(k) =>
          onChange(k === "BOUNDED" ? { kind: k, allowance: "", stopThreshold: "" } : { kind: k, justification: "" })
        }
      />
      {kind === "BOUNDED" ? (
        <>
          <OptionalCount
            label="Allowance"
            labelNote={COST_UNIT_LABEL}
            value={exposure.allowance}
            as="string"
            min={1n}
            hint="A whole number each attempt reserves in full."
            issues={at("allowance")}
            onChange={(v) => onChange({ ...exposure, kind, allowance: v ?? "" })}
          />
          <OptionalCount
            label="Stop threshold"
            labelNote={COST_UNIT_LABEL}
            value={exposure.stopThreshold}
            as="string"
            min={1n}
            hint="A whole number, no more than the allowance."
            issues={at("stopThreshold")}
            onChange={(v) => onChange({ ...exposure, kind, stopThreshold: v ?? "" })}
          />
        </>
      ) : (
        <TextInput
          label="Justification"
          value={typeof exposure.justification === "string" ? exposure.justification : ""}
          hint="Only for an agent whose model set is empty."
          issues={at("justification")}
          onChange={(v) => onChange({ ...exposure, kind, justification: v })}
        />
      )}
    </div>
  );
};

/** A stored millisecond count as `DurationInput` takes it, and back. */
const msText = (v: Json | undefined) => (typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined);
const msValue = (ms: string): number | undefined => {
  const n = Number(ms);
  return Number.isSafeInteger(n) ? n : undefined;
};
const durationHint = (v: Json | undefined, base: string) =>
  typeof v === "number" ? `${base} Now ${formatDuration(v)}.` : base;

/**
 * Runs as: the chosen binding's entry for one TASK, LOOP or COMPENSATION node (#247). With no
 * binding chosen it says how to pick one.
 */
export const RunsAsSection: FC<{ node: PraxisNode; binding: ShownBinding | null }> = ({ node, binding }) => {
  const kindId = useId();
  const messagesId = useId();
  if (!binding) {
    return (
      <section aria-label="Runs as" className={sectionClass}>
        <h3 className={headingClass}>Runs as</h3>
        <p className="text-[11px] text-[#8b949e]">Pick a binding to set what this node runs.</p>
      </section>
    );
  }
  const entries = entriesOf(binding.content);
  const entry = Object.prototype.hasOwnProperty.call(entries, node.id) ? entries[node.id] : null;
  const base = `/nodes/${segment(node.id)}`;
  const at = (key: string) => issuesIn(binding.diagnostics, `${base}/${key}`);
  const nodeIssues = binding.diagnostics.filter((d) => d.path === base || (d.nodeId === node.id && d.path === "/nodes"));
  const set = (key: string, value: Json | undefined, live = false) =>
    binding.onEdit({ type: "set-entry-field", node: node.id, key, value, live });
  const graphKind = typeof node.config.executionKind === "string" ? node.config.executionKind : "AGENT";

  let body: ReactNode;
  if (!entry) {
    body = (
      <button
        type="button"
        onClick={() => binding.onEdit({ type: "add-entry", node: node.id, executionKind: node.kind === "TASK" ? graphKind : "AGENT" })}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        Add an entry for {node.id}
      </button>
    );
  } else {
    const kind = typeof entry.executionKind === "string" ? entry.executionKind : "";
    const role: BindingRole = entry.role === "VALIDATION" ? "VALIDATION" : "WORK";
    body = (
      <>
        {node.kind === "TASK" ? (
          <div>
            <label htmlFor={kindId} className={labelClass}>
              Execution kind
            </label>
            <input
              id={kindId}
              readOnly
              value={kind}
              className={`${inputBaseClass} w-full font-mono text-[#8b949e]`}
              {...described(messagesId, at("executionKind"))}
            />
            <p className={hintClass}>Read-only: a TASK runs as its graph node says ({graphKind}).</p>
            <FieldMessages id={messagesId} issues={at("executionKind")} />
          </div>
        ) : (
          <div>
            <label htmlFor={kindId} className={labelClass}>
              Execution kind
            </label>
            <select
              id={kindId}
              value={kind}
              onChange={(e) => binding.onEdit({ type: "set-execution-kind", node: node.id, executionKind: e.target.value })}
              className={`${inputBaseClass} w-full text-[#c9d1d9]`}
              {...described(messagesId, at("executionKind"))}
            >
              <option value="AGENT">AGENT</option>
              <option value="TOOL">TOOL</option>
              <option value="FUNCTION" disabled>
                FUNCTION ({NOT_RUN_YET})
              </option>
              <option value="HUMAN" disabled>
                HUMAN ({NOT_RUN_YET})
              </option>
            </select>
            <FieldMessages id={messagesId} issues={at("executionKind")} />
          </div>
        )}
        {(kind === "AGENT" || kind === "TOOL") && (
          <>
            <Choice
              legend="Role"
              options={[
                { value: "WORK", label: "Work" },
                { value: "VALIDATION", label: "Validation" },
              ]}
              value={role}
              issues={at("role")}
              onChange={(r) => binding.onEdit({ type: "set-role", node: node.id, role: r as BindingRole })}
            />
            {role === "VALIDATION" && (
              <StringList
                label="Criteria"
                addLabel="Add a criterion, then Enter"
                items={Array.isArray(entry.criteria) ? entry.criteria.filter((c): c is string => typeof c === "string") : []}
                issues={at("criteria")}
                onChange={(items) => set("criteria", items)}
              />
            )}
          </>
        )}
        {kind === "AGENT" && (
          <>
            <SuggestedText
              label="Agent id"
              value={entry.agentId}
              suggestions={binding.suggestions.agentId}
              issues={at("agentId")}
              onChange={(v) => set("agentId", v, true)}
            />
            <CommandsField value={entry.commands} base={`${base}/commands`} issues={at("commands")} onChange={(c) => set("commands", c)} />
            <StringList
              label="Output paths"
              addLabel="Add a relative path, then Enter"
              items={Array.isArray(entry.outputPaths) ? entry.outputPaths.filter((p): p is string => typeof p === "string") : []}
              issues={at("outputPaths")}
              onChange={(items) => set("outputPaths", items)}
            />
          </>
        )}
        {kind === "TOOL" && (
          <>
            <SuggestedText
              label="Protocol binding id"
              value={entry.protocolBindingId}
              suggestions={binding.suggestions.protocolBindingId}
              issues={at("protocolBindingId")}
              onChange={(v) => set("protocolBindingId", v, true)}
            />
            <SuggestedText
              label="Action"
              value={entry.action}
              suggestions={binding.suggestions.action}
              issues={at("action")}
              onChange={(v) => set("action", v, true)}
            />
            <SuggestedText
              label="Resource"
              value={entry.resource}
              suggestions={binding.suggestions.resource}
              issues={at("resource")}
              onChange={(v) => set("resource", v, true)}
            />
            <JsonField
              label="Payload"
              value={entry.payload}
              hint="A static JSON value, sent as reviewed."
              issues={at("payload")}
              onChange={(v) => set("payload", v ?? {}, true)}
            />
          </>
        )}
        {(kind === "AGENT" || kind === "TOOL") && (
          <>
            <ExposureField value={entry.exposure} base={`${base}/exposure`} issues={at("exposure")} onChange={(v) => set("exposure", v)} />
            <OptionalCount
              label="Max attempts"
              value={entry.maxAttempts}
              as="number"
              min={1n}
              hint="Optional. Left empty, the contract's maxAttempts applies."
              issues={at("maxAttempts")}
              onChange={(v) => set("maxAttempts", v, true)}
            />
            <details className="space-y-2">
              <summary className="cursor-pointer text-[11px] text-[#8b949e]">Advanced</summary>
              {kind === "AGENT" && (
                <JsonField
                  label="Requirements"
                  value={entry.requirements}
                  hint="Readiness requirements above the runner's minimums, as a JSON list."
                  issues={at("requirements")}
                  onChange={(v) => set("requirements", v ?? [], true)}
                />
              )}
              <DurationInput
                label="Max task time"
                value={msText(entry.maxTaskMs)}
                hint={durationHint(entry.maxTaskMs, "One attempt's longest run, at least 1 second.")}
                issues={at("maxTaskMs")}
                onChange={(ms) => set("maxTaskMs", msValue(ms), true)}
              />
            </details>
            <p className={hintClass}>{ATTACH_NOTE}</p>
          </>
        )}
        {(kind === "FUNCTION" || kind === "HUMAN") && (
          <p className="text-[11px] text-[#8b949e]">
            A {kind} entry carries nothing else yet. {NOT_RUN_YET}, so a run with it is refused.
          </p>
        )}
      </>
    );
  }
  const nodeMessagesId = `${messagesId}-node`;
  return (
    <section aria-label={`Runs as ${binding.id}`} className={sectionClass}>
      <h3 className={headingClass}>
        Runs as: <span className="font-mono normal-case tracking-normal">{binding.id}</span>
      </h3>
      <FieldMessages id={nodeMessagesId} issues={nodeIssues} />
      {body}
    </section>
  );
};

/** The Binding section of the graph inspector (#247): the chosen binding's graph-level fields. */
export const BindingSection: FC<{ binding: ShownBinding }> = ({ binding }) => {
  const c = binding.content;
  const at = (key: string) => issuesIn(binding.diagnostics, `/${key}`);
  const set = (key: string, value: Json | undefined, live = false) => binding.onEdit({ type: "set-field", key, value, live });
  return (
    <section aria-label={`Binding ${binding.id}`} className={sectionClass}>
      <h3 className={headingClass}>
        Binding: <span className="font-mono normal-case tracking-normal">{binding.id}</span>
      </h3>
      <TextInput
        label="Cost unit"
        value={typeof c.costUnit === "string" ? c.costUnit : ""}
        hint="Must equal the ledger's cost unit, which Praxis checks when a run is attached."
        issues={at("costUnit")}
        onChange={(v) => set("costUnit", v, true)}
      />
      <OptionalCount
        label="Max total cost"
        labelNote={COST_UNIT_LABEL}
        value={c.maxTotalCost}
        as="string"
        min={0n}
        hint="Optional. Left empty, the run's cost bound comes from its contract."
        issues={at("maxTotalCost")}
        onChange={(v) => set("maxTotalCost", v, true)}
      />
      <DurationInput
        label="Max total active time"
        value={msText(c.maxTotalActiveMs)}
        hint={durationHint(c.maxTotalActiveMs, "The run's active-time limit, at least 1 second.")}
        issues={at("maxTotalActiveMs")}
        onChange={(ms) => set("maxTotalActiveMs", msValue(ms), true)}
      />
      <details className="space-y-2">
        <summary className="cursor-pointer text-[11px] text-[#8b949e]">Advanced</summary>
        <JsonField
          label="Context policy"
          value={c.contextPolicy}
          optional
          hint="Optional coding-context-policy/1 JSON, received by every AGENT node. Empty removes it."
          issues={at("contextPolicy")}
          onChange={(v) => set("contextPolicy", v, true)}
        />
      </details>
      <p className={hintClass}>{ATTACH_NOTE}</p>
    </section>
  );
};
