// PROTOTYPE (#226) — throwaway. Inspector pieces: the per-kind config form, the id and
// dependsOn editors, and three candidate inputSchema/outputSchema editors.
import { useId, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import { CircleAlert, Plus, Sparkles, Table2, Braces, TriangleAlert, X } from "lucide-react";
import {
  disconnect,
  connect,
  EXECUTION_KINDS,
  JOIN_MODES,
  setBranch,
  setConfig,
  type Issue,
  type Json,
  type JsonObject,
  type PGraph,
  type PNode,
} from "./model";
import { KIND_META } from "./kinds";

export type Edit = (f: (g: PGraph) => PGraph) => void;

export interface VariantProps {
  graph: PGraph;
  issues: Issue[];
  selectedId: string | null;
  select: (id: string | null) => void;
  edit: Edit;
}

const inputCls =
  "w-full bg-[#0d1117] border border-[#30363d] rounded-md px-2 py-1 text-xs text-[#c9d1d9] focus:outline-none focus:border-[#58a6ff]";
const labelCls = "block text-[11px] font-medium text-[#8b949e] mb-1";

export const FieldIssues: FC<{ issues: Issue[]; field: string }> = ({ issues, field }) => {
  const mine = issues.filter((i) => i.field === field);
  if (!mine.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {mine.map((i) => (
        <li key={i.key} className={`flex items-start gap-1 text-[11px] ${i.severity === "error" ? "text-[#ff7b72]" : "text-[#e3b341]"}`}>
          {i.severity === "error" ? <CircleAlert className="w-3 h-3 mt-px shrink-0" /> : <TriangleAlert className="w-3 h-3 mt-px shrink-0" />}
          {i.message}
        </li>
      ))}
    </ul>
  );
};

const Segmented: FC<{ label: string; options: readonly string[]; value: unknown; onChange: (v: string) => void; hint?: (v: string) => string }> = ({
  label,
  options,
  value,
  onChange,
  hint,
}) => (
  <div>
    <span className={labelCls}>{label}</span>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          title={hint?.(o)}
          onClick={() => onChange(o)}
          className={`px-2 py-1 rounded-md text-[11px] font-mono border transition-colors ${
            value === o ? "bg-[#1f6feb]/25 border-[#58a6ff] text-white" : "bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  </div>
);

export const IdField: FC<{ node: PNode; issues: Issue[]; onRename: (to: string) => void }> = ({ node, issues, onRename }) => {
  const id = useId();
  const [text, setText] = useState(node.id);
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        Id <span className="font-normal">(rename rewrites dependsOn and decision targets)</span>
      </label>
      <input
        id={id}
        className={`${inputCls} font-mono`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== node.id && onRename(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <FieldIssues issues={issues} field="id" />
    </div>
  );
};

const EqualsInput: FC<{ value: Json; onCommit: (v: Json) => void }> = ({ value, onCommit }) => {
  const id = useId();
  const [text, setText] = useState(JSON.stringify(value));
  let parsed: Json = text;
  let asJson = false;
  try {
    parsed = JSON.parse(text) as Json;
    asJson = true;
  } catch {
    /* falls back to a plain string */
  }
  const type = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        equals <span className="font-normal">(a JSON value)</span>
      </label>
      <input id={id} className={`${inputCls} font-mono`} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onCommit(parsed)} />
      <p className="mt-1 text-[10px] text-[#6e7681]">
        Read as <span className="font-mono text-[#8b949e]">{type}</span>
        {!asJson && " (not JSON, so it is taken as a string)"}
      </p>
    </div>
  );
};

const BranchSelect: FC<{ node: PNode; graph: PGraph; branch: "then" | "else"; issues: Issue[]; edit: Edit }> = ({ node, graph, branch, issues, edit }) => {
  const id = useId();
  const value = typeof node.config[branch] === "string" ? (node.config[branch] as string) : "";
  return (
    <div>
      <label htmlFor={id} className={`${labelCls} flex items-center gap-1.5`}>
        <span className={`w-2 h-2 rounded-full ${branch === "then" ? "bg-[#3fb950]" : "bg-[#f85149]"}`} />
        {branch === "then" ? "then → when it matches" : "else → when it does not"}
      </label>
      <select id={id} className={inputCls} value={value} onChange={(e) => edit((g) => setBranch(g, node.id, branch, e.target.value))}>
        <option value="">— choose a node —</option>
        {graph.nodes
          .filter((x) => x.id !== node.id)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} ({x.kind})
            </option>
          ))}
        {value && !graph.nodes.some((x) => x.id === value) && <option value={value}>{value} (missing)</option>}
      </select>
      <FieldIssues issues={issues} field={`config.${branch}`} />
    </div>
  );
};

export const ConfigForm: FC<{ node: PNode; graph: PGraph; issues: Issue[]; edit: Edit; branchPickers?: boolean }> = ({
  node,
  graph,
  issues,
  edit,
  branchPickers = true,
}) => {
  const set = (k: string, v: Json) => edit((g) => setConfig(g, node.id, k, v));
  const fieldId = useId();
  const loopId = useId();
  switch (node.kind) {
    case "TASK":
      return (
        <div>
          <Segmented
            label="Execution kind"
            options={EXECUTION_KINDS}
            value={node.config.executionKind}
            onChange={(v) => set("executionKind", v)}
            hint={(v) => ({ AGENT: "An AI agent does it", FUNCTION: "Code runs it", TOOL: "A tool call", HUMAN: "A person does it" })[v] ?? ""}
          />
          <FieldIssues issues={issues} field="config.executionKind" />
        </div>
      );
    case "JOIN":
      return (
        <div>
          <Segmented label="Mode" options={JOIN_MODES} value={node.config.mode} onChange={(v) => set("mode", v)} />
          <p className="mt-1 text-[10px] text-[#6e7681]">
            {node.config.mode === "ANY" ? "Goes on when the first incoming node completes; the rest are skipped." : "Goes on when every incoming node completes."}
          </p>
          <FieldIssues issues={issues} field="config.mode" />
          <FieldIssues issues={issues} field="dependsOn" />
        </div>
      );
    case "LOOP":
      return (
        <div>
          <label htmlFor={loopId} className={labelCls}>
            Max iterations
          </label>
          <input
            id={loopId}
            type="number"
            min={1}
            step={1}
            className={`${inputCls} w-24`}
            value={String(node.config.maxIterations ?? "")}
            onChange={(e) => set("maxIterations", e.target.value)}
          />
          <p className="mt-1 text-[10px] text-[#6e7681]">The node reruns until its result says done; past the limit the run fails.</p>
          <FieldIssues issues={issues} field="config.maxIterations" />
        </div>
      );
    case "DECISION":
      return (
        <div className="space-y-3">
          <div>
            <label htmlFor={fieldId} className={labelCls}>
              field <span className="font-normal">(in this node&apos;s result data)</span>
            </label>
            <input id={fieldId} className={`${inputCls} font-mono`} value={String(node.config.field ?? "")} onChange={(e) => set("field", e.target.value)} />
            <FieldIssues issues={issues} field="config.field" />
          </div>
          <EqualsInput key={node.id} value={node.config.equals ?? null} onCommit={(v) => set("equals", v)} />
          {branchPickers ? (
            <>
              <BranchSelect node={node} graph={graph} branch="then" issues={issues} edit={edit} />
              <BranchSelect node={node} graph={graph} branch="else" issues={issues} edit={edit} />
            </>
          ) : (
            <div className="text-[11px] text-[#8b949e] space-y-1">
              <p>
                <span className="text-[#3fb950]">then</span> → <span className="font-mono">{String(node.config.then || "—")}</span> ·{" "}
                <span className="text-[#ff7b72]">else</span> → <span className="font-mono">{String(node.config.else || "—")}</span>
              </p>
              <p className="text-[10px] text-[#6e7681]">Set these on the canvas.</p>
              <FieldIssues issues={issues} field="config.then" />
              <FieldIssues issues={issues} field="config.else" />
            </div>
          )}
        </div>
      );
    default:
      return (
        <p className="text-[11px] text-[#6e7681]">
          {KIND_META[node.kind].label} nodes have no settings. Their config is always <span className="font-mono">{"{}"}</span>.
        </p>
      );
  }
};

export const DependsOnEditor: FC<{ node: PNode; graph: PGraph; issues: Issue[]; edit: Edit }> = ({ node, graph, issues, edit }) => {
  const id = useId();
  const options = graph.nodes.filter((x) => x.id !== node.id && !node.dependsOn.includes(x.id));
  return (
    <div>
      <span className={labelCls}>Depends on</span>
      <div className="flex flex-wrap gap-1">
        {node.dependsOn.length === 0 && <span className="text-[11px] text-[#6e7681]">Nothing: this node is a start node.</span>}
        {node.dependsOn.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[#21262d] border border-[#30363d] text-[11px] font-mono">
            {d}
            <button type="button" aria-label={`Remove dependency on ${d}`} className="p-0.5 rounded-full hover:bg-[#30363d]" onClick={() => edit((g) => disconnect(g, d, node.id))}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      {options.length > 0 && (
        <>
          <label htmlFor={id} className="sr-only">
            Add a dependency
          </label>
          <select id={id} className={`${inputCls} mt-1.5`} value="" onChange={(e) => e.target.value && edit((g) => connect(g, e.target.value, node.id))}>
            <option value="">+ add a dependency…</option>
            {options.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id}
              </option>
            ))}
          </select>
        </>
      )}
      <FieldIssues issues={issues} field="dependsOn" />
    </div>
  );
};

// --- schema editors ---------------------------------------------------------

export interface SchemaEditorProps {
  label: string;
  value: JsonObject | undefined;
  onChange: (v: JsonObject | undefined) => void;
}

const AddSchema: FC<{ label: string; onAdd: () => void; extra?: ReactNode }> = ({ label, onAdd, extra }) => (
  <div className="flex items-center gap-2">
    <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-[#30363d] text-[11px] text-[#8b949e] hover:text-white hover:border-[#58a6ff]">
      <Plus className="w-3 h-3" /> Add {label}
    </button>
    {extra}
  </div>
);

const EMPTY_OBJECT_SCHEMA: JsonObject = { type: "object", properties: {}, required: [] };

function parseObject(text: string): { ok: true; value: JsonObject } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text) as Json;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "A schema must be a JSON object." };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const RawJson: FC<{ label: string; value: JsonObject; onChange: (v: JsonObject) => void; rows?: number }> = ({ label, value, onChange, rows = 8 }) => {
  const id = useId();
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label} as JSON
      </label>
      <textarea
        id={id}
        rows={rows}
        spellCheck={false}
        className={`${inputCls} font-mono text-[11px] leading-snug resize-y ${error ? "border-[#f85149]" : ""}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const r = parseObject(e.target.value);
          setError(r.ok ? null : r.error);
        }}
        onBlur={() => {
          const r = parseObject(text);
          if (r.ok) onChange(r.value);
        }}
      />
      {error ? (
        <p className="text-[10px] text-[#ff7b72]">Not saved: {error}</p>
      ) : (
        <p className="text-[10px] text-[#6e7681]">Applied on blur. The backend checks it as JSON Schema 2020-12.</p>
      )}
    </div>
  );
};

