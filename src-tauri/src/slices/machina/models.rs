use serde::{Deserialize, Serialize};

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SidecarHealthState {
    STOPPED,
    STARTING,
    READY,
    DEGRADED,
    RESTARTING,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WorkOrderStatus {
    QUEUED,
    IN_PROGRESS,
    ON_HOLD,
    COMPLETED,
    INTERRUPTED,
    FAILED,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum StageNodeStatus {
    PENDING,
    RUNNING,
    PASSED,
    ON_HOLD,
    CORRECTION,
    FAILED,
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum HoldReasonCode {
    CREDENTIAL_REQUIRED,
    PRICE_REQUIRED,
    EXPOSURE_EXCEEDED,
    MAX_CORRECTIONS_EXCEEDED,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldExitOption {
    pub id: String,
    pub label: String,
    pub variant: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PraxisHoldCard {
    pub hold_id: String,
    pub profile: String,
    pub reason: HoldReasonCode,
    pub stage_id: String,
    pub attempt_id: String,
    pub epoch: u64,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_budget_delta_usd: Option<f64>,
    pub created_at: String,
    pub exit_options: Vec<HoldExitOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedInvariant {
    pub invariant_id: String,
    pub title: String,
    pub passed: bool,
    pub sanitized_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldbackValidationReport {
    pub vault_path: String,
    pub vault_sha256: String,
    pub stripped_from_authoring_worktree: bool,
    pub output_path_confinement_passed: bool,
    pub allowed_output_paths: Vec<String>,
    pub modified_files: Vec<String>,
    pub tier1_build_passed: bool,
    pub tier1_raw_output: String,
    pub tier2_holdback_passed: bool,
    pub tier2_sanitized_invariants: Vec<SanitizedInvariant>,
    pub pre_pr_secret_audit_passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStageNode {
    pub id: String,
    pub index: u32,
    pub title: String,
    pub subtitle: String,
    pub status: StageNodeStatus,
    pub bound_agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound_terminal_name: Option<String>,
    pub attempt_ordinal: u32,
    pub max_corrections: u32,
    pub attempt_kind: String,
    pub cost_usd: f64,
    pub duration_sec: u64,
    pub mcp_tool_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinaWorkOrder {
    pub id: String,
    pub title: String,
    pub template_id: String,
    pub status: WorkOrderStatus,
    pub branch_name: String,
    pub worktree_path: String,
    pub epoch: u64,
    pub budget_allowance_usd: f64,
    pub spent_usd: f64,
    pub active_leases: Vec<String>,
    pub created_at: String,
    pub stages: Vec<PipelineStageNode>,
    pub active_hold: Option<PraxisHoldCard>,
    pub validation_report: HoldbackValidationReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinaStatusPayload {
    pub sidecar_state: SidecarHealthState,
    pub epoch: u64,
    pub pid: u32,
    pub origin: String,
    pub praxis_root: String,
    pub db_path: String,
    pub total_spent_usd: f64,
    pub total_budget_usd: f64,
    pub active_holds_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitWorkOrderRequest {
    pub project_path: String,
    pub template_id: String,
    pub title: String,
    pub allowed_output_paths: Vec<String>,
    pub holdback_suite: String,
    pub max_corrections: u32,
    pub budget_allowance_usd: f64,
    pub author_agent: String,
    pub reviewer_agent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveHoldRequest {
    pub work_order_id: String,
    pub option_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebindStageAgentRequest {
    pub work_order_id: String,
    pub stage_id: String,
    pub new_agent_kind: String,
}
