// The graph workflow form (#459): a graph workflow opens full width in the work area, with a
// picker each for its contract, its graph and one of that graph's graph bindings, and the grant
// set it carries, which is its contract's bindings file's grants, shown read-only. Each picker
// also takes an id no record has yet, and flags it. The backend checks the record's shape, and
// its local checks against the saved records it names: each exists and is valid, the contract's
// bindings file lists the graph, and the binding binds that graph. Each issue shows on the field
// that names the record at fault. A Triggers section lists the triggers that start the graph
// workflow, read from their saved target files (#479). Nothing here calls a Praxis host.
import { useEffect, type FC, type ReactNode } from "react";
import { Info } from "lucide-react";
import type { Draft } from "./drafts.ts";
import type { GraphWorkflowEdit } from "./graphWorkflow.ts";
import { asString, hintClass, IdPicker, issuesByPath, Section, Summary } from "./RecordFields.tsx";
import { useGraphWorkflowCheck } from "./useGraphWorkflowCheck.ts";
import { useGraphWorkflowTriggers, type GraphWorkflowTriggersStatus } from "./useGraphWorkflowTriggers.ts";
import { useValidation } from "./useValidation.ts";
import type { DefinitionRef, ValidationStatus } from "./types.ts";

interface GraphWorkflowFormProps {
  projectPath: string;
  draft: Draft;
  /** The ids of the project's contracts and graphs, listed or drafted, for the pickers. */
  contracts: readonly string[];
  graphs: readonly string[];
  /** The project's graph bindings, listed or drafted, each with the graph it binds when it names one. */
  graphBindings: readonly { id: string; graphId?: string }[];
  /** Counts up when the builder saves, renames or deletes a record, so the local checks run again. */
  refresh: number;
  /**
   * A trigger's host state badge, shown next to its id in the Triggers section (#479). Quay has no
   * graph trigger host state yet (#475), so the builder passes none and only the id shows.
   */
  triggerBadge?: (triggerId: string) => ReactNode;
  onEdit: (edit: GraphWorkflowEdit) => void;
  onOpen: (ref: DefinitionRef) => void;
  onValidated: (verdict: string | null) => void;
}

/**
 * The shape check and the local checks as one status: done once both have a result, with the
 * shape's issues first. The verdict is the shape's, else the first local check's error, and is
 * null only when both pass. While a newer local check runs, the last one's issues stay shown.
 */
function combined(shape: ValidationStatus, check: ReturnType<typeof useGraphWorkflowCheck>): { status: ValidationStatus; settled: boolean } {
  if (shape.state !== "done") return { status: shape, settled: false };
  if (check.state === "checking") return { status: check, settled: false };
  if (check.state === "failed") return { status: { state: "failed", error: check.error }, settled: true };
  const { validation } = shape;
  const local = check.check.diagnostics;
  const verdict = validation.verdict ?? local.find((d) => d.severity === "error")?.code ?? null;
  return {
    status: { state: "done", validation: { ...validation, verdict, diagnostics: [...validation.diagnostics, ...local] } },
    settled: !check.pending,
  };
}

export const GraphWorkflowForm: FC<GraphWorkflowFormProps> = ({
  projectPath,
  draft,
  contracts,
  graphs,
  graphBindings,
  refresh,
  triggerBadge,
  onEdit,
  onOpen,
  onValidated,
}) => {
  const shape = useValidation("graph-workflows", draft.content);
  const check = useGraphWorkflowCheck(projectPath, draft.content, refresh);
  const triggers = useGraphWorkflowTriggers(projectPath, draft.ref.id, refresh);
  const { status, settled } = combined(shape, check);
  const verdict = settled && status.state === "done" ? status.validation.verdict : undefined;
  useEffect(() => {
    if (verdict !== undefined) onValidated(verdict);
  }, [verdict, onValidated]);

  // Each picker takes the issues at its path; whatever no picker takes shows with the summary.
  const byPath = issuesByPath(status);
  const taken = new Set<string>();
  const at = (path: string) => {
    taken.add(path);
    return byPath.get(path);
  };

  const w = draft.content;
  const contractId = asString(w.contractId);
  const graphId = asString(w.graphId);
  const set = (key: string, value: string) => onEdit({ type: "set-field", key, value, live: true });
  const bindingsOfGraph = [...new Set(graphBindings.filter((b) => b.graphId === graphId).map((b) => b.id))];
  const grants = check.state === "done" ? check.check.grants : null;
  // A contract that isn't saved has no bindings file, so the grant set says why it is empty.
  const contractMissing = check.state === "done" && check.check.diagnostics.some((d) => d.path === "/contractId" && d.code === "NOT_FOUND");

  const fields = (
    <>
      <Section title="What runs">
        <IdPicker
          label="Contract"
          noun="contract"
          value={contractId}
          known={contracts}
          issues={at("/contractId")}
          openAs="contracts"
          onChange={(v) => set("contractId", v)}
          onOpen={onOpen}
          hint="The contract the graph runs under. Its bindings file must list the graph."
        />
        <IdPicker
          label="Graph"
          noun="graph"
          value={graphId}
          known={graphs}
          issues={at("/graphId")}
          openAs="graphs"
          onChange={(v) => set("graphId", v)}
          onOpen={onOpen}
          hint="The graph that runs."
        />
        <IdPicker
          label="Graph binding"
          noun="graph binding"
          value={asString(w.graphBindingId)}
          known={graphBindings.map((b) => b.id)}
          offered={bindingsOfGraph}
          issues={at("/graphBindingId")}
          onChange={(v) => set("graphBindingId", v)}
          onOpen={onOpen}
          hint={graphId ? `How each node of ${graphId} runs. Only that graph's bindings are offered.` : "Pick a graph first to see its bindings."}
        />
      </Section>
      <GrantSet contractId={contractId} grants={grants} missing={contractMissing} onOpen={onOpen} />
      <StartedBy triggers={triggers} badge={triggerBadge} onOpen={onOpen} />
    </>
  );
  const rest = [...byPath].filter(([path]) => !taken.has(path)).flatMap(([, issues]) => issues);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <form className="max-w-3xl mx-auto px-6 py-5 space-y-6" onSubmit={(e) => e.preventDefault()} aria-label={`Graph workflow ${draft.ref.id}`}>
        <header className="space-y-2">
          <h2 className="text-sm font-semibold text-[#c9d1d9]">
            Graph workflow
            <span className="ml-2 font-mono font-normal text-[#8b949e]">{draft.ref.id}</span>
          </h2>
          <p role="note" className="flex items-start gap-1.5 text-[11px] text-[#79c0ff]">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            <span>
              A graph workflow is what Quay will submit to a Praxis host: a contract, a graph and one of its bindings, with the
              contract&apos;s grants. Its name is its file name; rename it from the list.
            </span>
          </p>
        </header>
        <Summary
          noun="graph workflow"
          status={status}
          recordIssues={rest}
          accepts="The graph workflow passes its local checks against the saved records it names."
          refuses="The graph workflow fails its local checks"
        />
        {fields}
      </form>
    </div>
  );
};

