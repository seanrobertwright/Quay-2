// Each node kind's config form in the inspector (#226), keyed by the kinds of the registry in
// `kinds.ts`. A kind with no form has a config that is always `{}`.
import { useId, useState, type FC, type KeyboardEvent } from "react";
import { CircleAlert, Info } from "lucide-react";
import { EXECUTION_KINDS, JOIN_MODES } from "./kinds.ts";
import type { Branch, GraphEdit } from "./editor.ts";
import type { Json, NodeKind, PraxisGraph, PraxisNode } from "./model.ts";
import { withKeys } from "./issues.ts";
import type { Diagnostic } from "./types.ts";

export interface ConfigFormProps {
  node: PraxisNode;
  graph: PraxisGraph;
  /** The node's issues by inspector slot (`config.then`), from `nodeIssuesBySlot`. */
  issues: ReadonlyMap<string, readonly Diagnostic[]>;
  onEdit: (edit: GraphEdit) => void;
}

export const CONFIG_FORMS: Record<NodeKind, FC<ConfigFormProps> | null> = {
  TASK: TaskForm,
  DECISION: DecisionForm,
  JOIN: JoinForm,
  LOOP: LoopForm,
  FORK: null,
  WAIT: null,
  APPROVAL: null,
  SUBWORKFLOW: null,
  VERIFICATION: null,
  ACCEPTANCE: null,
  RECONCILIATION: null,
  COMPENSATION: null,
  END: null,
};

/**
 * A field's look without its width or text colour. Tailwind settles two classes for one
 * property by stylesheet order, not class order, so a field that needs another width or
 * colour adds it to this rather than to `inputClass`.
 */
export const inputBaseClass =
  "bg-[#0d1117] border border-[#30363d] rounded-md px-2 py-1 text-xs focus:outline-none focus:border-[#58a6ff] aria-invalid:border-[#f85149]";
export const inputClass = `${inputBaseClass} w-full text-[#c9d1d9]`;
export const labelClass = "block text-[11px] font-medium text-[#8b949e] mb-1";
const hintClass = "mt-1 text-[10px] text-[#6e7681]";

/** The validation messages for one control. `id` lets the control point at them. */
export const FieldMessages: FC<{ id: string; issues: readonly Diagnostic[] | undefined }> = ({ id, issues }) =>
  issues && issues.length > 0 ? (
    <ul id={id} className="mt-1 space-y-0.5">
      {withKeys(issues).map(([key, d]) => (
        <li
          key={key}
          className={`flex items-start gap-1 text-[11px] break-words ${d.severity === "error" ? "text-[#ff7b72]" : "text-[#79c0ff]"}`}
        >
          {d.severity === "error" ? (
            <CircleAlert className="w-3 h-3 mt-px shrink-0" aria-label="Error" role="img" />
          ) : (
            <Info className="w-3 h-3 mt-px shrink-0" aria-label="Info" role="img" />
          )}
          <span className="min-w-0">{d.message}</span>
        </li>
      ))}
    </ul>
  ) : null;

/** `aria-describedby` and `aria-invalid` for a control with these issues. */
export function described(id: string, issues: readonly Diagnostic[] | undefined, extra?: string) {
  const ids = [issues?.length ? id : "", extra ?? ""].filter(Boolean).join(" ");
  return {
    "aria-describedby": ids || undefined,
    "aria-invalid": issues?.some((d) => d.severity === "error") || undefined,
  };
}

/** A choice of one value, as native radio buttons styled as a row of pills. */
const RadioGroup: FC<{
  legend: string;
  options: readonly string[];
  value: Json | undefined;
  onChange: (value: string) => void;
  issues: readonly Diagnostic[] | undefined;
}> = ({ legend, options, value, onChange, issues }) => {
  const name = useId();
  const messagesId = useId();
  return (
    <fieldset aria-describedby={issues?.length ? messagesId : undefined}>
      <legend className={labelClass}>{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <label
            key={option}
            className="px-2 py-1 rounded-md text-[11px] font-mono border cursor-pointer bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white has-checked:bg-[#1f6feb]/25 has-checked:border-[#58a6ff] has-checked:text-white has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-[#58a6ff]"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {option}
          </label>
        ))}
      </div>
      <FieldMessages id={messagesId} issues={issues} />
    </fieldset>
  );
};

function TaskForm({ node, issues, onEdit }: ConfigFormProps) {
  return (
    <RadioGroup
      legend="Execution kind"
      options={EXECUTION_KINDS}
      value={node.config.executionKind}
      onChange={(value) => onEdit({ type: "set-config", id: node.id, key: "executionKind", value })}
      issues={issues.get("config.executionKind")}
    />
  );
}

function JoinForm({ node, issues, onEdit }: ConfigFormProps) {
  return (
    <div>
      <RadioGroup
        legend="Mode"
        options={JOIN_MODES}
        value={node.config.mode}
        onChange={(value) => onEdit({ type: "set-config", id: node.id, key: "mode", value })}
        issues={issues.get("config.mode")}
      />
      <p className={hintClass}>
        {node.config.mode === "ANY"
          ? "Goes on when the first node it depends on finishes."
          : "Goes on when every node it depends on finishes."}
      </p>
    </div>
  );
}