const RemoveSchema: FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="text-[10px] text-[#8b949e] hover:text-[#ff7b72]">
    remove
  </button>
);

// Option 1: a raw JSON field and nothing else.
export const RawSchemaEditor: FC<SchemaEditorProps> = ({ label, value, onChange }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className={labelCls + " mb-0 font-mono"}>{label}</span>
      {value && <RemoveSchema label={label} onRemove={() => onChange(undefined)} />}
    </div>
    {value ? <RawJson key={JSON.stringify(value)} label={label} value={value} onChange={onChange} /> : <AddSchema label={label} onAdd={() => onChange(EMPTY_OBJECT_SCHEMA)} />}
  </div>
);

// Option 2: a field table for flat object schemas, with raw JSON as the escape hatch.
const TYPES = ["string", "integer", "number", "boolean", "array", "object"] as const;
interface Row {
  name: string;
  type: string;
  required: boolean;
  rest: JsonObject; // property keywords the table does not show, kept as they are
}

function toRows(s: JsonObject): Row[] | null {
  const allowed = new Set(["type", "properties", "required", "additionalProperties"]);
  if (s.type !== "object" || Object.keys(s).some((k) => !allowed.has(k))) return null;
  const props = (s.properties ?? {}) as JsonObject;
  const req = Array.isArray(s.required) ? (s.required as string[]) : [];
  const rows: Row[] = [];
  for (const [name, p] of Object.entries(props)) {
    if (!p || typeof p !== "object" || Array.isArray(p) || typeof p.type !== "string") return null;
    const { type, ...rest } = p;
    rows.push({ name, type: type as string, required: req.includes(name), rest });
  }
  return rows;
}

