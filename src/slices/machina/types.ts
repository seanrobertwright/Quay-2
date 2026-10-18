import { RunKind } from "../terminal/types";

// Mirrors src-tauri/src/slices/machina/models.rs and config.rs. Option<T> arrives as null.

export type FactoryLoopMode = "ACTIVE" | "PAUSED" | "HALTED";

export type WorkOrderStatus =
  | "QUEUED"
  | "SCAFFOLDING"
  | "IN_PROGRESS"
  | "GATING"
  | "ON_HOLD"
  | "AWAITING_ACCEPTANCE"
  | "COMPLETED"
  | "INTERRUPTED"
  | "FAILED"
  | "ABORTED";

export type StageStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ON_HOLD";

export type StageId =
  | "admission"
  | "scaffold"
  | "implementation"
  | "gate"
  | "correction"
  | "acceptance";

export interface StageRecord {
  id: StageId;
  status: StageStatus;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  detail: string;
}

export type HoldReason =
  | "SCOPE_DRIFT"
  | "PROTECTED_PATH_OVERLAP"
  | "MAX_CORRECTIONS_EXCEEDED"
  | "GATE_INCONCLUSIVE"
  | "BUDGET_EXCEEDED"
  | "AGENT_SUBMITTED";

export interface HoldOption {
  id: string;
  label: string;
  description: string;
  variant: "primary" | "secondary" | "danger";
}

export interface HoldCard {
  reason: HoldReason;
  summary: string;
  createdAtMs: number;
  options: HoldOption[];
}

export type CheckOutcome = "PASS" | "FAIL" | "TIMEOUT" | "ERROR" | "SKIPPED";

export interface CheckResult {
  /** 0 = setup, 1 = Tier 1, 2 = Tier 2 (holdbacks). */
  tier: number;
  name: string;
  command: string;
  outcome: CheckOutcome;
  exitCode: number | null;
  durationMs: number;
  /** What the author agent may see. */
  output: string;
  /** Raw Tier 2 output, operator only. */
  operatorOutput?: string;
}

export type GateVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";

export interface AuditSummary {
  passed: boolean;
  blockerCount: number;
  warningCount: number;
  findings: string[];
}

export interface GateReport {
  attempt: number;
  startedAtMs: number;
  finishedAtMs: number;
  candidateSha: string;
  verdict: GateVerdict;
  reasons: string[];
  changedFiles: string[];
  scopeViolations: string[];
  protectedViolations: string[];
  audit: AuditSummary | null;
  checks: CheckResult[];
}

export interface VaultInfo {
  path: string;
  sha256: string;
  files: string[];
  trackedInGit: boolean;
}

export interface SpendSnapshot {
  measured: boolean;
  usd: number;
  responses: number;
  note: string;
}

export interface WorkOrderEvent {
  atMs: number;
  message: string;
}

export interface MachinaWorkOrder {
  id: string;
  title: string;
  objective: string;
  repoPath: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  worktreePath: string;
  authorAgent: RunKind;
  authorTerminalId: string | null;
  allowedOutputPaths: string[];
  dependsOn: string[];
  maxCorrections: number;
  attempts: number;
  budgetUsd: number;
  spend: SpendSnapshot;
  status: WorkOrderStatus;
  stages: StageRecord[];
  hold: HoldCard | null;
  vault: VaultInfo | null;
  setupChecks: CheckResult[];
  lastGate: GateReport | null;
  mergeCommit: string | null;
  worktreeRemoved: boolean;
  error: string | null;
  epoch: number;
  createdAtMs: number;
  updatedAtMs: number;
  events: WorkOrderEvent[];
}

export interface MachinaStatus {
  loopMode: FactoryLoopMode;
  epoch: number;
  sessionStartedAtMs: number;
  statePath: string;
  vaultRoot: string;
  workOrderCount: number;
  measuredSpendUsd: number;
  budgetUsd: number;
  activeHolds: number;
  runningJobs: number;
}

export interface GateCommand {
  name: string;
  run: string;
}

export interface FactoryConfig {
  version: number;
  protectedPaths: string[];
  outOfScope: string[];
  setup: GateCommand[];
  tier1: GateCommand[];
  tier2: GateCommand[];
  timeoutSec: number;
}

export interface ProjectFactoryInfo {
  repoPath: string;
  currentBranch: string | null;
  configPath: string;
  configExists: boolean;
  config: FactoryConfig;
  configError: string | null;
  /** SHA-256 of the file as it is now; null when it does not exist. */
  configSha256: string | null;
  /** The operator approved exactly this file, so its commands may run. */
  configApproved: boolean;
  holdbacks: {
    path: string;
    exists: boolean;
    fileCount: number;
    trackedInGit: boolean;
  };
}

export const FINAL_STATUSES: WorkOrderStatus[] = ["COMPLETED", "ABORTED"];
