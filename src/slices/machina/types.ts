import { RunKind } from "../terminal/types";

export type SidecarHealthState =
  | "STOPPED"
  | "STARTING"
  | "READY"
  | "DEGRADED"
  | "RESTARTING";

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
  | "MAX_CORRECTIONS_EXCEEDED";

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

export interface HoldbackValidationReport {
  vaultPath: string;
  vaultSha256: string;
  strippedFromAuthoringWorktree: boolean;
  outputPathConfinementPassed: boolean;
  allowedOutputPaths: string[];
  modifiedFiles: string[];
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
