// Check on host and Submit on the graph workflow form (#444, #462). The bar sits under the form's
// host status line. Submit is disabled, with each reason shown and described, while a gate in
// `graphSubmit.ts` holds; uncommitted changes only warn. Check on host runs the check verb, which
// writes nothing, and lists the host's findings against the bundle file each names, each a link
// that opens it. The bar reads the saved bundle with `praxis_graph_workflow_bundle` when it is
// shown, whenever the builder saves, renames or deletes a record, and after each check.
import { useEffect, useRef, useState, type FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GraphWorkflowHostView } from "./graphHost.ts";
import type { GraphWorkflowHost } from "./GraphHostPanel.tsx";
import {
  bundleWarnings,
  findingFile,
  findingText,
  hostCheckOf,
  identicalRevision,
  nothingChanged,
  submissionOf,
  submitBlockers,
  type BundleCheck,
  type HostFinding,
} from "./graphSubmit.ts";
import { recordLabel, type LocalChecks, type Submission } from "./hostSubmit.ts";
import { praxisCall } from "./praxisHost.ts";
import { HostFindings, SubmitControls } from "./SubmitControls.tsx";
import { SubmitConfirm, UncommittedBadge } from "./SubmitConfirm.tsx";
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
  // Bumped after each check, so the findings name the files the check read.
  const [reads, setReads] = useState(0);
  const bundle = useBundle(projectPath, name, `${refresh}|${reads}`);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<BundleCheck | null>(null);
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
  const runCheck = async (): Promise<BundleCheck | null> => {
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
  const send = async (requestId: string | null): Promise<Submission<HostFinding>> => {
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
    <SubmitControls
      checking={checking}
      reasons={reasons}
      warnings={warnings}
      stopped={stopped}
      onCheck={checkOnHost}
      onSubmit={() => void startSubmit()}
      submitRef={submitRef}
    >
      {check && (
        <HostFindings
          check={check}
          subject="bundle"
          keyOf={(f) => `${f.file}|${f.path}|${f.code}|${f.nodeId ?? ""}`}
          renderFinding={(finding) => <BundleFinding finding={finding} bundle={bundle.state === "done" ? bundle.bundle : null} onOpen={onOpen} />}
        />
      )}
      {confirming && (
        <SubmitConfirm name={name} onSend={send} onClose={() => setConfirming(null)} returnFocus={submitRef}>
          <BundleFiles bundle={confirming.bundle} />
        </SubmitConfirm>
      )}
    </SubmitControls>
  );
};

/** A graph workflow confirm's body: what the submission becomes, and the bundle files it sends. */
const BundleFiles: FC<{
  /** The saved bundle, read when the confirm opened. */
  bundle: GraphWorkflowBundle;
}> = ({ bundle }) => (
  <>
    <p className="text-xs">The submission becomes a candidate. Nothing runs until the owner admits it in the browser.</p>
    <section aria-label="Bundle files" className="text-xs space-y-1">
      <p className="text-[#8b949e]">Quay sends these saved files, as they are on disk:</p>
      <ul className="space-y-1">
        {bundle.files.map((f) => (
          <li key={f.file} className="space-y-0.5">
            <span className="font-mono text-[#c9d1d9] break-all">{f.path}</span>
            {f.change !== undefined && <UncommittedBadge />}
            <span className="block font-mono text-[10px] text-[#8b949e] break-all">{f.digest ?? "No digest: Quay can't read this file."}</span>
          </li>
        ))}
      </ul>
    </section>
  </>
);

/** One of the host's findings in a bundle: the file it names, a link that opens it when Quay knows it, and where in it. */
const BundleFinding: FC<{
  finding: HostFinding;
  bundle: GraphWorkflowBundle | null;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ finding, bundle, onOpen }) => {
  const ref = findingFile(finding, bundle);
  return (
    <>
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
    </>
  );
};
