// The graph run confirm dialog (#444, #466). It says that the host runs its admitted revision of
// the graph workflow, not the files in the project, names that revision and its review digest,
// and says the run waits for approval in the browser. Opening it asks the graph host model for
// one fresh `graphs show`, which also refreshes the graph workflow's host state everywhere it is
// shown, and reads which of the bundle's files aren't committed; Start run waits for both. It
// warns when the saved files differ from the admitted revision, and about unsaved or uncommitted
// edits to the bundle's files, which never stop a run. It draws in the shared `RunConfirmFrame`.
import { useEffect, useRef, type FC, type RefObject } from "react";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import { graphConfirmRefusedBy, graphRunWarnings } from "./graphRunStart.ts";
import { RunConfirmFrame } from "./RunConfirmFrame.tsx";
import type { DefinitionRef } from "./types.ts";
import { useRecordChanges } from "./useRecordChanges.ts";

export const GraphRunConfirm: FC<{
  projectPath: string;
  name: string;
  host: GraphWorkflowHost | null;
  /** The bundle's records whose drafts have edits their saved files don't. */
  unsaved: readonly DefinitionRef[];
  onRun: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the Runs header's Run. */
  returnFocus: RefObject<HTMLElement | null>;
}> = ({ projectPath, name, host, unsaved, onRun, onClose, returnFocus }) => {
  const checkAgainRef = useRef(host?.onCheckAgain);
  checkAgainRef.current = host?.onCheckAgain;
  // One fresh `graphs show` and one git status read per opening.
  useEffect(() => {
    checkAgainRef.current?.();
  }, [projectPath, name]);
  const changes = useRecordChanges("praxis_graph_workflow_changes", projectPath, name);

  const view = host?.view ?? null;
  const checking = (view?.checking ?? false) || changes === null;
  const refusal = checking
    ? null
    : view && host
      ? graphConfirmRefusedBy(name, view, host.condition)
      : `Quay can't tell which revision of ${name} would run.`;
  const warnings = checking || !view ? [] : graphRunWarnings(view, unsaved, changes);
  const current = checking ? null : (view?.current ?? null);

  return (
    <RunConfirmFrame
      name={name}
      withheld={checking || refusal !== null}
      refusal={refusal}
      warnings={warnings}
      onRun={onRun}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <p className="text-xs">
        The host runs its admitted revision of <span className="font-mono">{name}</span>, not the files in this project.
      </p>
      <section aria-label="The admitted revision" className="text-xs space-y-1">
        {checking ? (
          <p role="status">Checking the host&apos;s admitted revision…</p>
        ) : current ? (
          <p className="break-all">
            Admitted revision <span className="font-mono">{current.revision}</span>, review digest{" "}
            <span className="font-mono">{view?.reviewDigest ?? "not given by the host"}</span>
          </p>
        ) : (
          <p>Quay doesn&apos;t know which revision the host has admitted.</p>
        )}
      </section>
      <p className="text-xs">The run waits for approval in the browser before it does anything.</p>
    </RunConfirmFrame>
  );
};
