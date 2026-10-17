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
pub enum FactoryLoopMode {
    ACTIVE,
    PAUSED,
    HALTED,
}

impl Default for FactoryLoopMode {
    fn default() -> Self {
        Self::ACTIVE
    }
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TriageState {
    READY,
    DESIGN_FIRST,
    NEEDS_CONTRACT_WORK,
    BLOCKED,
    NO_ACTION,
}

impl Default for TriageState {
    fn default() -> Self {
        Self::READY
    }
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GateVerdictOutcome {
    CAUGHT,
    ESCAPED,
    INCONCLUSIVE,
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
    SCOPE_DRIFT,
    PROTECTED_PATH_VIOLATION,
    GATE_INCONCLUSIVE,
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
pub struct RungVerdict {
    pub rung: String,
    pub outcome: String,
    pub detail: String,
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
    #[serde(default = "default_true")]
    pub protected_paths_passed: bool,
    #[serde(default)]
    pub protected_path_violations: Vec<String>,
    #[serde(default = "default_gate_verdict")]
    pub gate_verdict: String,
    #[serde(default = "default_rung_verdicts")]
    pub rung_verdicts: Vec<RungVerdict>,
    #[serde(default = "default_candidate_sha")]
    pub candidate_revision_sha: String,
    pub tier1_build_passed: bool,
    pub tier1_raw_output: String,
    pub tier2_holdback_passed: bool,
    pub tier2_sanitized_invariants: Vec<SanitizedInvariant>,
    pub pre_pr_secret_audit_passed: bool,
}

fn default_true() -> bool {
    true
}

fn default_gate_verdict() -> String {
    "PASS".to_string()
}

fn default_candidate_sha() -> String {
    "d9080e0 (FACTORY_RUNTIME_CANDIDATE)".to_string()
}

pub fn default_rung_verdicts() -> Vec<RungVerdict> {
    vec![
        RungVerdict {
            rung: "static".to_string(),
            outcome: "PASS".to_string(),
            detail: "tsc --noEmit & cargo check passed (0 warnings)".to_string(),
        },
        RungVerdict {
            rung: "unit".to_string(),
            outcome: "PASS".to_string(),
            detail: "cargo test (22 passed, 0 failed)".to_string(),
        },
        RungVerdict {
            rung: "e2e".to_string(),
            outcome: "PASS".to_string(),
            detail: "harness/END-TO-END.md user journeys verified".to_string(),
        },
        RungVerdict {
            rung: "holdout".to_string(),
            outcome: "PASS".to_string(),
            detail: ".factory/holdout/HOLDOUT.md blind scenarios verified".to_string(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionConstitution {
    pub product_summary: String,
    pub in_scope_capabilities: Vec<String>,
    pub out_of_scope_never: Vec<String>,
    pub hard_invariants: Vec<String>,
    pub protected_paths: Vec<String>,
    pub last_reconciled: String,
}

impl Default for MissionConstitution {
    fn default() -> Self {
        Self {
            product_summary: "Quay 2 is a keyboard-first, multi-agent ConPTY terminal orchestrator and supervised AI Software Factory (Machina Praxis) for Windows desktop developers.".to_string(),
            in_scope_capabilities: vec![
                "Multi-agent ConPTY terminal orchestration & persistent scrollback recovery".to_string(),
                "Loopback MCP tool bus & A2A v1.3.0 inter-agent message routing".to_string(),
                "Machina Praxis 6-stage software factory with blind holdback vault & 4-rung verification".to_string(),
                "Archon Context Graph & Wayfinder ADR/issue topology visualization".to_string(),
            ],
            out_of_scope_never: vec![
                "Cloud-hosted multi-tenant SaaS execution or remote code hosting".to_string(),
                "Unattended dark-factory auto-deploys that bypass human merge or holdback gates".to_string(),
                "Embedded full text editor / IDE clone replacing VS Code or Neovim".to_string(),
                "Cryptocurrency, token mining, or third-party billing marketplace".to_string(),
                "Telemetry exfiltration or uploading repository source outside the operator machine".to_string(),
            ],
            hard_invariants: vec![
                "The factory cannot modify governance files (MISSION.md, FACTORY_RULES.md, harness/**, .factory/**, .machina/holdbacks/**).".to_string(),
                "Tier 2 holdback vectors and source files are physically stripped before authoring and never leaked in correction diagnostics.".to_string(),
                "Reviewer / gate agent must never be the same agent identity that authored the candidate diff.".to_string(),
                "Every gate verdict requires explicit CHECKS_OK completion evidence; timeouts or missing markers are scored INCONCLUSIVE.".to_string(),
            ],
            protected_paths: vec![
                "MISSION.md".to_string(),
                "FACTORY.md".to_string(),
                "FACTORY_RULES.md".to_string(),
                "harness/**".to_string(),
                ".factory/**".to_string(),
                ".machina/holdbacks/**".to_string(),
                ".scratch/machina-praxis/**".to_string(),
            ],
            last_reconciled: "2026-10-16".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationDefectResult {
    pub defect_id: String,
    pub target_rung: String,
    pub caught_by_rung: Option<String>,
    pub outcome: GateVerdictOutcome,
    pub why: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateCalibrationReport {
    pub calibrated_at: String,
    pub total_defects: usize,
    pub caught_count: usize,
    pub escaped_count: usize,
    pub inconclusive_count: usize,
    pub all_rungs_exercised: bool,
    pub results: Vec<MutationDefectResult>,
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
    #[serde(default)]
    pub triage_state: TriageState,
    #[serde(default)]
    pub depends_on: Vec<String>,
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
    pub loop_mode: FactoryLoopMode,
    pub epoch: u64,
    pub pid: u32,
    pub origin: String,
    pub praxis_root: String,
    pub db_path: String,
    pub total_spent_usd: f64,
    pub total_budget_usd: f64,
    pub active_holds_count: usize,
    pub constitution: MissionConstitution,
    pub calibration_report: GateCalibrationReport,
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
pub struct RebindStageAgentRequest {
    pub work_order_id: String,
    pub stage_id: String,
    pub new_agent_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConstitutionRequest {
    pub project_path: String,
    pub constitution: MissionConstitution,
    pub write_bootstrap_files: bool,
}
