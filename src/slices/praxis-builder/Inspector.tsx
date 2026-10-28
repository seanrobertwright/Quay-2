// The docked inspector beside the canvas (#226): the selected node's kind and a delete button,
// its id, its kind's config form, its `dependsOn`, its input and output schemas, and the graph's
// read-only revision. Each control shows the validation messages about it; the node's other
// messages head the panel. A dependency chip's name goes to that node, and the Add
// dependency combobox filters the graph's other nodes by id or kind (#248).
import { useId, useMemo, useRef, useState, type FC, type KeyboardEvent, type Ref } from "react";
import { Trash2, X } from "lucide-react";
import { CONFIG_FORMS, described, FieldMessages, inputClass, labelClass } from "./ConfigForms.tsx";
import { renameProblem, type GraphEdit } from "./editor.ts";
import { nodeIssuesBySlot } from "./issues.ts";
import { SchemaEditor } from "./SchemaEditor.tsx";
import { NODE_KINDS_REGISTRY, nodeKindMeta } from "./kinds.ts";
import { matchNodes } from "./keyboard.ts";
import { isNodeKind, type PraxisGraph, type PraxisNode } from "./model.ts";
import type { Diagnostic } from "./types.ts";

interface InspectorProps {
  rootRef: Ref<HTMLElement>;
  /** Changes each time a node is chosen, so the node's form starts afresh. */
  selectionKey: number;
  graph: PraxisGraph;
  /** The selected node, or null when none, or more than one, is. */
  node: PraxisNode | null;
  /** How many nodes are selected. */
  selectionCount: number;
  /** The graph's validation issues, or none while it is being checked. */
  diagnostics: readonly Diagnostic[];
  onEdit: (edit: GraphEdit) => void;
  /** Called with the node's new id after a rename. */
  onRenamed: (id: string) => void;
  /** Called after the node is deleted, once the inspector has moved focus off the button. */
  onDeleted: () => void;
  /** Selects another node, zooms to it and focuses its card, from a dependency chip. */
  onGoToNode: (nodeId: string) => void;
}

const sectionClass = "px-4 py-3 border-b border-[#21262d] space-y-2";
const headingClass = "text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]";

export const Inspector: FC<InspectorProps> = ({
  rootRef,
  selectionKey,
  graph,
  node,
  selectionCount,
  diagnostics,
  onEdit,
  onRenamed,
  onDeleted,
  onGoToNode,
}) => (
  <aside
    ref={rootRef}
    aria-label="Inspector"
    tabIndex={-1}
    className="w-72 shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-y-auto outline-none"
  >
    {node ? (
      <NodeInspector
        key={selectionKey}
        graph={graph}
        node={node}
        diagnostics={diagnostics}
        onEdit={onEdit}
        onRenamed={onRenamed}
        onDeleted={onDeleted}
        onGoToNode={onGoToNode}
      />
    ) : selectionCount > 1 ? (
      <div className="px-4 py-3 space-y-2 text-xs text-[#8b949e]">
        <p className="text-[#c9d1d9] font-medium">{selectionCount} nodes selected</p>
        <p>Select one node to edit it.</p>
      </div>
    ) : (
      <div className="px-4 py-3 space-y-2 text-xs text-[#8b949e]">
        <p className="text-[#c9d1d9] font-medium">No node selected</p>
        <p>Select a node to edit it, or add one from the palette on the canvas.</p>
      </div>
    )}
    <Revision revision={graph.revision} />
  </aside>
);

const Revision: FC<{ revision: string }> = ({ revision }) => (
  <dl className="px-4 py-3 text-[11px]">
    <dt className={headingClass}>Revision</dt>
    <dd className="mt-1 font-mono text-[#c9d1d9] break-all">{revision || "None yet"}</dd>
    <dd className="mt-1 text-[10px] text-[#6e7681]">Read-only. Saving sets it from the graph&apos;s content.</dd>
  </dl>
);

