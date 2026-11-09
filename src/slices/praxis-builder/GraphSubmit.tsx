// Check on host and Submit on the graph workflow form (#444, #462). The bar sits under the form's
// host status line. Submit is disabled, with each reason shown and described, while a gate in
// `graphSubmit.ts` holds; uncommitted changes only warn. Check on host runs the check verb, which
// writes nothing, and lists the host's findings against the bundle file each names, each a link
// that opens it. The bar reads the saved bundle with `praxis_graph_workflow_bundle` when it is
// shown, whenever the builder saves, renames or deletes a record, and after each check.
import { useEffect, useId, useRef, useState, type FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchCheck, Send, TriangleAlert } from "lucide-react";
import type { GraphWorkflowHostView } from "./graphHost.ts";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import { SubmitConfirm } from "./GraphSubmitConfirm.tsx";
import {
  bundleWarnings,
  findingFile,
  findingText,
  hostCheckOf,
  identicalRevision,
  nothingChanged,
  recordLabel,
  submissionOf,
  submitBlockers,
  type HostCheck,
  type HostFinding,
  type LocalChecks,
  type Submission,
} from "./graphSubmit.ts";
import { praxisCall } from "./praxisHost.ts";
import type { DefinitionRef, GraphWorkflowBundle } from "./types.ts";

/** What the builder gives the form for Submit: what only it knows. */
export interface GraphWorkflowSubmit {
  /** True when `ref`'s draft has edits its saved file lacks, or it was never saved. */
  unsaved: (ref: DefinitionRef) => boolean;
  /** Rereads this graph workflow on the host, and gives its host state after the read. */
  reread: () => Promise<GraphWorkflowHostView>;
}

/** The saved bundle as the bar last read it. */
type BundleRead = { state: "reading" } | { state: "done"; bundle: GraphWorkflowBundle } | { state: "refused"; error: string };

/** Graph workflow `name`'s saved bundle, or why the backend won't build it. Never rejects. */
function readBundle(projectPath: string, name: string): Promise<Exclude<BundleRead, { state: "reading" }>> {
  return invoke<GraphWorkflowBundle>("praxis_graph_workflow_bundle", { projectPath, name }).then(
    (bundle) => ({ state: "done", bundle }),
    (e) => ({ state: "refused", error: String(e) }),
  );
}

/** Reads graph workflow `name`'s saved bundle, again when `refresh` changes; an older answer is dropped. */
function useBundle(projectPath: string, name: string, refresh: string): BundleRead {
  const [read, setRead] = useState<{ key: string; read: BundleRead } | null>(null);
  const key = `${projectPath}\n${name}\n${refresh}`;
  useEffect(() => {
    let stale = false;
    void readBundle(projectPath, name).then((answer) => !stale && setRead({ key, read: answer }));
    return () => {
      stale = true;
    };
  }, [projectPath, name, key]);
  return read?.key === key ? read.read : { state: "reading" };
}

const buttonClass =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-xs text-white aria-disabled:opacity-40";

