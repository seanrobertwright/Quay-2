use serde::{Deserialize, Serialize};

use super::config::FactoryConfig;

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum FactoryLoopMode {
    /// Queued work orders start as soon as their dependencies are merged.
    #[default]
    ACTIVE,
    /// New and unblocked work orders stay queued; running work continues.
    PAUSED,
    /// Running scaffolds and gates are cancelled, author terminals are killed,
    /// and new work orders are refused.
    HALTED,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum WorkOrderStatus {
    /// Waiting for dependencies to merge, or for the loop to become ACTIVE.
    QUEUED,
    /// Creating the worktree, vaulting holdbacks and running setup commands.
    SCAFFOLDING,
    /// The worktree is ready and the author agent is working (or correcting).
    IN_PROGRESS,
    /// Gate commands are running against the candidate commit.
    GATING,
    /// A human decision is needed; see `hold`.
    ON_HOLD,
    /// The gate passed; waiting for a human to accept and merge.
    AWAITING_ACCEPTANCE,
    /// Squash-merged into the base branch.
    COMPLETED,
    /// A scaffold or gate was cut off by an app restart or a HALT.
    INTERRUPTED,
    /// Scaffolding failed; it can be retried after fixing the cause.
    FAILED,
    /// An operator aborted the work order.
    ABORTED,
}

impl WorkOrderStatus {
    /// True for states no action can leave.
    pub fn is_final(self) -> bool {
        matches!(self, Self::COMPLETED | Self::ABORTED)
    }
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StageStatus {
    PENDING,
    RUNNING,
    PASSED,
    FAILED,
    ON_HOLD,
}

/// Stage ids in pipeline order.
pub const STAGE_IDS: [&str; 6] = [
    "admission",
    "scaffold",
    "implementation",
    "gate",
    "correction",
    "acceptance",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageRecord {
    pub id: String,
    pub status: StageStatus,
    pub started_at_ms: Option<i64>,
    pub finished_at_ms: Option<i64>,
    /// What actually happened in this stage, in one line.
    pub detail: String,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HoldReason {
    /// The title or objective matches an `outOfScope` rule in `.machina/factory.json`.
    SCOPE_DRIFT,
    /// An allowed output path overlaps a protected path.
    PROTECTED_PATH_OVERLAP,
    /// The gate failed on the last allowed attempt.
    MAX_CORRECTIONS_EXCEEDED,
    /// The gate could not reach a verdict (no checks, timeouts, git or audit errors).
    GATE_INCONCLUSIVE,
    /// Measured agent spend reached the work order's budget.
    BUDGET_EXCEEDED,
    /// Submitted by an agent over MCP; a human must admit it before anything runs.
    AGENT_SUBMITTED,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldOption {
    pub id: String,
    pub label: String,
    pub description: String,
    /// `primary`, `secondary` or `danger`.
    pub variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldCard {
    pub reason: HoldReason,
    pub summary: String,
    pub created_at_ms: i64,
    pub options: Vec<HoldOption>,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CheckOutcome {
    PASS,
    FAIL,
    TIMEOUT,
    /// The command could not be started, or was cancelled.
    ERROR,
    /// Not run because an earlier check failed.
    SKIPPED,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// 0 = setup, 1 = Tier 1 (visible to the author), 2 = Tier 2 (holdbacks).
    pub tier: u8,
    pub name: String,
    pub command: String,
    pub outcome: CheckOutcome,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    /// Output the author agent may see: the full tail for Tier 1, only
    /// `HOLDOUT_FAIL:` lines or a generic line for Tier 2.
    pub output: String,
    /// Raw Tier 2 output tail, for the operator only. Never sent to agents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_output: Option<String>,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum GateVerdict {
    PASS,
    FAIL,
    INCONCLUSIVE,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditSummary {
    pub passed: bool,
    pub blocker_count: usize,
    pub warning_count: usize,
    /// One line per blocker or warning.
    pub findings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateReport {
    pub attempt: u32,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
    /// Commit the gate judged; empty when the gate stopped before committing.
    pub candidate_sha: String,
    pub verdict: GateVerdict,
    /// Why the verdict is what it is, one reason per line.
    pub reasons: Vec<String>,
    pub changed_files: Vec<String>,
    pub scope_violations: Vec<String>,
    pub protected_violations: Vec<String>,
    pub audit: Option<AuditSummary>,
    pub checks: Vec<CheckResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub path: String,
    /// SHA-256 over the sorted (relative path, contents) of every vaulted file.
    pub sha256: String,
    pub files: Vec<String>,
    /// The holdbacks are committed to git, so the author can still read them
    /// from history even though they are hidden from the worktree.
    pub tracked_in_git: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpendSnapshot {
    /// False when no spend source exists for the author agent.
    pub measured: bool,
    pub usd: f64,
    pub responses: u64,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkOrderEvent {
    pub at_ms: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinaWorkOrder {
    pub id: String,
    pub title: String,
    pub objective: String,
    /// Top level of the main checkout the worktree was cut from.
    pub repo_path: String,
    pub base_branch: String,
    /// Commit the branch was cut from.
    pub base_sha: String,
    pub branch_name: String,
    pub worktree_path: String,
    pub author_agent: String,
    pub author_terminal_id: Option<String>,
    pub allowed_output_paths: Vec<String>,
    pub depends_on: Vec<String>,
    pub max_corrections: u32,
    /// Gate runs so far, including the initial one.
    pub attempts: u32,
    pub budget_usd: f64,
    pub spend: SpendSnapshot,
    pub status: WorkOrderStatus,
    pub stages: Vec<StageRecord>,
    pub hold: Option<HoldCard>,
    pub vault: Option<VaultInfo>,
    /// Results of the config's setup commands from the latest scaffold.
    pub setup_checks: Vec<CheckResult>,
    pub last_gate: Option<GateReport>,
    pub merge_commit: Option<String>,
    /// The worktree directory has been removed (the branch is kept).
    pub worktree_removed: bool,
    pub error: Option<String>,
    /// App epoch the work order was created in.
    pub epoch: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    /// Newest last, capped at `MAX_EVENTS`.
    pub events: Vec<WorkOrderEvent>,
}

pub const MAX_EVENTS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinaStatusPayload {
    pub loop_mode: FactoryLoopMode,
    /// Incremented every time Quay starts; work interrupted by a restart is
    /// stamped with the epoch that found it.
    pub epoch: u64,
    pub session_started_at_ms: i64,
    pub state_path: String,
    pub vault_root: String,
    pub work_order_count: usize,
    /// Sum of measured spend only; unmeasured agents are excluded.
    pub measured_spend_usd: f64,
    pub budget_usd: f64,
    pub active_holds: usize,
    pub running_jobs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitWorkOrderRequest {
    pub project_path: String,
    pub title: String,
    pub objective: String,
    pub allowed_output_paths: Vec<String>,
    #[serde(default)]
    pub base_branch: Option<String>,
    pub author_agent: String,
    pub max_corrections: u32,
    pub budget_usd: f64,
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveHoldRequest {
    pub work_order_id: String,
    pub option_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldbackSourceInfo {
    pub path: String,
    pub exists: bool,
    pub file_count: usize,
    pub tracked_in_git: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFactoryInfo {
    pub repo_path: String,
    pub current_branch: Option<String>,
    pub config_path: String,
    pub config_exists: bool,
    /// The parsed config, or the defaults when the file is missing or invalid.
    pub config: FactoryConfig,
    /// Set when the file exists but does not parse or validate.
    pub config_error: Option<String>,
    /// SHA-256 of the file as it is now; `None` when it does not exist.
    pub config_sha256: Option<String>,
    /// The operator approved exactly this file, so its commands may run.
    pub config_approved: bool,
    pub holdbacks: HoldbackSourceInfo,
}
