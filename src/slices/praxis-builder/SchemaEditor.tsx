// A node's `inputSchema` or `outputSchema` in the inspector (#226's variant B, #260): a field
// table of name, type and required for a flat object schema, and a raw JSON view beside it.
// A schema the table can't show opens as JSON, and JSON that doesn't parse keeps the raw view.
import { useId, useRef, useState, type FC, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { FieldMessages, inputClass, labelClass } from "./ConfigForms.tsx";
import type { GraphEdit, SchemaSlot } from "./editor.ts";
import type { JsonObject, PraxisNode } from "./model.ts";
import { FIELD_TYPES, fieldsProblem, isFieldType, parseSchema, schemaFields, withFields, type SchemaField } from "./schemas.ts";
import type { Diagnostic } from "./types.ts";

const hintClass = "mt-1 text-[10px] text-[#6e7681]";
const errorClass = "mt-1 text-[10px] text-[#ff7b72]";

const EMPTY_SCHEMA: JsonObject = { type: "object", properties: {} };

/** A table row: a field, and a key that stays the same while its name is typed. */
type Row = SchemaField & { key: number };
interface Rows {
  rows: Row[];
  nextKey: number;
}

const keyed = (fields: readonly SchemaField[], from: number): Rows => ({
  rows: fields.map((f, i) => ({ ...f, key: from + i })),
  nextKey: from + fields.length,
});

const asText = (schema: JsonObject | undefined) => (schema === undefined ? "" : JSON.stringify(schema, null, 2));

export const SchemaEditor: FC<{
  node: PraxisNode;
  which: SchemaSlot;
  issues: readonly Diagnostic[] | undefined;
  onEdit: (edit: GraphEdit) => void;
}> = ({ node, which, issues, onEdit }) => {
  const headingId = useId();
  const messagesId = useId();
  const blockedId = useId();
  const label = which === "inputSchema" ? "Input schema" : "Output schema";
  const schema = node[which];
  const applied = asText(schema);
  const fields = schema === undefined ? [] : schemaFields(schema);

  const [table, setTable] = useState<Rows>(() => keyed(fields ?? [], 0));
  const [raw, setRaw] = useState(fields === null);
  const [text, setText] = useState(applied);
  // A change from outside (another node's rename, a reload) replaces the table and the text.
  const [synced, setSynced] = useState(applied);
  if (synced !== applied) {
    setSynced(applied);
    setText(applied);
    setTable(keyed(fields ?? [], table.nextKey));
    if (fields === null) setRaw(true);
  }

  const apply = (next: JsonObject | null) => {
    // Recorded first, so the edit coming back isn't taken for a change from outside.
    const nextText = next === null ? "" : asText(next);
    setSynced(nextText);
    setText(nextText);
    onEdit({ type: "set-schema", id: node.id, which, schema: next });
  };

  const parsed = raw && text !== applied ? parseSchema(text) : null;
  const textProblem = parsed && !parsed.ok ? parsed.message : null;
  // The schema the table would open with: what is typed, once it parses.
  const pending = parsed?.ok ? parsed.value : schema;
  const pendingFields = pending === undefined ? [] : schemaFields(pending);
  const tableBlocked =
    textProblem !== null
      ? "Fix the JSON to switch to the table."
      : pendingFields === null
        ? "The table can't show this schema, so it opens as JSON."
        : null;

  const commitText = () => {
    if (parsed?.ok) apply(parsed.value);
  };
  const toggle = () => {
    if (!raw) {
      setText(applied);
      setRaw(true);
    } else if (tableBlocked === null) {
      commitText();
      setTable(keyed(pendingFields ?? [], table.nextKey));
      setRaw(false);
    }
  };

  return (
    <section aria-labelledby={headingId} aria-describedby={issues?.length ? messagesId : undefined}>
      <div className="flex items-center gap-2 mb-1">
        <h4 id={headingId} className={`${labelClass} mb-0`}>
          {label}
        </h4>
        {schema !== undefined && (
          <>
            <button
              type="button"
              aria-pressed={raw}
              aria-disabled={raw && tableBlocked !== null ? true : undefined}
              aria-describedby={raw && tableBlocked !== null ? blockedId : undefined}
              onClick={toggle}
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-[#30363d] text-[#8b949e] hover:text-white aria-pressed:bg-[#1f6feb]/25 aria-pressed:border-[#58a6ff] aria-pressed:text-white aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            >
              Raw JSON<span className="sr-only"> for the {label.toLowerCase()}</span>
            </button>
            <button
              type="button"
              aria-label={`Remove the ${label.toLowerCase()}`}
              title={`Remove the ${label.toLowerCase()}`}
              onClick={() => apply(null)}
              className="p-0.5 rounded text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d]"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {schema === undefined ? (
        <button
          type="button"
          onClick={() => {
            setTable({ rows: [], nextKey: table.nextKey });
            setRaw(false);
            apply(EMPTY_SCHEMA);
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-[#30363d] text-[11px] text-[#8b949e] hover:text-white hover:border-[#58a6ff]"
        >
          <Plus className="w-3 h-3" aria-hidden="true" /> Add {label.toLowerCase()}
        </button>
      ) : raw ? (
        <RawSchema
          label={label}
          text={text}
          problem={textProblem}
          blocked={tableBlocked === null ? null : { id: blockedId, text: tableBlocked }}
          onChange={setText}
          onCommit={commitText}
          onRevert={() => setText(applied)}
        />
      ) : (
        <FieldTable
          label={label}
          table={table}
          onChange={(next) => {
            setTable(next);
            if (fieldsProblem(next.rows) === null) apply(withFields(schema, next.rows.map(({ key: _, ...f }) => f)));
          }}
        />
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </section>
  );
};

/**
 * The schema as JSON. It is applied when focus leaves, and only when it parses to an object;
 * until then the reason shows under it. Escape puts back the schema applied last.
 */
const RawSchema: FC<{
  label: string;
  text: string;
  problem: string | null;
  blocked: { id: string; text: string } | null;
  onChange: (text: string) => void;
  onCommit: () => void;
  onRevert: () => void;
}> = ({ label, text, problem, blocked, onChange, onCommit, onRevert }) => {
  const id = useId();
  const hintId = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      // Handled here, so the builder doesn't close.
      e.preventDefault();
      onRevert();
    }
  };
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label} as JSON
      </label>
      <textarea
        id={id}
        rows={8}
        spellCheck={false}
        className={`${inputClass} font-mono text-[11px] leading-snug resize-y`}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
        aria-describedby={[hintId, blocked?.id].filter(Boolean).join(" ")}
        aria-invalid={problem !== null || undefined}
      />
      <p id={hintId} className={problem ? errorClass : hintClass}>
        {problem ? `Not applied. ${problem}` : "Applied when you leave the field. Escape puts it back."}
      </p>
      {blocked && (
        <p id={blocked.id} className="mt-1 text-[10px] text-[#e3b341]">
          {blocked.text}
        </p>
      )}
    </div>
  );
};

/** One row per property: its name, its type, and whether it is required. */
const FieldTable: FC<{
  label: string;
  table: Rows;
  onChange: (next: Rows) => void;
}> = ({ label, table, onChange }) => {
  const problemId = useId();
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);
  const { rows, nextKey } = table;
  const problem = fieldsProblem(rows);
  const name = label.toLowerCase();
  const setRow = (key: number, change: Partial<SchemaField>) =>
    onChange({ rows: rows.map((r) => (r.key === key ? { ...r, ...change } : r)), nextKey });
  const add = () => {
    onChange({ rows: [...rows, { key: nextKey, name: "", type: "string", required: false, keywords: {} }], nextKey: nextKey + 1 });
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLInputElement>("tr:last-child input[type=text]")?.focus());
  };
  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-[#6e7681]">No fields yet.</p>
      ) : (
        <table className="w-full text-[11px]" aria-describedby={problem ? problemId : undefined}>
          <caption className="sr-only">{label} fields</caption>
          <thead>
            <tr className="text-left text-[#6e7681]">
              <th scope="col" className="font-medium pb-1">
                Name
              </th>
              <th scope="col" className="font-medium pb-1">
                Type
              </th>
              <th scope="col" className="font-medium pb-1 text-center">
                Required
              </th>
              <th scope="col" className="pb-1">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map((r, i) => {
              const field = r.name || `field ${i + 1}`;
              const extra = Object.keys(r.keywords).filter((k) => k !== "type").length;
              return (
                <tr key={r.key}>
                  <td className="pr-1 py-0.5">
                    <input
                      type="text"
                      spellCheck={false}
                      aria-label={`${label} field ${i + 1} name`}
                      className={`${inputClass} font-mono`}
                      value={r.name}
                      onChange={(e) => setRow(r.key, { name: e.target.value })}
                      aria-invalid={problem !== null && (r.name === "" || rows.some((o) => o !== r && o.name === r.name)) ? true : undefined}
                    />
                  </td>
                  <td className="pr-1 py-0.5">
                    <select
                      aria-label={`${label} ${field} type`}
                      className={inputClass}
                      value={r.type}
                      onChange={(e) => {
                        const type = e.target.value;
                        if (isFieldType(type)) setRow(r.key, { type });
                      }}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {extra > 0 && (
                      <span className="block text-[9px] text-[#6e7681]" title={JSON.stringify(r.keywords)}>
                        +{extra} more {extra === 1 ? "keyword" : "keywords"}, kept
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${label} ${field} required`}
                      checked={r.required}
                      onChange={(e) => setRow(r.key, { required: e.target.checked })}
                    />
                  </td>
                  <td className="py-0.5">
                    <button
                      type="button"
                      aria-label={`Remove ${field} from the ${name}`}
                      onClick={() => onChange({ rows: rows.filter((o) => o.key !== r.key), nextKey })}
                      className="p-0.5 rounded text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d]"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {problem && (
        <p id={problemId} className={errorClass}>
          {problem} The table isn&apos;t applied until that is fixed.
        </p>
      )}
      <button
        type="button"
        onClick={add}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#58a6ff] hover:underline"
      >
        <Plus className="w-3 h-3" aria-hidden="true" /> Add a field<span className="sr-only"> to the {name}</span>
      </button>
    </div>
  );
};
