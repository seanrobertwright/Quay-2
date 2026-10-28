// The canvas toolbar's graph binding controls (#247, #273): the Binding picker, which offers
// None, each of the graph's bindings and + New binding…, and for the binding chosen its Stale
// badge, Retarget to current graph, Duplicate binding and its own Save. The choice is the
// session's, per graph; the binding's edits go through the graph's undo history.
import { useId, useState, type FC } from "react";
import { Copy, Save, TriangleAlert } from "lucide-react";
import { inputBaseClass, labelClass } from "./ConfigForms.tsx";
import type { BindingStatus, RetargetPlan } from "./graphBinding.ts";

/** A binding the picker offers. */
export interface PickerBinding {
  id: string;
  dirty: boolean;
  /** Never saved, so it has no file yet. */
  unsaved: boolean;
}

/** The value of the picker's + New binding… option, which no binding id can be (ids can't start with a dot). */
const NEW_BINDING = ".new";

const buttonClass =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[11px] font-semibold aria-disabled:opacity-50";

export const BindingBar: FC<{
  graphId: string;
  bindings: readonly PickerBinding[];
  chosen: string | null;
  /** How the chosen binding stands against the graph on disk, or null while that is read. */
  status: BindingStatus | null;
  /** What Retarget to current graph would do to the chosen binding, or why it can't run now. */
  retarget: { plan: RetargetPlan } | { blocked: string } | null;
  saving: boolean;
  onChoose: (bindingId: string | null) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onSave: () => void;
  onRetarget: () => void;
}> = ({ graphId, bindings, chosen, status, retarget, saving, onChoose, onNew, onDuplicate, onSave, onRetarget }) => {
  const pickerId = useId();
  const confirmTitleId = useId();
  const confirmId = useId();
  const [confirming, setConfirming] = useState(false);
  const current = bindings.find((b) => b.id === chosen) ?? null;
  // A confirmation belongs to the binding it was asked about.
  const [confirmingFor, setConfirmingFor] = useState(chosen);
  if (confirmingFor !== chosen) {
    setConfirmingFor(chosen);
    setConfirming(false);
  }
  return (
    <div className="shrink-0 border-b border-[#30363d] bg-[#161b22]">
      <div className="px-4 py-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <label htmlFor={pickerId} className={`${labelClass} !mb-0`}>
          Binding
        </label>
        <select
          id={pickerId}
          value={current ? current.id : ""}
          onChange={(e) => {
            if (e.target.value === NEW_BINDING) onNew();
            else onChoose(e.target.value === "" ? null : e.target.value);
          }}
          className={`${inputBaseClass} w-56 font-mono text-[#c9d1d9]`}
        >
          <option value="">None</option>
          {bindings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id}
              {b.dirty ? " *" : ""}
            </option>
          ))}
          <option value={NEW_BINDING}>+ New binding…</option>
        </select>
        {current && (
          <>
            {current.dirty && (
              <span className="text-[#e3b341]">{current.unsaved ? "never saved" : "unsaved changes"}</span>
            )}
            {status === "stale" && (
              <span className="inline-flex items-center gap-1 px-1.5 rounded-full bg-[#9e6a03]/30 border border-[#d29922] text-[#e3b341] font-semibold">
                <TriangleAlert className="w-3 h-3" aria-hidden="true" />
                Stale
              </span>
            )}
            {status === "graph-unsaved" && <span className="text-[#8b949e]">Save the graph to pin this binding to it.</span>}
            {status === "unpinned" && <span className="text-[#8b949e]">Saving pins it to {graphId} as saved.</span>}
            <span className="ml-auto flex items-center gap-1.5">
              {status === "stale" && (
                <button
                  type="button"
                  className={buttonClass}
                  aria-expanded={confirming}
                  aria-controls={confirming ? confirmId : undefined}
                  onClick={() => setConfirming((v) => !v)}
                >
                  Retarget to current graph
                </button>
              )}
              <button type="button" className={buttonClass} onClick={onDuplicate}>
                <Copy className="w-3 h-3" aria-hidden="true" />
                Duplicate binding
              </button>
              <button
                type="button"
                className={`${buttonClass} !bg-[#238636] hover:!bg-[#2ea043] text-white`}
                aria-disabled={saving}
                onClick={() => {
                  if (!saving) onSave();
                }}
              >
                <Save className="w-3 h-3" aria-hidden="true" />
                {saving ? "Saving…" : "Save binding"}
              </button>
            </span>
          </>
        )}
      </div>
      {current && status === "stale" && (
        <p role="status" className="px-4 pb-1.5 text-[11px] text-[#e3b341]">
          {graphId} has changed on disk since {current.id} was pinned to it. Praxis refuses a binding whose graph
          digest doesn&apos;t match.
        </p>
      )}
      {current && confirming && retarget && (
        <section id={confirmId} aria-labelledby={confirmTitleId} className="mx-4 mb-2 p-2 rounded-md border border-[#30363d] bg-[#0d1117] space-y-1.5 text-[11px]">
          <h4 id={confirmTitleId} className="font-semibold text-white">
            Retarget {current.id} to {graphId} as saved?
          </h4>
          {"blocked" in retarget ? (
            <p className="text-[#ff7b72]">{retarget.blocked}</p>
          ) : (
            <>
              {retarget.plan.drop.length > 0 ? (
                <>
                  <p className="text-[#c9d1d9]">These entries are dropped:</p>
                  <ul className="list-disc pl-5 text-[#c9d1d9]">
                    {retarget.plan.drop.map((d) => (
                      <li key={d.id}>
                        <span className="font-mono">{d.id}</span>: {d.reason}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[#c9d1d9]">No entries are dropped.</p>
              )}
              {retarget.plan.unbound.length > 0 && (
                <p className="text-[#c9d1d9]">
                  These nodes stay unbound until you add their entries:{" "}
                  <span className="font-mono">{retarget.plan.unbound.join(", ")}</span>
                </p>
              )}
              <p className="text-[#8b949e]">It is one step you can undo, and the binding stays unsaved until you save it.</p>
            </>
          )}
          <div className="flex gap-2">
            {!("blocked" in retarget) && (
              <button
                type="button"
                className={`${buttonClass} !bg-[#da3633] hover:!bg-[#f85149] text-white`}
                onClick={() => {
                  setConfirming(false);
                  onRetarget();
                }}
              >
                Retarget
              </button>
            )}
            <button type="button" className={buttonClass} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
