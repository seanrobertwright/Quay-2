// Check on host and Submit on the trigger form (#469, #476), drawn with the graph workflow form's
// controls. Submit is disabled, with each reason shown and described, while a gate in
// `triggerSubmit.ts` holds. The bar reads the target graph workflow on the host with
// `praxis_host_graph_show` when it is shown with a saved target and a usable host, and the git
// status of the trigger's saved files with `praxis_trigger_changes` when it is shown saved, each
// again whenever the builder saves, renames or deletes a record.
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SubmitControls } from "./GraphSubmit.tsx";
import { SubmitConfirm, UncommittedBadge } from "./GraphSubmitConfirm.tsx";
import type { BundleChangesRead } from "./graphRunStart.ts";
import type { HostCheck, LocalChecks, Submission } from "./graphSubmit.ts";
import { hostConditionView } from "./hostCondition.ts";
import { praxisCall, type HostCondition } from "./praxisHost.ts";
import type { GraphTriggerHostView } from "./triggerHost.ts";
import { definitionPath, targetPath } from "./session.ts";
import type { BundleChanges } from "./types.ts";
import {
  startsEnabled,
  targetNotAdmitted,
  targetOnHostOf,
  triggerCheckOf,
  triggerFindingText,
  triggerSubmissionOf,
  triggerSubmitBlockers,
  triggerWarnings,
  type TargetOnHost,
  type TriggerFinding,
} from "./triggerSubmit.ts";

/** What the builder gives the trigger form for Submit: what only it knows. */
export interface GraphTriggerSubmit {
  condition: HostCondition;
  /** Rereads this trigger on the host, and gives its host state after the read; null when it has none yet. */
  reread: () => Promise<GraphTriggerHostView | null>;
}

/**
 * Graph workflow `target` on the host, read when `key` changes while `target` isn't null, and by
 * `reread`; an answer for an older key is dropped. A read still running when the bar goes is
 * cancelled with it.
 */
function useTargetOnHost(projectPath: string, target: string | null, key: string) {
  const [read, setRead] = useState<{ key: string; read: TargetOnHost } | null>(null);
  const reread = useCallback(
    async (signal: AbortSignal): Promise<TargetOnHost | null> => {
      if (target === null) return null;
      const answer = targetOnHostOf(await praxisCall("praxis_host_graph_show", { projectPath, name: target }, signal));
      if (answer !== null && !signal.aborted) setRead({ key, read: answer });
      return answer;
    },
    [projectPath, target, key],
  );
  useEffect(() => {
    if (target === null) return;
    const controller = new AbortController();
    void reread(controller.signal);
    return () => controller.abort();
  }, [target, reread]);
  return { targetOnHost: read?.key === key ? read.read : null, reread };
}

/** Trigger `name`'s saved files with changes since the last commit, or why git status can't be read. Never rejects. */
function readChanges(projectPath: string, name: string): Promise<BundleChangesRead> {
  return invoke<BundleChanges>("praxis_trigger_changes", { projectPath, name }).then(
    (changes) => changes,
    (e) => ({ error: String(e) }),
  );
}

/** Reads trigger `name`'s git changes when `key` changes while `read` holds; an older answer is dropped. */
function useTriggerChanges(projectPath: string, name: string, read: boolean, key: string): BundleChangesRead | null {
  const [changes, setChanges] = useState<{ key: string; changes: BundleChangesRead } | null>(null);
  useEffect(() => {
    if (!read) return;
    let stale = false;
    void readChanges(projectPath, name).then((answer) => !stale && setChanges({ key, changes: answer }));
    return () => {
      stale = true;
    };
  }, [projectPath, name, read, key]);
  return read && changes?.key === key ? changes.changes : null;
}