const NodeInspector: FC<Omit<InspectorProps, "rootRef" | "selectionKey" | "node" | "selectionCount"> & { node: PraxisNode }> = ({
  graph,
  node,
  diagnostics,
  onEdit,
  onRenamed,
  onDeleted,
  onGoToNode,
}) => {
  const generalId = useId();
  const meta = nodeKindMeta(node.kind);
  const entry = isNodeKind(node.kind) ? NODE_KINDS_REGISTRY[node.kind] : null;
  const known = entry !== null;
  const Form = isNodeKind(node.kind) ? CONFIG_FORMS[node.kind] : null;
  const slots = useMemo(
    () => ["id", "dependsOn", "inputSchema", "outputSchema", ...(entry?.configKeys.map((k) => `config.${k}`) ?? [])],
    [entry]
  );
  const issues = useMemo(() => nodeIssuesBySlot(diagnostics, node.id, slots), [diagnostics, node.id, slots]);
  const nodeIds = useMemo(() => graph.nodes.map((n) => n.id), [graph]);

  return (
    <div>
      <div className="px-4 py-3 border-b border-[#30363d] flex items-start gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          <meta.icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: meta.color }}>
            {known ? meta.label : `${meta.label}: ${node.kind || "none"}`}
          </p>
          <p className="text-[11px] text-[#8b949e]">
            {entry ? entry.blurb : "Not one of Praxis's node kinds."}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Delete ${node.id}`}
          title="Delete this node"
          onClick={() => {
            onEdit({ type: "delete-node", id: node.id });
            onDeleted();
          }}
          className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d] shrink-0"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {issues.has("") && (
        <div className="px-4 pt-2">
          <FieldMessages id={generalId} issues={issues.get("")} />
        </div>
      )}
      <div className={sectionClass}>
        <IdField
          node={node}
          nodeIds={nodeIds}
          issues={issues.get("id")}
          onRename={(to) => {
            onEdit({ type: "rename-node", from: node.id, to });
            onRenamed(to);
          }}
        />
      </div>
      <section aria-label="Config" className={sectionClass}>
        <h3 className={headingClass}>Config</h3>
        {Form ? (
          <Form node={node} graph={graph} issues={issues} onEdit={onEdit} />
        ) : (
          <p className="text-[11px] text-[#8b949e]">
            {known
              ? `A ${meta.label} node has no settings. Its config is always `
              : "Quay can't edit this node's config until its kind is one it knows. Its config is "}
            <code className="font-mono text-[#c9d1d9] break-all">{known ? "{}" : JSON.stringify(node.config)}</code>.
          </p>
        )}
      </section>
      <div className={sectionClass}>
        <Dependencies node={node} graph={graph} issues={issues.get("dependsOn")} onEdit={onEdit} onGoToNode={onGoToNode} />
      </div>
      <section aria-label="Schemas" className={`${sectionClass} !space-y-3`}>
        <h3 className={headingClass}>Schemas</h3>
        <SchemaEditor node={node} which="inputSchema" issues={issues.get("inputSchema")} onEdit={onEdit} />
        <SchemaEditor node={node} which="outputSchema" issues={issues.get("outputSchema")} onEdit={onEdit} />
      </section>
    </div>
  );
};

/**
 * The node's id. A rename is applied on Enter or when focus leaves, and only when the SDK
 * would take the new id; until then the reason shows under the field. Escape puts the id back.
 */
const IdField: FC<{
  node: PraxisNode;
  nodeIds: readonly string[];
  issues: readonly Diagnostic[] | undefined;
  onRename: (to: string) => void;
}> = ({ node, nodeIds, issues, onRename }) => {
  const id = useId();
  const messagesId = useId();
  const hintId = useId();
  const [text, setText] = useState(node.id);
  // Another node selected, or this one renamed, replaces what is typed.
  const [synced, setSynced] = useState(node.id);
  if (synced !== node.id) {
    setSynced(node.id);
    setText(node.id);
  }
  const problem = text === node.id ? null : renameProblem(nodeIds, node.id, text);
  const commit = () => {
    if (text !== node.id && problem === null) onRename(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape" && text !== node.id) {
      // Handled here, so the builder doesn't close.
      e.preventDefault();
      setText(node.id);
    }
  };
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Id
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
        aria-invalid={problem !== null || issues?.some((d) => d.severity === "error") || undefined}
      />
      <p id={hintId} className={`mt-1 text-[10px] ${problem ? "text-[#ff7b72]" : "text-[#6e7681]"}`}>
        {problem ?? "Renaming also updates dependsOn, decision targets and the layout."}
      </p>
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

/**
 * The node's `dependsOn` as chips, each naming a node to go to and with a button to remove
 * it, and a combobox to add one. Any other node can be added, so a cycle can be made; the
 * Problems list reports it.
 */
const Dependencies: FC<{
  node: PraxisNode;
  graph: PraxisGraph;
  issues: readonly Diagnostic[] | undefined;
  onEdit: (edit: GraphEdit) => void;
  onGoToNode: (nodeId: string) => void;
}> = ({ node, graph, issues, onEdit, onGoToNode }) => {
  const headingId = useId();
  const messagesId = useId();
  const addRef = useRef<HTMLInputElement | null>(null);
  const listed = new Set(node.dependsOn);
  const known = new Set(graph.nodes.map((n) => n.id));
  const options = graph.nodes.filter((n) => n.id !== node.id && !listed.has(n.id));
  // A hand-edited file may list an id twice; each copy gets its own chip and key.
  const seen = new Map<string, number>();
  const chips = node.dependsOn.map((dep) => {
    const n = seen.get(dep) ?? 0;
    seen.set(dep, n + 1);
    return { dep, key: `${dep}|${n}` };
  });
  const remove = (dep: string) => {
    onEdit({ type: "disconnect", source: dep, target: node.id });
    // The chip's button is gone, so focus goes to the picker, which now offers `dep`.
    requestAnimationFrame(() => addRef.current?.focus());
  };
  return (
    <div>
      <h3 id={headingId} className={labelClass}>
        Depends on
      </h3>
      {chips.length === 0 ? (
        <p className="text-[11px] text-[#6e7681]">Nothing, so this node can start first.</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-wrap gap-1" {...described(messagesId, issues)}>
          {chips.map(({ dep, key }) => (
            <li
              key={key}
              className={`inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-0.5 rounded-full border text-[11px] font-mono ${
                known.has(dep) ? "bg-[#21262d] border-[#30363d]" : "bg-[#da3633]/10 border-[#f85149]/60 text-[#ff7b72]"
              }`}
            >
              {known.has(dep) ? (
                <button
                  type="button"
                  title={`Go to ${dep}`}
                  className="truncate rounded hover:underline focus-visible:outline-1 focus-visible:outline-[#58a6ff]"
                  onClick={() => onGoToNode(dep)}
                >
                  {dep}
                </button>
              ) : (
                <span className="truncate" title={`${dep} isn't a node in this graph`}>
                  {dep}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove the dependency on ${dep}`}
                className="p-0.5 rounded-full hover:bg-[#30363d] shrink-0"
                onClick={() => remove(dep)}
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <DependencyPicker
          inputRef={addRef}
          options={options}
          onAdd={(dep) => onEdit({ type: "connect", source: dep, target: node.id })}
        />
      )}
      <FieldMessages id={messagesId} issues={issues} />
    </div>
  );
};

/**
 * The Add dependency combobox, following the WAI-ARIA combobox pattern with a list popup:
 * a click or typing opens the list, typing filters the nodes by id or kind, the arrow keys
 * move through them, Enter or a click adds one, and Escape closes the list. Nothing is added until a node is chosen, unlike a
 * native select, which changes on an arrow key.
 */
const DependencyPicker: FC<{
  inputRef: Ref<HTMLInputElement>;
  options: readonly PraxisNode[];
  onAdd: (nodeId: string) => void;
}> = ({ inputRef, options, onAdd }) => {
  const inputId = useId();
  const listId = useId();
  const optionId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { matches, more } = matchNodes(options, text);
  const expanded = open && matches.length > 0;
  const current = expanded ? Math.min(active, matches.length - 1) : -1;
  const choose = (nodeId: string) => {
    onAdd(nodeId);
    setText("");
    setOpen(false);
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!expanded) {
          setOpen(true);
          setActive(e.key === "ArrowDown" ? 0 : matches.length - 1);
        } else {
          setActive((current + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        }
        return;
      }
      case "Enter":
        if (current >= 0) {
          e.preventDefault();
          choose(matches[current].id);
        }
        return;
      case "Escape":
        // Handled here while the list is open, so the builder leaves the field alone.
        if (open || text !== "") {
          e.preventDefault();
          setOpen(false);
          setText("");
        }
        return;
    }
  };
  return (
    <div className="relative mt-1.5">
      <label htmlFor={inputId} className="sr-only">
        Add dependency
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        spellCheck={false}
        autoComplete="off"
        placeholder="Add dependency…"
        className={inputClass}
        value={text}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={current >= 0 ? `${optionId}-${current}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Nodes to depend on"
          className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-[#30363d] bg-[#161b22] py-1 shadow-lg text-[11px]"
        >
          {matches.map((n, i) => (
            // The input keeps focus and its keys, as the combobox pattern has it.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={n.id}
              id={`${optionId}-${i}`}
              role="option"
              aria-selected={i === current}
              // Keep focus in the input, so its blur doesn't close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(n.id)}
              className={`px-2 py-1 flex gap-2 cursor-pointer ${i === current ? "bg-[#1f6feb]/30 text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"}`}
            >
              <span className="font-mono truncate">{n.id}</span>
              <span className="ml-auto text-[#6e7681] shrink-0">{n.kind}</span>
            </li>
          ))}
        </ul>
      )}
      {expanded && more && (
        <p className="mt-1 text-[10px] text-[#6e7681]">Showing the first {matches.length} nodes. Type to narrow them.</p>
      )}
      {open && matches.length === 0 && (
        <p className="mt-1 text-[10px] text-[#6e7681]">No other node matches &ldquo;{text.trim()}&rdquo;.</p>
      )}
    </div>
  );
};