/** The grant set the graph workflow carries: its contract's bindings file's grants, read-only. */
const GrantSet: FC<{
  contractId: string;
  grants: readonly string[] | null;
  /** No saved contract has `contractId`, so there is nothing to carry or link to. */
  missing: boolean;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ contractId, grants, missing, onOpen }) => {
  let body: ReactNode;
  if (contractId === "") body = <p className={hintClass}>Pick a contract: the grants are its bindings file&apos;s.</p>;
  else if (missing) body = <p className={hintClass}>No saved contract has the id {contractId}, so there are no grants to carry.</p>;
  else if (grants === null) body = <p className={hintClass}>Reading the grants…</p>;
  else if (grants.length === 0) body = <p className={hintClass}>Contract {contractId}&apos;s bindings file lists no grants.</p>;
  else
    body = (
      <ul className="space-y-1">
        {grants.map((g) => (
          <li key={g} className="font-mono text-xs text-[#c9d1d9]">
            {g}
          </li>
        ))}
      </ul>
    );
  return (
    <Section title="Grants">
      <p className={hintClass}>
        The grants this graph workflow carries are its contract&apos;s, from its bindings file. Change them on the contract.
      </p>
      {body}
      {contractId !== "" && !missing && (
        <button type="button" onClick={() => onOpen({ kind: "contracts", id: contractId })} className="text-xs text-[#58a6ff] hover:underline">
          Open contract {contractId}
        </button>
      )}
    </Section>
  );
};

/** The triggers that start this graph workflow (#479), each a link that opens its form. */
const StartedBy: FC<{
  triggers: GraphWorkflowTriggersStatus;
  badge?: (triggerId: string) => ReactNode;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ triggers, badge, onOpen }) => {
  let body: ReactNode;
  if (triggers.state === "loading") body = <p className={hintClass}>Looking for triggers…</p>;
  else if (triggers.state === "failed")
    body = (
      <p role="alert" className="text-xs text-[#ff7b72] break-words">
        {triggers.error}
      </p>
    );
  else
    body = (
      <>
        {triggers.found.ids.length === 0 ? (
          <p className={hintClass}>No saved trigger starts this graph workflow.</p>
        ) : (
          <TriggerLinks ids={triggers.found.ids} badge={badge} onOpen={onOpen} />
        )}
        {triggers.found.skipped.length > 0 && (
          <ul className="space-y-0.5">
            {/* Each line names a different file, so it is its own key. */}
            {triggers.found.skipped.map((line) => (
              <li key={line} className="text-[11px] text-[#e3b341] break-words">
                Skipped: {line}
              </li>
            ))}
          </ul>
        )}
        <p className={hintClass}>A trigger names the graph workflow it starts with its own Starts picker, so it is set from the trigger.</p>
      </>
    );
  return <Section title="Triggers">{body}</Section>;
};

/** The trigger ids as links that open each trigger's form, each with its host state badge when there is one. */
const TriggerLinks: FC<{
  ids: readonly string[];
  badge?: (triggerId: string) => ReactNode;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ ids, badge, onOpen }) => (
  <ul className="space-y-1">
    {ids.map((id) => (
      <li key={id} className="flex items-center gap-1.5">
        <a
          href={`#triggers/${encodeURIComponent(id)}`}
          onClick={(e) => {
            // The builder opens records itself; the href only makes this a link.
            e.preventDefault();
            onOpen({ kind: "triggers", id });
          }}
          className="text-xs font-mono text-[#58a6ff] hover:underline"
        >
          {id}
        </a>
        {badge?.(id)}
      </li>
    ))}
  </ul>
);