export const TriggerSubmitBar: FC<{
  projectPath: string;
  name: string;
  /** The graph workflow the draft starts; null for none. */
  target: string | null;
  /** True when the draft has edits its saved files lack, or was never saved. */
  unsaved: boolean;
  local: LocalChecks;
  /** The saved file's `enabled`: whether the trigger starts enabled once admitted. */
  enabled: boolean;
  /** Counts up when the builder saves, renames or deletes a record, so the target is read again. */
  refresh: number;
  submit: GraphTriggerSubmit;
}> = ({ projectPath, name, target, unsaved, local, enabled, refresh, submit }) => {
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<HostCheck<TriggerFinding> | null>(null);
  /** True while Submit reads the target, checks and rereads, before the confirm opens. */
  const [preparing, setPreparing] = useState(false);
  /** Why the last Submit stopped short of the confirm, other than a gate or the check's findings. */
  const [stopped, setStopped] = useState<string | null>(null);
  /**
   * While the confirm is open, what it shows and the host's current revision the submission is
   * based on, all read when it opened.
   */
  const [confirming, setConfirming] = useState<{ baseRevision: number | null; changes: BundleChangesRead; admitted: boolean } | null>(null);
  // A check still running when the form goes is cancelled with it.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const usable = hostConditionView(submit.condition).usable;
  // Only a saved target, on a host Quay may use, is read.
  const saved = !unsaved && usable ? target : null;
  const { targetOnHost, reread: rereadTarget } = useTargetOnHost(projectPath, saved, `${projectPath}\n${saved}\n${refresh}`);
  const reasons = triggerSubmitBlockers({ name, target, unsaved, local, condition: submit.condition, targetOnHost });
  const changes = useTriggerChanges(projectPath, name, !unsaved, `${projectPath}
${name}
${refresh}`);
  const warnings = triggerWarnings({ target, targetOnHost, changes });

  /** Runs the host's trigger check, which writes nothing, and shows what it found; null when the form went before it answered. */
  const runCheck = async (): Promise<HostCheck<TriggerFinding> | null> => {
    const controller = new AbortController();
    abort.current = controller;
    setChecking(true);
    const answer = triggerCheckOf(await praxisCall("praxis_host_trigger_check", { projectPath, name }, controller.signal));
    if (controller.signal.aborted) return null;
    setChecking(false);
    setCheck(answer);
    return answer;
  };

  const checkOnHost = () => {
    if (!checking && !preparing) void runCheck();
  };

  /**
   * Submit: the target on the host first, then the check, and the confirm only when the target is
   * there and the check passes. The trigger's host state is read fresh, so a candidate submitted
   * since the last read counts as the base.
   */
  const startSubmit = async () => {
    if (reasons.length > 0 || checking || preparing || saved === null) return;
    setStopped(null);
    setPreparing(true);
    try {
      const controller = new AbortController();
      abort.current = controller;
      const onHost = await rereadTarget(controller.signal);
      // Gone from the host: the gate it now holds says so.
      if (onHost === null || controller.signal.aborted || onHost.state === "missing") return;
      if (onHost.state === "failed") return setStopped(`Quay couldn't read graph workflow ${saved} on the host: ${onHost.message}`);
      const answer = await runCheck();
      if (answer?.kind !== "passed") return;
      const [view, files] = await Promise.all([submit.reread(), readChanges(projectPath, name)]);
      setConfirming({ baseRevision: view?.current?.revision ?? null, changes: files, admitted: onHost.admitted });
    } finally {
      setPreparing(false);
    }
  };

  /**
   * Sends the submission, or resends the one with `requestId`, then rereads the trigger's host
   * state. It is never cancelled: closing the form doesn't stop a write. Faults found now close the
   * confirm and show as the check's.
   */
  const send = async (requestId: string | null): Promise<Submission<TriggerFinding>> => {
    const baseRevision = confirming?.baseRevision ?? null;
    const outcome = await praxisCall("praxis_host_trigger_submit", { projectPath, name, baseRevision, requestId }, new AbortController().signal);
    const answer = triggerSubmissionOf(outcome);
    void submit.reread();
    if (answer.kind === "faults") {
      setCheck(answer);
      setConfirming(null);
    }
    return answer;
  };

  return (
    <SubmitControls
      checking={checking || preparing}
      reasons={reasons}
      warnings={warnings}
      stopped={stopped}
      onCheck={checkOnHost}
      onSubmit={() => void startSubmit()}
      submitRef={submitRef}
    >
      {check && <CheckResult check={check} />}
      {confirming && saved !== null && (
        <SubmitConfirm name={name} onSend={send} onClose={() => setConfirming(null)} returnFocus={submitRef}>
          <TriggerFiles name={name} target={saved} enabled={enabled} admitted={confirming.admitted} changes={confirming.changes} />
        </SubmitConfirm>
      )}
    </SubmitControls>
  );
};

/** A trigger confirm's body: what the submission becomes, whether it starts enabled, and the saved files it rests on. */
const TriggerFiles: FC<{
  name: string;
  target: string;
  enabled: boolean;
  /** Whether the target has an admitted revision on the host. */
  admitted: boolean;
  changes: BundleChangesRead;
}> = ({ name, target, enabled, admitted, changes }) => {
  const changed = new Set("files" in changes ? changes.files.map((f) => f.path) : []);
  const files = [definitionPath({ kind: "triggers", id: name }), targetPath(name)];
  return (
    <>
      <p className="text-xs">The trigger becomes a candidate. It doesn&apos;t fire until the owner admits it in the browser.</p>
      <p className="text-xs">{startsEnabled(enabled)}</p>
      {!admitted && <p className="text-xs text-[#e3b341]">{targetNotAdmitted(target)}</p>}
      <section aria-label="Trigger files" className="text-xs space-y-1">
        <p className="text-[#8b949e]">
          Quay sends the saved trigger file, as it is on disk. It starts graph workflow <span className="font-mono">{target}</span>.
        </p>
        <ul className="space-y-1">
          {files.map((path) => (
            <li key={path}>
              <span className="font-mono text-[#c9d1d9] break-all">{path}</span>
              {changed.has(path) && <UncommittedBadge />}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
};

/** Keys for findings, which may repeat: each one's fields, then its count among equal ones. */
function findingKeys(findings: readonly TriggerFinding[]): string[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const base = `${f.path}|${f.code}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

/** What the last check came to: no faults, the host's findings, or why it didn't answer. */
const CheckResult: FC<{ check: HostCheck<TriggerFinding> }> = ({ check }) => {
  let body;
  if (check.kind === "passed") body = <p className="text-[#3fb950]">The host found no faults in the saved trigger.</p>;
  else if (check.kind === "failed") body = <p className="text-[#ff7b72] break-words">The host&apos;s check didn&apos;t finish: {check.message}</p>;
  else {
    const keys = findingKeys(check.findings);
    body = (
      <>
        <p className="text-[#ff7b72]">The host found faults in the saved trigger.</p>
        <ul className="space-y-0.5">
          {check.findings.map((finding, i) => (
            <li key={keys[i]} className="font-mono break-words">
              {triggerFindingText(finding)}
            </li>
          ))}
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