function LoopForm({ node, issues, onEdit }: ConfigFormProps) {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const raw = node.config.maxIterations;
  const slot = issues.get("config.maxIterations");
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Max iterations
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        spellCheck={false}
        className={`${inputBaseClass} w-24 text-[#c9d1d9] font-mono`}
        // The SDK stores a decimal string; a hand-edited number is shown, and saved as text.
        value={typeof raw === "string" || typeof raw === "number" ? String(raw) : ""}
        onChange={(e) => onEdit({ type: "set-config", id: node.id, key: "maxIterations", value: e.target.value, live: true })}
        {...described(messagesId, slot, hintId)}
      />
      <p id={hintId} className={hintClass}>
        A whole number of 1 or more, such as 3.
      </p>
      <FieldMessages id={messagesId} issues={slot} />
    </div>
  );
}

function DecisionForm({ node, graph, issues, onEdit }: ConfigFormProps) {
  const fieldId = useId();
  const fieldMessagesId = useId();
  const fieldSlot = issues.get("config.field");
  const field = node.config.field;
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={fieldId} className={labelClass}>
          field <span className="font-normal">(in this node&apos;s result)</span>
        </label>
        <input
          id={fieldId}
          type="text"
          spellCheck={false}
          className={`${inputClass} font-mono`}
          value={typeof field === "string" ? field : ""}
          onChange={(e) => onEdit({ type: "set-config", id: node.id, key: "field", value: e.target.value, live: true })}
          {...described(fieldMessagesId, fieldSlot)}
        />
        <FieldMessages id={fieldMessagesId} issues={fieldSlot} />
      </div>
      <EqualsInput
        value={node.config.equals}
        onCommit={(value) => onEdit({ type: "set-config", id: node.id, key: "equals", value })}
        issues={issues.get("config.equals")}
      />
      <BranchPicker node={node} graph={graph} branch="then" issues={issues.get("config.then")} onEdit={onEdit} />
      <BranchPicker node={node} graph={graph} branch="else" issues={issues.get("config.else")} onEdit={onEdit} />
    </div>
  );
}

/** What `text` holds as JSON, or why it isn't JSON. */
function readJson(text: string): { ok: true; value: Json } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false };
  }
}

/**
 * DECISION `equals`: any JSON value, typed as JSON. It is applied on Enter or when focus
 * leaves, and only when it parses; Escape puts back the value applied last.
 */
const EqualsInput: FC<{
  value: Json | undefined;
  onCommit: (value: Json) => void;
  issues: readonly Diagnostic[] | undefined;
}> = ({ value, onCommit, issues }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const applied = value === undefined ? "" : JSON.stringify(value);
  const [text, setText] = useState(applied);
  // A change from outside (another edit, a reload) replaces what is typed.
  const [synced, setSynced] = useState(applied);
  if (synced !== applied) {
    setSynced(applied);
    setText(applied);
  }
  const parsed = text === "" ? null : readJson(text);
  const notJson = parsed !== null && !parsed.ok;
  const commit = () => {
    if (parsed?.ok && text !== applied) onCommit(parsed.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape" && text !== applied) {
      // Handled here, so the builder doesn't close.
      e.preventDefault();
      setText(applied);
    }
  };
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        equals <span className="font-normal">(a JSON value)</span>
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        className={`${inputClass} font-mono`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        {...described(messagesId, issues, hintId)}
        aria-invalid={notJson || issues?.some((d) => d.severity === "error") || undefined}
      />
      <p id={hintId} className={`${hintClass} ${notJson ? "!text-[#ff7b72]" : ""}`}>
        {notJson
          ? 'Not JSON, so not applied. Put text in quotes, such as "done".'
          : 'Such as true, 3 or "done". Applied on Enter.'}
      </p>
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

const BranchPicker: FC<{
  node: PraxisNode;
  graph: PraxisGraph;
  branch: Branch;
  issues: readonly Diagnostic[] | undefined;
  onEdit: (edit: GraphEdit) => void;
}> = ({ node, graph, branch, issues, onEdit }) => {
  const id = useId();
  const messagesId = useId();
  const raw = node.config[branch];
  const value = typeof raw === "string" ? raw : "";
  const missing = value !== "" && !graph.nodes.some((n) => n.id === value);
  return (
    <div>
      <label htmlFor={id} className={`${labelClass} flex items-center gap-1.5`}>
        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${branch === "then" ? "bg-[#3fb950]" : "bg-[#f85149]"}`} />
        {branch === "then" ? "then: when it matches" : "else: when it doesn't"}
      </label>
      <select
        id={id}
        className={`${inputClass} font-mono`}
        value={value}
        onChange={(e) => onEdit({ type: "set-branch", decision: node.id, branch, target: e.target.value })}
        {...described(messagesId, issues)}
      >
        <option value="">No node</option>
        {graph.nodes
          .filter((n) => n.id !== node.id)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}
            </option>
          ))}
        {missing && (
          <option value={value} disabled>
            {value} (not in this graph)
          </option>
        )}
      </select>
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};