export const GraphSubmitBar: FC<{
  projectPath: string;
  name: string;
  /** The bundle records, the graph workflow's included, in the order praxis is given them. */
  records: readonly DefinitionRef[];
  local: LocalChecks;
  /** Counts up when the builder saves, renames or deletes a record, so the bundle is read again. */
  refresh: number;
  host: GraphWorkflowHost;
  submit: GraphWorkflowSubmit;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ projectPath, name, records, local, refresh, host, submit, onOpen }) => {
  const { state } = host.view;
  const reasonsId = useId();
  // Bumped after each check, so the findings name the files the check read.
  const [reads, setReads] = useState(0);
  const bundle = useBundle(projectPath, name, `${refresh}|${reads}`);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<HostCheck | null>(null);
  /**
   * While the confirm is open, the bundle it shows and the host's current revision the
   * submission is based on, both read when it opened.
   */
  const [confirming, setConfirming] = useState<{ bundle: GraphWorkflowBundle; baseRevision: number | null } | null>(null);
  /** Why the last Submit stopped short of the confirm, other than the check's findings. */
  const [stopped, setStopped] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  // A check still running when the form goes is cancelled with it.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const reasons = submitBlockers({
    unsaved: records.filter(submit.unsaved),
    local,
    bundleRefusal: bundle.state === "refused" ? bundle.error : null,
    nameRule: state.kind === "nameRefused" ? state.rule : null,
    condition: host.condition,
  });
  const withheld = reasons.length > 0;
  const warnings = bundle.state === "done" ? bundleWarnings(bundle.bundle) : [];

  /** Runs the check verb and shows what it found; null when the form went before it answered. */
  const runCheck = async (): Promise<HostCheck | null> => {
    const controller = new AbortController();
    abort.current = controller;
    setChecking(true);
    const answer = hostCheckOf(await praxisCall("praxis_host_graph_check", { projectPath, name }, controller.signal));
    if (controller.signal.aborted) return null;
    setChecking(false);
    setCheck(answer);
    setReads((n) => n + 1);
    return answer;
  };

  const checkOnHost = () => {
    if (!checking) void runCheck();
  };

  /** Submit: the check first, and the confirm only when it passes. */
  const startSubmit = async () => {
    if (withheld || checking) return;
    setStopped(null);
    // The host state is read fresh, so a candidate submitted since the last read counts.
    const [answer, view, files] = await Promise.all([runCheck(), submit.reread(), readBundle(projectPath, name)]);
    if (answer?.kind !== "passed") return;
    const same = identicalRevision(view, answer.bundleDigest);
    if (same !== null) return setStopped(nothingChanged(same));
    if (files.state === "refused") return setStopped(files.error);
    setConfirming({ bundle: files.bundle, baseRevision: view.current?.revision ?? null });
  };

  /**
   * Sends the submission, or resends the one with `requestId`, then rereads the host state. It is
   * never cancelled: closing the form doesn't stop a write. Faults found now close the confirm and
   * show with the check's.
   */
  const send = async (requestId: string | null): Promise<Submission> => {
    const baseRevision = confirming?.baseRevision ?? null;
    const outcome = await praxisCall("praxis_host_graph_submit", { projectPath, name, baseRevision, requestId }, new AbortController().signal);
    const answer = submissionOf(outcome);
    void submit.reread();
    if (answer.kind === "faults") {
      setCheck(answer);
      setConfirming(null);
    }
    return answer;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          // Not `disabled`, which would drop focus while the check runs.
          aria-disabled={checking}
          onClick={checkOnHost}
          className={buttonClass}
        >
          <SearchCheck className="w-3.5 h-3.5" aria-hidden="true" />
          {checking ? "Checking on host…" : "Check on host"}
        </button>
        <button
          ref={submitRef}
          type="button"
          // Not `disabled`, which would drop focus; the reasons are shown and described.
          aria-disabled={withheld || checking}
          aria-describedby={withheld ? reasonsId : undefined}
          onClick={() => void startSubmit()}
          className={buttonClass}
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          Submit…
        </button>
      </div>
      {withheld && (
        <ul id={reasonsId} className="space-y-0.5 text-[11px] text-[#ff7b72]">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[11px] text-[#e3b341]">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
              <span>
                <span className="sr-only">Warning: </span>
                {w}
              </span>
            </li>
          ))}
        </ul>
      )}
      {stopped && (
        <p role="alert" className="text-[11px] text-[#ff7b72]">
          {stopped}
        </p>
      )}
      {check && <CheckResult check={check} bundle={bundle.state === "done" ? bundle.bundle : null} onOpen={onOpen} />}
      {confirming && (
        <SubmitConfirm name={name} bundle={confirming.bundle} onSend={send} onClose={() => setConfirming(null)} returnFocus={submitRef} />
      )}
    </div>
  );
};

/** Keys for findings, which may repeat: each one's fields, then its count among equal ones. */
function findingKeys(findings: readonly HostFinding[]): string[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const base = `${f.file}|${f.path}|${f.code}|${f.nodeId ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

/** What the last check came to: no faults, the host's findings, or why it didn't answer. */
const CheckResult: FC<{
  check: HostCheck;
  bundle: GraphWorkflowBundle | null;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ check, bundle, onOpen }) => {
  let body;
  if (check.kind === "passed") body = <p className="text-[#3fb950]">The host found no faults in the saved bundle.</p>;
  else if (check.kind === "failed") body = <p className="text-[#ff7b72] break-words">The host&apos;s check didn&apos;t finish: {check.message}</p>;
  else {
    const keys = findingKeys(check.findings);
    body = (
      <>
        <p className="text-[#ff7b72]">The host found faults in the saved bundle.</p>
        <ul className="space-y-0.5">
          {check.findings.map((finding, i) => {
            const ref = findingFile(finding, bundle);
            return (
              <li key={keys[i]} className="break-words">
                {ref ? (
                  <a
                    href={`#${ref.kind}/${encodeURIComponent(ref.id)}`}
                    onClick={(e) => {
                      // The builder opens records itself; the href only makes this a link.
                      e.preventDefault();
                      onOpen(ref);
                    }}
                    className="font-mono text-[#58a6ff] hover:underline"
                  >
                    {recordLabel(ref)}
                  </a>
                ) : (
                  <span className="font-mono">{finding.file}</span>
                )}
                : <span className="font-mono">{findingText(finding)}</span>
              </li>
            );
          })}
        </ul>
      </>
    );
  }
  return (
    <section aria-label="Host findings" className="text-[11px] text-[#c9d1d9] space-y-0.5">
      {body}
    </section>
  );
};