function fromRows(rows: Row[], base: JsonObject): JsonObject {
  const properties: JsonObject = {};
  for (const r of rows) if (r.name) properties[r.name] = { type: r.type, ...r.rest };
  return { ...base, type: "object", properties, required: rows.filter((r) => r.name && r.required).map((r) => r.name) };
}

export const FieldTableSchemaEditor: FC<SchemaEditorProps> = ({ label, value, onChange }) => {
  const [raw, setRaw] = useState(false);
  const rows = value ? toRows(value) : null;
  const showRaw = raw || (value !== undefined && rows === null);
  const update = (next: Row[]) => onChange(fromRows(next, value ?? {}));
  // Stable row keys: rows have no identity of their own until they are named.
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  while (rows && keys.current.length < rows.length) keys.current.push(nextKey.current++);
  const removeRow = (i: number) => {
    keys.current.splice(i, 1);
    update(rows!.filter((_, j) => j !== i));
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={labelCls + " mb-0 font-mono"}>{label}</span>
        {value && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={showRaw}
              disabled={rows === null}
              onClick={() => setRaw((r) => !r)}
              className="inline-flex items-center gap-1 text-[10px] text-[#8b949e] hover:text-white disabled:opacity-40"
              title={rows === null ? "This schema uses keywords the table cannot show" : "Switch between table and raw JSON"}
            >
              {showRaw ? <Table2 className="w-3 h-3" /> : <Braces className="w-3 h-3" />}
              {showRaw ? "table" : "raw JSON"}
            </button>
            <RemoveSchema label={label} onRemove={() => onChange(undefined)} />
          </div>
        )}
      </div>
      {!value ? (
        <AddSchema label={label} onAdd={() => onChange(EMPTY_OBJECT_SCHEMA)} />
      ) : showRaw ? (
        <>
          {rows === null && <p className="text-[10px] text-[#e3b341] mb-1">This schema uses keywords the table can&apos;t show, so it opens as JSON.</p>}
          <RawJson key={JSON.stringify(value)} label={label} value={value} onChange={onChange} />
        </>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[#6e7681] text-left">
              <th className="font-medium pb-1">Field</th>
              <th className="font-medium pb-1">Type</th>
              <th className="font-medium pb-1 text-center">Req.</th>
              <th className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {rows!.map((r, i) => (
              <tr key={keys.current[i]}>
                <td className="pr-1 py-0.5">
                  <input
                    aria-label={`${label} field ${i + 1} name`}
                    className={`${inputCls} font-mono`}
                    value={r.name}
                    onChange={(e) => update(rows!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                </td>
                <td className="pr-1 py-0.5">
                  <select
                    aria-label={`${label} field ${i + 1} type`}
                    className={inputCls}
                    value={r.type}
                    onChange={(e) => update(rows!.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  >
                    {TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  {Object.keys(r.rest).length > 0 && (
                    <span className="text-[9px] text-[#6e7681]" title={JSON.stringify(r.rest)}>
                      +{Object.keys(r.rest).length} rule
                    </span>
                  )}
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`${label} field ${i + 1} required`}
                    checked={r.required}
                    onChange={(e) => update(rows!.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
                  />
                </td>
                <td>
                  <button type="button" aria-label={`Remove ${label} field ${r.name || i + 1}`} className="p-0.5 text-[#8b949e] hover:text-[#ff7b72]" onClick={() => removeRow(i)}>
                    <X className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-1">
                <button type="button" onClick={() => update([...rows!, { name: "", type: "string", required: false, rest: {} }])} className="inline-flex items-center gap-1 text-[11px] text-[#58a6ff] hover:underline">
                  <Plus className="w-3 h-3" /> field
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
};

// Option 3: raw JSON plus "infer from an example" and a read-only field summary.
function infer(v: Json): JsonObject {
  if (v === null) return { type: "null" };
  if (Array.isArray(v)) return v.length ? { type: "array", items: infer(v[0]) } : { type: "array" };
  if (typeof v === "object") {
    const properties: JsonObject = {};
    for (const [k, x] of Object.entries(v)) properties[k] = infer(x);
    return { type: "object", properties, required: Object.keys(v) };
  }
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  return { type: typeof v };
}

export const InferSchemaEditor: FC<SchemaEditorProps> = ({ label, value, onChange }) => {
  const [example, setExample] = useState<string | null>(null);
  const exampleId = useId();
  const parsed = useMemo(() => {
    if (example === null) return null;
    try {
      return { ok: true as const, value: JSON.parse(example) as Json };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [example]);
  const props = value?.properties && typeof value.properties === "object" && !Array.isArray(value.properties) ? (value.properties as JsonObject) : null;
  const req = Array.isArray(value?.required) ? (value!.required as string[]) : [];
  const exampleButton = (
    <button type="button" onClick={() => setExample(example === null ? '{\n  "passed": true\n}' : null)} className="inline-flex items-center gap-1 text-[10px] text-[#d2a8ff] hover:text-white">
      <Sparkles className="w-3 h-3" /> {example === null ? "from an example" : "cancel example"}
    </button>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={labelCls + " mb-0 font-mono"}>{label}</span>
        <div className="flex items-center gap-2">
          {value && exampleButton}
          {value && <RemoveSchema label={label} onRemove={() => onChange(undefined)} />}
        </div>
      </div>
      {example !== null && (
        <div className="mb-2 p-2 rounded-md bg-[#d2a8ff]/5 border border-[#d2a8ff]/30">
          <label htmlFor={exampleId} className={labelCls}>
            Paste an example {label === "inputSchema" ? "input" : "result"}; Quay writes a schema that accepts it.
          </label>
          <textarea id={exampleId} rows={4} spellCheck={false} className={`${inputCls} font-mono text-[11px]`} value={example} onChange={(e) => setExample(e.target.value)} />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-[#ff7b72]">{parsed && !parsed.ok ? parsed.error : ""}</span>
            <button
              type="button"
              disabled={!parsed?.ok}
              onClick={() => {
                if (parsed?.ok) onChange(infer(parsed.value));
                setExample(null);
              }}
              className="px-2 py-0.5 rounded-md bg-[#8957e5] text-white text-[11px] disabled:opacity-40"
            >
              Replace schema
            </button>
          </div>
        </div>
      )}
      {!value ? (
        <AddSchema label={label} onAdd={() => onChange(EMPTY_OBJECT_SCHEMA)} extra={exampleButton} />
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <RawJson key={JSON.stringify(value)} label={label} value={value} onChange={onChange} rows={7} />
          <div className="w-32 text-[11px]">
            <span className="text-[10px] text-[#6e7681]">Fields</span>
            {props ? (
              <ul className="mt-0.5 space-y-0.5">
                {Object.entries(props).map(([k, p]) => (
                  <li key={k} className="font-mono truncate" title={JSON.stringify(p)}>
                    {k}
                    {req.includes(k) && <span className="text-[#ff7b72]">*</span>}{" "}
                    <span className="text-[#6e7681]">{p && typeof p === "object" && !Array.isArray(p) ? String(p.type ?? "any") : "any"}</span>
                  </li>
                ))}
                {Object.keys(props).length === 0 && <li className="text-[#6e7681]">none yet</li>}
              </ul>
            ) : (
              <p className="text-[#6e7681]">not an object schema</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
