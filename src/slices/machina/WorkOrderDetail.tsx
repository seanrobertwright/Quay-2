import { FC, useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitMerge,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import { TerminalInfo } from "../terminal/types";
import { AgentIcon } from "../terminal/AgentIcons";
import { formatDateTime, formatDuration, formatRelative } from "../../lib/dates";
import {
  agentName,
  formatUsd,
  outcomeClass,
  shortSha,
  STAGE_META,
  stageBarClass,
  stageTextClass,
  STATUS_LABEL,
  statusBadgeClass,
} from "./format";
import { CheckResult, HoldReason, MachinaWorkOrder, StageRecord } from "./types";

export type RunAction = (
  label: string,
  fn: () => Promise<unknown>,
  success?: string
) => Promise<void>;

interface WorkOrderDetailProps {
  wo: MachinaWorkOrder;
  now: number;
  terminals: TerminalInfo[];
  busy: string | null;
  run: RunAction;
  onLaunchAuthor: (wo: MachinaWorkOrder) => void;
  onOpenTerminal: (terminalId: string) => void;
}

const HOLD_TITLE: Record<HoldReason, string> = {
  SCOPE_DRIFT: "Out of scope",
  PROTECTED_PATH_OVERLAP: "Allowed paths overlap protected paths",
  MAX_CORRECTIONS_EXCEEDED: "No corrections left",
  GATE_INCONCLUSIVE: "Gate inconclusive",
  BUDGET_EXCEEDED: "Budget reached",
  AGENT_SUBMITTED: "Submitted by an agent",
};

const MAX_LISTED_FILES = 200;
const EVENTS_COLLAPSED = 30;

function stageDuration(st: StageRecord, now: number): string | null {
  if (st.startedAtMs === null) return null;
  const end = st.finishedAtMs ?? (st.status === "RUNNING" ? now : null);
  return end === null ? null : formatDuration(end - st.startedAtMs);
}

function tierLabel(tier: number): string {
  return tier === 0 ? "Setup" : tier === 2 ? "Tier 2" : "Tier 1";
}

const Fact: FC<{ label: string; children: React.ReactNode; title?: string }> = ({
  label,
  children,
  title,
}) => (
  <div className="min-w-0">
    <dt className="text-[10px] uppercase tracking-wider text-[#8b949e]">{label}</dt>
    <dd className="text-xs text-[#c9d1d9] font-mono break-all" title={title}>
      {children}
    </dd>
  </div>
);

const FileList: FC<{ files: string[] }> = ({ files }) => (
  <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[#c9d1d9]">
    {files.slice(0, MAX_LISTED_FILES).map((f) => (
      <li key={f} className="break-all">
        {f}
      </li>
    ))}
    {files.length > MAX_LISTED_FILES && (
      <li className="text-[#8b949e]">… and {files.length - MAX_LISTED_FILES} more</li>
    )}
  </ul>
);

const CheckRow: FC<{ c: CheckResult }> = ({ c }) => (
  <li className="rounded-lg border border-[#30363d] bg-[#0d1117]">
    <details>
      <summary className="flex items-center gap-3 px-3 py-2 cursor-pointer text-xs">
        <span className="w-12 shrink-0 text-[10px] uppercase text-[#8b949e]">{tierLabel(c.tier)}</span>
        <span className="flex-1 min-w-0 font-mono text-white truncate">{c.name}</span>
        <span className={`font-mono font-bold ${outcomeClass(c.outcome)}`}>{c.outcome}</span>
        <span className="w-14 text-right font-mono text-[#8b949e]">
          {c.exitCode === null ? "—" : `exit ${c.exitCode}`}
        </span>
        <span className="w-16 text-right font-mono text-[#8b949e]">
          {c.outcome === "SKIPPED" ? "—" : formatDuration(c.durationMs)}
        </span>
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {c.tier !== 2 && (
          <div className="text-[11px] text-[#8b949e]">
            Command: <code className="text-[#c9d1d9]">{c.command}</code>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase text-[#8b949e] mb-1">
            {c.tier === 2 ? "Shown to the author" : "Output"}
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-[#010409] p-2 text-[11px] text-[#c9d1d9] whitespace-pre-wrap">
            {c.output || "(no output)"}
          </pre>
        </div>
        {c.operatorOutput !== undefined && (
          <div>
            <div className="text-[10px] uppercase text-[#d29922] mb-1">
              Raw output, operator only (command: <code>{c.command}</code>)
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-[#010409] p-2 text-[11px] text-[#c9d1d9] whitespace-pre-wrap">
              {c.operatorOutput || "(no output)"}
            </pre>
          </div>
        )}
      </div>
    </details>
  </li>
);

export const WorkOrderDetail: FC<WorkOrderDetailProps> = ({
  wo,
  now,
  terminals,
  busy,
  run,
  onLaunchAuthor,
  onOpenTerminal,
}) => {
  const headingId = useId();
  const pipelineId = useId();
  const gateId = useId();
  const actionsId = useId();
  const forceId = useId();
  const [objectiveOpen, setObjectiveOpen] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [confirm, setConfirm] = useState<"abort" | "remove" | null>(null);
  const [forceRemove, setForceRemove] = useState(false);
  const [preview, setPreview] = useState<{ kind: string; text: string } | null>(null);
  const previewSeq = useRef(0);

  // A different work order resets local UI state.
  useEffect(() => {
    setConfirm(null);
    setForceRemove(false);
    setPreview(null);
    setObjectiveOpen(false);
    setShowAllEvents(false);
    previewSeq.current++;
  }, [wo.id]);

  const authorTerminal = terminals.find((t) => t.id === wo.authorTerminalId) ?? null;
  const isBusy = busy !== null;
  const lastGate = wo.lastGate;
  const canGate = wo.status === "IN_PROGRESS" || wo.status === "AWAITING_ACCEPTANCE";
  const canRemove =
    !wo.worktreeRemoved &&
    (wo.status === "COMPLETED" || wo.status === "ABORTED" || wo.status === "FAILED");
  const canAbort = wo.status !== "COMPLETED" && wo.status !== "ABORTED";
  const scaffoldDone = wo.stages.find((s) => s.id === "scaffold")?.status === "PASSED";

  const showPreview = async (kind: "brief" | "correction") => {
    const seq = ++previewSeq.current;
    try {
      const text = await invoke<string>("machina_preview_author_message", {
        workOrderId: wo.id,
        kind,
      });
      if (seq === previewSeq.current) setPreview({ kind, text });
    } catch (e) {
      if (seq === previewSeq.current) setPreview({ kind, text: `Cannot preview: ${String(e)}` });
    }
  };

  const send = (kind: "brief" | "correction") =>
    run(
      kind === "brief" ? "Send brief" : "Send correction",
      () => invoke("machina_send_to_author", { workOrderId: wo.id, kind }),
      `Typed the ${kind} into ${authorTerminal?.name ?? "the author terminal"}.`
    );

  const events = [...wo.events].reverse();
  const shownEvents = showAllEvents ? events : events.slice(0, EVENTS_COLLAPSED);

  const btn =
    "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const primary = `${btn} bg-[#238636] hover:bg-[#2ea043] text-white`;
  const secondary = `${btn} bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d]`;
  const danger = `${btn} bg-[#21262d] hover:bg-[#f85149]/20 text-[#ff7b72] border border-[#f85149]/40`;

  return (
    <div className="flex gap-5 min-h-0">
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header */}
        <section
          aria-labelledby={headingId}
          className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-[#58a6ff]">{wo.id}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-semibold ${statusBadgeClass(wo.status)}`}
            >
              {STATUS_LABEL[wo.status]}
            </span>
          </div>
          <h3 id={headingId} className="text-base font-bold text-white">
            {wo.title}
          </h3>
          <div>
            <p
              className={`text-xs text-[#8b949e] whitespace-pre-wrap ${objectiveOpen ? "" : "line-clamp-3"}`}
            >
              {wo.objective}
            </p>
            {wo.objective.length > 240 && (
              <button
                type="button"
                onClick={() => setObjectiveOpen((v) => !v)}
                aria-expanded={objectiveOpen}
                className="text-[11px] text-[#58a6ff] hover:underline"
              >
                {objectiveOpen ? "Show less" : "Show the full objective"}
              </button>
            )}
          </div>

          {wo.error && (
            <div role="alert" className="p-2 rounded border border-[#f85149]/40 bg-[#f85149]/10 text-xs text-[#ff7b72]">
              {wo.error}
            </div>
          )}

          <dl className="grid grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2.5">
            <Fact label="Branch">{wo.branchName}</Fact>
            <Fact label="Base" title={wo.baseSha}>
              {wo.baseBranch} @ {shortSha(wo.baseSha)}
            </Fact>
            <Fact label="Worktree">
              {wo.worktreePath}
              {wo.worktreeRemoved && <span className="text-[#8b949e]"> (removed)</span>}
            </Fact>
            <Fact label="Author">
              <span className="inline-flex items-center gap-1.5">
                <AgentIcon kind={wo.authorAgent} className="w-3.5 h-3.5" />
                {agentName(wo.authorAgent)}
              </span>
            </Fact>
            <Fact label="Author terminal">
              {wo.authorTerminalId === null
                ? "Not launched"
                : authorTerminal
                  ? authorTerminal.name
                  : "Closed"}
            </Fact>
            <Fact label="Gate attempts">
              {wo.attempts} of {wo.maxCorrections + 1} allowed
            </Fact>
            <Fact label="Spend" title={wo.spend.note}>
              {wo.spend.measured ? (
                <span className={wo.spend.usd >= wo.budgetUsd ? "text-[#ff7b72]" : "text-[#e3b341]"}>
                  {formatUsd(wo.spend.usd)} of {formatUsd(wo.budgetUsd)}
                </span>
              ) : (
                <span className="text-[#8b949e]">
                  Not measured (budget {formatUsd(wo.budgetUsd)})
                </span>
              )}
            </Fact>
            <Fact label="Allowed paths">{wo.allowedOutputPaths.join(", ")}</Fact>
            <Fact label="Created" title={formatDateTime(wo.createdAtMs)}>
              {formatRelative(wo.createdAtMs, now)} (epoch {wo.epoch})
            </Fact>
            {wo.dependsOn.length > 0 && <Fact label="Depends on">{wo.dependsOn.join(", ")}</Fact>}
            {wo.mergeCommit && (
              <Fact label="Merge commit" title={wo.mergeCommit}>
                {shortSha(wo.mergeCommit)} on {wo.baseBranch}
              </Fact>
            )}
          </dl>
          {wo.spend.measured && (
            <p className="text-[11px] text-[#8b949e]">{wo.spend.note}</p>
          )}
        </section>

        {/* Hold */}
        {wo.hold && (
          <section
            aria-label="Decision needed"
            className="p-4 rounded-xl bg-[#d29922]/10 border-2 border-[#d29922] space-y-3"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-[#d29922]">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
              {HOLD_TITLE[wo.hold.reason]}
              <span className="ml-auto text-[11px] font-normal text-[#8b949e]" title={formatDateTime(wo.hold.createdAtMs)}>
                {formatRelative(wo.hold.createdAtMs, now)}
              </span>
            </div>
            <p className="text-xs text-white">{wo.hold.summary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {wo.hold.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    run(
                      "Resolve hold",
                      () =>
                        invoke("machina_resolve_hold", {
                          request: { workOrderId: wo.id, optionId: opt.id },
                        }),
                      `${wo.id}: ${opt.label}.`
                    )
                  }
                  className={`text-left p-2.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                    opt.variant === "danger"
                      ? "border-[#f85149]/50 hover:bg-[#f85149]/15"
                      : opt.variant === "primary"
                        ? "border-[#3fb950]/50 hover:bg-[#3fb950]/15"
                        : "border-[#30363d] hover:bg-[#21262d]"
                  }`}
                >
                  <div
                    className={`font-bold ${
                      opt.variant === "danger"
                        ? "text-[#ff7b72]"
                        : opt.variant === "primary"
                          ? "text-[#3fb950]"
                          : "text-white"
                    }`}
                  >
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-[#8b949e] mt-0.5">{opt.description}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Pipeline */}
        <section aria-labelledby={pipelineId} className="space-y-2">
          <h4 id={pipelineId} className="text-xs font-bold uppercase tracking-wider text-[#8b949e]">
            Pipeline
          </h4>
          <ol className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
            {wo.stages.map((st, i) => {
              const meta = STAGE_META[st.id];
              const dur = stageDuration(st, now);
              return (
                <li key={st.id} className="p-3 rounded-lg bg-[#161b22] border border-[#30363d] space-y-1.5">
                  <div className={`h-1 rounded-full ${stageBarClass(st.status)}`} aria-hidden="true" />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">
                      {i + 1}. {meta.title}
                    </span>
                    <span className={`text-[10px] font-mono font-bold ${stageTextClass(st.status)}`}>
                      {st.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#c9d1d9] break-words">
                    {st.detail || <span className="text-[#8b949e]">{meta.summary}</span>}
                  </p>
                  {dur && <p className="text-[10px] font-mono text-[#8b949e]">{dur}</p>}
                </li>
              );
            })}
          </ol>
        </section>

        {/* Gate report */}
        {lastGate && (
          <section aria-labelledby={gateId} className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 id={gateId} className="text-sm font-bold text-white">
                Gate attempt {lastGate.attempt}:{" "}
                <span className={outcomeClass(lastGate.verdict)}>{lastGate.verdict}</span>
              </h4>
              <span className="text-[11px] text-[#8b949e]" title={formatDateTime(lastGate.finishedAtMs)}>
                {formatRelative(lastGate.finishedAtMs, now)} · took{" "}
                {formatDuration(lastGate.finishedAtMs - lastGate.startedAtMs)}
              </span>
              {lastGate.candidateSha && (
                <span className="ml-auto font-mono text-[11px] text-[#8b949e]" title={lastGate.candidateSha}>
                  candidate {shortSha(lastGate.candidateSha)}
                </span>
              )}
            </div>
            <ul className="space-y-1 text-xs">
              {lastGate.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-[#c9d1d9]">
                  {lastGate.verdict === "PASS" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[#3fb950] shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 mt-0.5 text-[#ff7b72] shrink-0" aria-hidden="true" />
                  )}
                  <span className="break-words">{r}</span>
                </li>
              ))}
            </ul>

            {lastGate.checks.length > 0 && (
              <ul className="space-y-1.5" aria-label="Checks">
                {lastGate.checks.map((c) => (
                  <CheckRow key={`${c.tier}-${c.name}`} c={c} />
                ))}
              </ul>
            )}

            {(lastGate.protectedViolations.length > 0 || lastGate.scopeViolations.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {lastGate.protectedViolations.length > 0 && (
                  <div className="p-2.5 rounded border border-[#f85149]/40 bg-[#f85149]/5">
                    <div className="font-bold text-[#ff7b72]">Protected files changed</div>
                    <FileList files={lastGate.protectedViolations} />
                  </div>
                )}
                {lastGate.scopeViolations.length > 0 && (
                  <div className="p-2.5 rounded border border-[#d29922]/40 bg-[#d29922]/5">
                    <div className="font-bold text-[#d29922]">Outside the allowed paths</div>
                    <FileList files={lastGate.scopeViolations} />
                  </div>
                )}
              </div>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-[#8b949e]">
                Changed files ({lastGate.changedFiles.length})
              </summary>
              <FileList files={lastGate.changedFiles} />
            </details>

            {lastGate.audit && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[#8b949e]">
                  Pre-PR audit:{" "}
                  <span className={lastGate.audit.passed ? "text-[#3fb950]" : "text-[#ff7b72]"}>
                    {lastGate.audit.passed ? "passed" : "failed"}
                  </span>{" "}
                  ({lastGate.audit.blockerCount} blocker(s), {lastGate.audit.warningCount} warning(s))
                </summary>
                {lastGate.audit.findings.length === 0 ? (
                  <p className="mt-1 text-[#8b949e]">No findings.</p>
                ) : (
                  <FileList files={Array.from(new Set(lastGate.audit.findings))} />
                )}
              </details>
            )}
          </section>
        )}

        {/* Scaffold setup and vault */}
        {(wo.setupChecks.length > 0 || wo.vault) && (
          <section aria-label="Worktree setup and holdback vault" className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3">
            {wo.vault && (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Lock className="w-3.5 h-3.5 text-[#3fb950]" aria-hidden="true" />
                  Holdback vault: {wo.vault.files.length} file(s)
                </div>
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Fact label="Vault path">{wo.vault.path}</Fact>
                  <Fact label="Pinned sha256">{wo.vault.sha256}</Fact>
                </dl>
                {wo.vault.trackedInGit && (
                  <p className="flex items-start gap-1.5 text-[11px] text-[#d29922]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    These holdbacks are committed to git. They are hidden from the worktree, but the author
                    can still read them from history. Keep .machina/holdbacks/ untracked to keep them blind.
                  </p>
                )}
                {wo.vault.files.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-[#8b949e]">Vaulted files</summary>
                    <FileList files={wo.vault.files} />
                  </details>
                )}
              </div>
            )}
            {wo.setupChecks.length > 0 && (
              <ul className="space-y-1.5" aria-label="Setup commands">
                {wo.setupChecks.map((c) => (
                  <CheckRow key={`setup-${c.name}`} c={c} />
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Events */}
        <section aria-label="Event log" className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#8b949e]">Events</h4>
          <ol className="space-y-1 text-[11px]">
            {shownEvents.map((e) => (
              <li key={`${e.atMs}:${e.message}`} className="flex gap-2">
                <span className="w-16 shrink-0 font-mono text-[#8b949e]" title={formatDateTime(e.atMs)}>
                  {formatRelative(e.atMs, now)}
                </span>
                <span className="text-[#c9d1d9] break-words">{e.message}</span>
              </li>
            ))}
          </ol>
          {events.length > EVENTS_COLLAPSED && (
            <button
              type="button"
              onClick={() => setShowAllEvents((v) => !v)}
              aria-expanded={showAllEvents}
              className="text-[11px] text-[#58a6ff] hover:underline"
            >
              {showAllEvents ? "Show fewer" : `Show all ${events.length} events`}
            </button>
          )}
        </section>
      </div>

      {/* Actions */}
      <aside aria-labelledby={actionsId} className="w-64 shrink-0 space-y-3">
        <h4 id={actionsId} className="text-xs font-bold uppercase tracking-wider text-[#8b949e]">
          Actions
        </h4>

        {wo.status === "QUEUED" && (
          <p className="text-xs text-[#8b949e]">
            Queued. It starts when its dependencies merge and the loop is ACTIVE.
          </p>
        )}
        {wo.status === "SCAFFOLDING" && (
          <p className="text-xs text-[#58a6ff]" role="status">
            Creating the worktree, vaulting holdbacks and running setup commands…
          </p>
        )}
        {wo.status === "GATING" && (
          <p className="text-xs text-[#58a6ff]" role="status">
            Gate attempt {wo.attempts} is running.
          </p>
        )}
        {wo.status === "ON_HOLD" && (
          <p className="text-xs text-[#d29922]">Needs a decision; see the hold above.</p>
        )}

        {wo.status === "IN_PROGRESS" && (
          <div className="space-y-2">
            {authorTerminal ? (
              <>
                <button type="button" className={secondary} onClick={() => onOpenTerminal(authorTerminal.id)}>
                  <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
                  Open {authorTerminal.name}
                </button>
                <button type="button" className={secondary} disabled={isBusy} onClick={() => send("brief")}>
                  Send the brief
                </button>
                {lastGate && lastGate.verdict !== "PASS" && (
                  <button type="button" className={secondary} disabled={isBusy} onClick={() => send("correction")}>
                    Send the gate feedback
                  </button>
                )}
                <div className="flex gap-2 text-[11px]">
                  <button type="button" className="text-[#58a6ff] hover:underline" onClick={() => showPreview("brief")}>
                    Preview brief
                  </button>
                  {lastGate && lastGate.verdict !== "PASS" && (
                    <button type="button" className="text-[#58a6ff] hover:underline" onClick={() => showPreview("correction")}>
                      Preview feedback
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button type="button" className={secondary} disabled={isBusy} onClick={() => onLaunchAuthor(wo)}>
                <AgentIcon kind={wo.authorAgent} className="w-3.5 h-3.5" />
                Launch {agentName(wo.authorAgent)} in the worktree
              </button>
            )}
            {preview && (
              <div className="p-2 rounded border border-[#30363d] bg-[#0d1117] text-[11px] text-[#c9d1d9] break-words">
                <div className="mb-1 text-[10px] uppercase text-[#8b949e]">
                  {preview.kind === "brief" ? "Brief" : "Feedback message"}
                </div>
                {preview.text}
              </div>
            )}
          </div>
        )}

        {canGate && (
          <button
            type="button"
            className={wo.status === "IN_PROGRESS" ? primary : secondary}
            disabled={isBusy}
            onClick={() =>
              run("Run gate", () => invoke("machina_run_gate", { workOrderId: wo.id }), `Gate started for ${wo.id}.`)
            }
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            {wo.status === "AWAITING_ACCEPTANCE" ? "Run the gate again" : "Run the gate"}
          </button>
        )}

        {wo.status === "AWAITING_ACCEPTANCE" && (
          <div className="space-y-1.5">
            <button
              type="button"
              className={primary}
              disabled={isBusy}
              onClick={() =>
                run(
                  "Merge",
                  () => invoke("machina_accept_and_merge", { workOrderId: wo.id }),
                  `${wo.id} squash-merged into ${wo.baseBranch}.`
                )
              }
            >
              <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
              Squash-merge into {wo.baseBranch}
            </button>
            <p className="text-[11px] text-[#8b949e]">
              The main checkout at {wo.repoPath} must be on {wo.baseBranch} with no uncommitted changes to tracked
              files.
            </p>
            {authorTerminal && (
              <button type="button" className={secondary} onClick={() => onOpenTerminal(authorTerminal.id)}>
                <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
                Open {authorTerminal.name}
              </button>
            )}
          </div>
        )}

        {(wo.status === "INTERRUPTED" || wo.status === "FAILED") && (
          <button
            type="button"
            className={primary}
            disabled={isBusy}
            onClick={() => run("Resume", () => invoke("machina_resume", { workOrderId: wo.id }), `${wo.id} resumed.`)}
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            {scaffoldDone ? "Resume" : "Retry the scaffold"}
          </button>
        )}

        {canRemove && (
          <div className="space-y-1.5">
            {confirm === "remove" ? (
              <>
                <label htmlFor={forceId} className="flex items-center gap-2 text-[11px] text-[#c9d1d9]">
                  <input
                    id={forceId}
                    type="checkbox"
                    checked={forceRemove}
                    onChange={(e) => setForceRemove(e.target.checked)}
                  />
                  Discard uncommitted changes in it
                </label>
                <button
                  type="button"
                  className={danger}
                  disabled={isBusy}
                  onClick={() => {
                    setConfirm(null);
                    void run(
                      "Remove worktree",
                      () => invoke("machina_remove_worktree", { workOrderId: wo.id, force: forceRemove }),
                      `Removed ${wo.id}'s worktree; branch ${wo.branchName} is kept.`
                    );
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Confirm removal
                </button>
                <button type="button" className={secondary} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={secondary} disabled={isBusy} onClick={() => setConfirm("remove")}>
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Remove the worktree
              </button>
            )}
            <p className="text-[11px] text-[#8b949e]">
              <GitBranch className="inline w-3 h-3" aria-hidden="true" /> The branch {wo.branchName} is kept.
            </p>
          </div>
        )}

        {canAbort &&
          (confirm === "abort" ? (
            <div className="space-y-1.5">
              <button
                type="button"
                className={danger}
                disabled={isBusy}
                onClick={() => {
                  setConfirm(null);
                  void run("Abort", () => invoke("machina_abort", { workOrderId: wo.id }), `${wo.id} aborted.`);
                }}
              >
                Confirm abort
              </button>
              <button type="button" className={secondary} onClick={() => setConfirm(null)}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" className={danger} disabled={isBusy} onClick={() => setConfirm("abort")}>
              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
              Abort
            </button>
          ))}

        {busy && (
          <p className="text-[11px] text-[#58a6ff]" role="status">
            {busy}…
          </p>
        )}
      </aside>
    </div>
  );
};
