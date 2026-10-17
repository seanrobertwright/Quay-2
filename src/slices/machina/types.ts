import { RunKind } from "../terminal/types";

export type SidecarHealthState =
  | "STOPPED"
  | "STARTING"
  | "READY"
  | "DEGRADED"
  | "RESTARTING";

export type FactoryLoopMode = "ACTIVE" | "PAUSED" | "HALTED";

export type TriageState =
  | "READY"
  | "DESIGN_FIRST"
  | "NEEDS_CONTRACT_WORK"
  | "BLOCKED"
  | "NO_ACTION";

export type GateVerdictOutcome = "CAUGHT" | "ESCAPED" | "INCONCLUSIVE";

export type WorkOrderStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "INTERRUPTED"
  | "FAILED";

export type StageNodeStatus =
  | "PENDING"
  | "RUNNING"
  | "PASSED"
  | "ON_HOLD"
  | "CORRECTION"
  | "FAILED";

export type HoldReasonCode =
  | "CREDENTIAL_REQUIRED"
  | "PRICE_REQUIRED"
  | "EXPOSURE_EXCEEDED"
  | "MAX_CORRECTIONS_EXCEEDED"
  | "SCOPE_DRIFT"
  | "PROTECTED_PATH_VIOLATION"
  | "GATE_INCONCLUSIVE";

export interface PraxisHoldCard {
  holdId: string;
  profile: "aiws-hold-card/1";
  reason: HoldReasonCode;
  stageId: string;
  attemptId: string;
  epoch: number;
  summary: string;
  requiredScope?: string;
  requestedBudgetDeltaUsd?: number;
  createdAt: string;
  exitOptions: {
    id: string;
    label: string;
    variant: "primary" | "warning" | "danger" | "secondary";
    description: string;
  }[];
}

export interface RungVerdict {
  rung: "static" | "unit" | "e2e" | "holdout" | string;
  outcome: "PASS" | "FAIL" | "INCONCLUSIVE" | string;
  detail: string;
}

export interface HoldbackValidationReport {
  vaultPath: string;
  vaultSha256: string;
  strippedFromAuthoringWorktree: boolean;
  outputPathConfinementPassed: boolean;
  allowedOutputPaths: string[];
  modifiedFiles: string[];
  protectedPathsPassed?: boolean;
  protectedPathViolations?: string[];
  gateVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE" | string;
  rungVerdicts?: RungVerdict[];
  candidateRevisionSha?: string;
  tier1BuildPassed: boolean;
  tier1RawOutput: string;
  tier2HoldbackPassed: boolean;
  tier2SanitizedInvariants: {
    invariantId: string;
    title: string;
    passed: boolean;
    sanitizedMessage: string;
  }[];
  prePrSecretAuditPassed: boolean;
}

export interface MissionConstitution {
  productSummary: string;
  inScopeCapabilities: string[];
  outOfScopeNever: string[];
  hardInvariants: string[];
  protectedPaths: string[];
  lastReconciled: string;
}

export interface MutationDefectResult {
  defectId: string;
  targetRung: string;
  caughtByRung?: string | null;
  outcome: GateVerdictOutcome;
  why: string;
  detail: string;
}

export interface GateCalibrationReport {
  calibratedAt: string;
  totalDefects: number;
  caughtCount: number;
  escapedCount: number;
  inconclusiveCount: number;
  allRungsExercised: boolean;
  results: MutationDefectResult[];
}

export interface PipelineStageNode {
  id:
    | "ingestion"
    | "scaffold"
    | "implementation"
    | "holdback_gate"
    | "correction_loop"
    | "acceptance";
  index: number;
  title: string;
  subtitle: string;
  status: StageNodeStatus;
  boundAgentKind: RunKind;
  boundTerminalName?: string;
  attemptOrdinal: number;
  maxCorrections: number;
  attemptKind: "INITIAL" | "CORRECTION";
  costUsd: number;
  durationSec: number;
  mcpToolName: string;
}

export interface MachinaWorkOrder {
  id: string;
  title: string;
  templateId: string;
  status: WorkOrderStatus;
  triageState?: TriageState;
  dependsOn?: string[];
  branchName: string;
  worktreePath: string;
  epoch: number;
  budgetAllowanceUsd: number;
  spentUsd: number;
  activeLeases: string[];
  createdAt: string;
  stages: PipelineStageNode[];
  activeHold?: PraxisHoldCard | null;
  validationReport: HoldbackValidationReport;
}

export interface FactoryTemplate {
  id: string;
  name: string;
  description: string;
  defaultOutputPaths: string[];
  defaultHoldbackSuite: string;
  defaultMaxCorrections: number;
  defaultBudgetUsd: number;
  defaultAuthorAgent: RunKind;
  defaultReviewerAgent: RunKind;
}
