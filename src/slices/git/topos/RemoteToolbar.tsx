import React, { useId } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, GitBranchPlus, Loader2, RefreshCw, SquareTerminal, X } from "lucide-react";
import { STALL_NOTICE, syncView, toolbarLabel, type NetworkKind, type NextAction } from "./remoteOps";
import type { RemoteOps } from "./useRemoteOps";

const BUTTON =
  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#30363d] text-xs text-[#c9d1d9] hover:bg-[#21262d] hover:text-white aria-disabled:opacity-50 aria-disabled:cursor-default aria-disabled:hover:bg-transparent";

const ACTION_LABEL: Record<Exclude<NextAction, "pushSetUpstream">, string> = {
  pull: "Pull",
  forcePushWithLease: "Force push (with lease)…",
  fetch: "Fetch",
  retry: "Retry",
  runInTerminal: "Run in terminal",
};

/**
 * Topos's toolbar (#367, #395): Fetch, Pull, Push and New branch for the selected worktree's
 * branch, its ahead and behind counts as of the last fetch, the running operation's progress, a
 * stall notice once git goes quiet, and the output panel a refusal opens. Everything git or the
 * remote printed shows as text, never HTML.
 */
export const RemoteToolbar: React.FC<{ remote: RemoteOps; onNewBranch: () => void }> = ({ remote, onNewBranch }) => {
  const panelId = useId();
  const { sync, running, failure } = remote;
  const counts = sync === null ? null : syncView(sync);
  const button = (kind: NetworkKind, label: string, icon: React.ReactNode, onClick: () => void) => {
    const busy = running !== null;
    const mine = running?.kind === kind;
    return (
      <button
        type="button"
        aria-disabled={busy}
        onClick={() => {
          if (!busy) onClick();
        }}
        className={BUTTON}
        title={busy && !mine ? "Wait for the running operation, or cancel it" : undefined}
      >
        {mine ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : icon}
        {mine ? toolbarLabel(running) : label}
      </button>
    );
  };

  return (
    <div className="shrink-0 border-b border-[#30363d] bg-[#0d1117]">
      <div role="toolbar" aria-label="Sync" className="px-4 py-1.5 flex items-center gap-2 flex-wrap">
        {button("fetch", "Fetch", <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />, remote.fetch)}
        {button("pull", "Pull", <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden="true" />, remote.pull)}
        {button("push", "Push", <ArrowUpFromLine className="w-3.5 h-3.5" aria-hidden="true" />, remote.push)}
        <button type="button" onClick={onNewBranch} className={BUTTON}>
          <GitBranchPlus className="w-3.5 h-3.5" aria-hidden="true" />
          New branch
        </button>
        {counts !== null && (
          <span className="text-xs text-[#8b949e] font-mono" title={counts.title}>
            {counts.label ?? sync?.branch ?? "detached"}
            <span className="sr-only">. {counts.title}</span>
          </span>
        )}
        {running !== null && (
          <button type="button" onClick={remote.cancel} className={`${BUTTON} ml-auto`}>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
      {running?.stalled && (
        <div role="status" className="px-4 py-1.5 flex items-center gap-2 text-xs text-[#d29922] bg-[#d29922]/10 border-t border-[#d29922]/30">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{STALL_NOTICE}</span>
          <button type="button" onClick={remote.runInTerminal} className={`${BUTTON} ml-auto`}>
            <SquareTerminal className="w-3.5 h-3.5" aria-hidden="true" />
            Run in terminal
          </button>
          <button type="button" onClick={remote.cancel} className={BUTTON}>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Cancel
          </button>
        </div>
      )}
      {failure !== null && (
        <section aria-labelledby={panelId} className="border-t border-[#f85149]/40 bg-[#f85149]/5 px-4 py-2 flex flex-col gap-1.5 max-h-72 overflow-auto">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#f85149]" aria-hidden="true" />
            <h3 id={panelId} role="alert" className="text-xs font-semibold text-[#ff7b72] break-words min-w-0 flex-1">
              {failure.view.title}
            </h3>
            <button type="button" onClick={remote.closeFailure} aria-label="Close the output" className="p-0.5 rounded text-[#8b949e] hover:text-white">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {failure.view.lines.length > 0 && (
            <pre className="text-xs font-mono text-[#c9d1d9] whitespace-pre-wrap break-words bg-[#161b22] rounded p-2">
              {failure.view.lines.join("\n")}
            </pre>
          )}
          {failure.view.actions.length > 0 && (
            <div className="flex items-center gap-2">
              {failure.view.actions.map((action) => (
                <button key={action} type="button" onClick={() => remote.act(action)} className={BUTTON}>
                  {action === "pushSetUpstream" ? (failure.view.setUpstreamLabel ?? "Push and set upstream") : ACTION_LABEL[action]}
                </button>
              ))}
            </div>
          )}
          <details>
            <summary className="text-xs text-[#8b949e] cursor-pointer select-none">Details</summary>
            <pre className="mt-1 text-xs font-mono text-[#8b949e] whitespace-pre-wrap break-words bg-[#161b22] rounded p-2">
              {failure.output.trim() === "" ? "git printed nothing" : failure.output}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
};
