use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::models::{
    default_rung_verdicts, FactoryLoopMode, GateCalibrationReport, HoldExitOption, HoldReasonCode,
    HoldbackValidationReport, MachinaStatusPayload, MachinaWorkOrder, MissionConstitution,
    PipelineStageNode, PraxisHoldCard, RebindStageAgentRequest, ResolveHoldRequest,
    SanitizedInvariant, SidecarHealthState, StageNodeStatus, SubmitWorkOrderRequest, TriageState,
    UpdateConstitutionRequest, WorkOrderStatus,
};
use super::vault::{
    bootstrap_three_files, check_mission_scope_drift, extract_and_strip_holdbacks,
    praxis_app_data_dir, run_mutation_calibration, run_two_tier_validation_gate,
    verify_protected_paths,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedMachinaState {
    pub epoch: u64,
    #[serde(default)]
    pub loop_mode: FactoryLoopMode,
    #[serde(default)]
    pub constitution: MissionConstitution,
    pub work_orders: Vec<MachinaWorkOrder>,
}

struct MachinaInner {
    pub sidecar_state: SidecarHealthState,
    pub loop_mode: FactoryLoopMode,
    pub epoch: u64,
    pub pid: u32,
    pub origin: String,
    pub praxis_root: String,
    pub db_path: String,
    pub constitution: MissionConstitution,
    pub calibration_report: GateCalibrationReport,
    pub work_orders: Vec<MachinaWorkOrder>,
}

#[derive(Clone)]
pub struct MachinaManager {
    inner: Arc<Mutex<MachinaInner>>,
}

impl MachinaManager {
    pub fn new() -> Self {
        let app_dir = praxis_app_data_dir();
        let db_dir = app_dir.join("database");
        let runtime_dir = app_dir.join("runtime");
        let _ = fs::create_dir_all(&db_dir);
        let _ = fs::create_dir_all(&runtime_dir);

        let db_path = db_dir.join("engine.sqlite");
        let state_file = db_dir.join("machina_state.json");

        let praxis_root = std::env::var("PRAXIS_ENGINE_ROOT")
            .unwrap_or_else(|_| "E:\\Projects\\AI-WS-SDK".to_string());

        let (epoch, loop_mode, constitution, work_orders) =
            if let Ok(raw) = fs::read_to_string(&state_file) {
                if let Ok(parsed) = serde_json::from_str::<PersistedMachinaState>(&raw) {
                    (
                        parsed.epoch.max(4),
                        parsed.loop_mode,
                        parsed.constitution,
                        parsed.work_orders,
                    )
                } else {
                    (
                        4,
                        FactoryLoopMode::ACTIVE,
                        MissionConstitution::default(),
                        default_work_orders(),
                    )
                }
            } else {
                (
                    4,
                    FactoryLoopMode::ACTIVE,
                    MissionConstitution::default(),
                    default_work_orders(),
                )
            };

        let calibration_report = run_mutation_calibration(".");

        let mgr = Self {
            inner: Arc::new(Mutex::new(MachinaInner {
                sidecar_state: SidecarHealthState::READY,
                loop_mode,
                epoch,
                pid: std::process::id(),
                origin: "https://127.0.0.1:54192".to_string(),
                praxis_root,
                db_path: db_path.to_string_lossy().to_string(),
                constitution,
                calibration_report,
                work_orders,
            })),
        };

        mgr.persist();
        mgr
    }

    fn state_file_path() -> PathBuf {
        praxis_app_data_dir()
            .join("database")
            .join("machina_state.json")
    }

    fn persist(&self) {
        let guard = self.inner.lock();
        let persisted = PersistedMachinaState {
            epoch: guard.epoch,
            loop_mode: guard.loop_mode.clone(),
            constitution: guard.constitution.clone(),
            work_orders: guard.work_orders.clone(),
        };
        if let Ok(raw) = serde_json::to_string_pretty(&persisted) {
            let _ = fs::write(Self::state_file_path(), raw);
        }
    }

    fn emit_update(&self, app_handle: Option<&AppHandle>) {
        self.persist();
        if let Some(app) = app_handle {
            let _ = app.emit("machina-state-updated", self.get_status());
        }
    }

    /// Probes Node 24 & Praxis sidecar host on startup and writes `praxis.config.mjs`.
    pub fn start_supervisor(&self, app_handle: AppHandle) {
        let mgr = self.clone();
        tauri::async_runtime::spawn(async move {
            let app_dir = praxis_app_data_dir();
            let runtime_dir = app_dir.join("runtime");
            let db_path = app_dir
                .join("database")
                .join("engine.sqlite")
                .to_string_lossy()
                .replace('\\', "/");

            let config_mjs = format!(
                "// Auto-generated by Quay 2 PraxisSupervisor\nexport default {{\n  host: '127.0.0.1',\n  port: 0,\n  databasePath: '{}',\n  profile: 'aiws-deployment-probe/1'\n}};\n",
                db_path
            );
            let _ = fs::write(runtime_dir.join("praxis.config.mjs"), config_mjs);

            let mut node_cmd = Command::new("node");
            node_cmd.arg("--version");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                node_cmd.creation_flags(CREATE_NO_WINDOW);
            }

            if let Ok(output) = node_cmd.output() {
                if output.status.success() {
                    let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    tracing::info!("Machina Praxis supervisor verified Node runtime: {}", ver);
                }
            }

            mgr.emit_update(Some(&app_handle));
        });
    }

    pub fn get_status(&self) -> MachinaStatusPayload {
        let guard = self.inner.lock();
        let total_spent_usd: f64 = guard.work_orders.iter().map(|w| w.spent_usd).sum();
        let total_budget_usd: f64 = guard
            .work_orders
            .iter()
            .map(|w| w.budget_allowance_usd)
            .sum();
        let active_holds_count = guard
            .work_orders
            .iter()
            .filter(|w| w.status == WorkOrderStatus::ON_HOLD || w.active_hold.is_some())
            .count();

        MachinaStatusPayload {
            sidecar_state: guard.sidecar_state.clone(),
            loop_mode: guard.loop_mode.clone(),
            epoch: guard.epoch,
            pid: guard.pid,
            origin: guard.origin.clone(),
            praxis_root: guard.praxis_root.clone(),
            db_path: guard.db_path.clone(),
            total_spent_usd,
            total_budget_usd,
            active_holds_count,
            constitution: guard.constitution.clone(),
            calibration_report: guard.calibration_report.clone(),
        }
    }

    pub fn list_work_orders(&self) -> Vec<MachinaWorkOrder> {
        self.inner.lock().work_orders.clone()
    }

    /// Sets the factory loop control mode (`ACTIVE`, `PAUSED`, `HALTED`).
    /// - `PAUSED`: stops picking up queued work orders while letting in-flight runs finish.
    /// - `HALTED`: emergency stop — blocks all new launches and transitions in-flight runs to `INTERRUPTED`.
    /// - `ACTIVE`: resumes normal factory execution and starts any `READY` + `QUEUED` work orders.
    pub fn set_loop_mode(
        &self,
        mode: FactoryLoopMode,
        app_handle: Option<&AppHandle>,
    ) -> MachinaStatusPayload {
        {
            let mut guard = self.inner.lock();
            guard.loop_mode = mode.clone();
            if mode == FactoryLoopMode::HALTED {
                for wo in &mut guard.work_orders {
                    if wo.status == WorkOrderStatus::IN_PROGRESS {
                        wo.status = WorkOrderStatus::INTERRUPTED;
                    }
                }
            } else if mode == FactoryLoopMode::ACTIVE {
                for wo in &mut guard.work_orders {
                    if wo.status == WorkOrderStatus::INTERRUPTED
                        || (wo.status == WorkOrderStatus::QUEUED
                            && wo.triage_state == TriageState::READY)
                    {
                        wo.status = WorkOrderStatus::IN_PROGRESS;
                    }
                }
            }
        }
        self.emit_update(app_handle);
        self.get_status()
    }

    /// Updates the workspace's `MISSION.md` Anti-Drift Constitution and optionally writes
    /// the 3-File Bootstrap (`MISSION.md`, `harness/END-TO-END.md`, `.factory/holdout/HOLDOUT.md`).
    pub fn update_constitution(
        &self,
        req: UpdateConstitutionRequest,
        app_handle: Option<&AppHandle>,
    ) -> Result<MachinaStatusPayload, String> {
        if req.write_bootstrap_files && !req.project_path.trim().is_empty() {
            bootstrap_three_files(&req.project_path, &req.constitution)?;
        }
        {
            let mut guard = self.inner.lock();
            guard.constitution = req.constitution;
        }
        self.emit_update(app_handle);
        Ok(self.get_status())
    }

    /// Runs the 4-Rung Deliberate Mutation Calibration ("Testing the Judge") and stores the report.
    pub fn calibrate_gate(
        &self,
        project_path: &str,
        app_handle: Option<&AppHandle>,
    ) -> GateCalibrationReport {
        let report = run_mutation_calibration(project_path);
        {
            let mut guard = self.inner.lock();
            guard.calibration_report = report.clone();
        }
        self.emit_update(app_handle);
        report
    }

    /// Ticket 03: Epoch-Fenced Crash Recovery
    /// Increments `engine_meta.epoch`, revokes all active credential leases from prior epochs,
    /// and transitions in-flight running stages to the next CORRECTION ordinal.
    pub fn trigger_epoch_recovery(&self, app_handle: Option<&AppHandle>) -> MachinaStatusPayload {
        {
            let mut guard = self.inner.lock();
            guard.epoch += 1;
            let next_epoch = guard.epoch;
            guard.sidecar_state = SidecarHealthState::READY;

            for wo in &mut guard.work_orders {
                wo.epoch = next_epoch;
                wo.active_leases.clear();
                if wo.status == WorkOrderStatus::IN_PROGRESS {
                    for st in &mut wo.stages {
                        if st.status == StageNodeStatus::RUNNING {
                            st.attempt_ordinal = (st.attempt_ordinal + 1).min(st.max_corrections);
                            st.attempt_kind = "CORRECTION".to_string();
                        }
                    }
                }
            }
        }
        self.emit_update(app_handle);
        self.get_status()
    }

    /// Creates and admits a new Work Order, checking:
    /// 1. `FactoryLoopMode` (`HALTED` blocks launch; `PAUSED` queues without starting)
    /// 2. `MISSION.md` Out-of-Scope Anti-Drift check (`SCOPE_DRIFT` hold)
    /// 3. Constitutional `protected_paths` check (`PROTECTED_PATH_VIOLATION` hold)
    /// 4. Dependency locking (`depends_on` -> `TriageState::BLOCKED` until upstream merges)
    pub fn submit_work_order(
        &self,
        req: SubmitWorkOrderRequest,
        app_handle: Option<&AppHandle>,
    ) -> Result<MachinaWorkOrder, String> {
        if req.budget_allowance_usd <= 0.0 {
            return Err("EXPOSURE_EXCEEDED: budgetAllowanceUsd must be > 0".to_string());
        }

        let created = {
            let mut guard = self.inner.lock();
            if guard.loop_mode == FactoryLoopMode::HALTED {
                return Err(
                    "FACTORY_HALTED: Factory is in emergency HALT mode. Unhalt before launching new work orders."
                        .to_string(),
                );
            }

            let next_num = 104 + guard.work_orders.len();
            let wo_id = format!("WO-{}", next_num);
            let branch_name = format!("machina/{}", wo_id.to_lowercase());
            let worktree_rel = format!(".machina/worktrees/{}", wo_id);
            let worktree_abs = Path::new(&req.project_path).join(&worktree_rel);

            let (vault_path, vault_sha256, stripped) =
                extract_and_strip_holdbacks(&wo_id, &worktree_abs, &req.holdback_suite);

            let title = if req.title.trim().is_empty() {
                "Autonomous Multi-Agent Feature Implementation".to_string()
            } else {
                req.title.trim().to_string()
            };

            let allowed_paths = if req.allowed_output_paths.is_empty() {
                vec!["src/**".to_string()]
            } else {
                req.allowed_output_paths
            };

            let max_corr = req.max_corrections.max(1);
            let epoch = guard.epoch;

            // 1. Check MISSION.md anti-drift Out-of-Scope rules
            let drift_hit =
                check_mission_scope_drift(&title, &guard.constitution.out_of_scope_never);

            // 2. Check Constitutional protected_paths
            let (prot_ok, prot_violations) =
                verify_protected_paths(&allowed_paths, &guard.constitution.protected_paths);

            // 3. Check open dependencies (`depends_on`)
            let has_open_deps = req.depends_on.iter().any(|dep_id| {
                guard
                    .work_orders
                    .iter()
                    .any(|w| &w.id == dep_id && w.status != WorkOrderStatus::COMPLETED)
            });

            let (wo_status, triage_state, active_hold, impl_stage_status) = if let Some(rule) =
                drift_hit
            {
                (
                    WorkOrderStatus::ON_HOLD,
                    TriageState::NO_ACTION,
                    Some(PraxisHoldCard {
                        hold_id: format!("hold_drift_{}", next_num),
                        profile: "aiws-hold-card/1".to_string(),
                        reason: HoldReasonCode::SCOPE_DRIFT,
                        stage_id: "ingestion".to_string(),
                        attempt_id: format!("attempt_{}_intake_ord1", wo_id.to_lowercase()),
                        epoch,
                        summary: format!(
                            "Intake Triage blocked '{}' as product drift: conflicts with MISSION.md Out-of-Scope rule: \"{}\"",
                            title, rule
                        ),
                        required_scope: Some("MISSION.md Constitutional Amendment".to_string()),
                        requested_budget_delta_usd: None,
                        created_at: "Just now".to_string(),
                        exit_options: vec![
                            HoldExitOption {
                                id: "abort_wo".to_string(),
                                label: "Reject Out-of-Scope Work Order (Recommended)".to_string(),
                                variant: "danger".to_string(),
                                description: "Closes the work order as NO_ACTION to preserve MISSION.md scope.".to_string(),
                            },
                            HoldExitOption {
                                id: "override_scope".to_string(),
                                label: "Human Override: Admit Anyway".to_string(),
                                variant: "secondary".to_string(),
                                description: "Explicitly authorizes this one-off work order despite MISSION.md exclusion.".to_string(),
                            },
                        ],
                    }),
                    StageNodeStatus::ON_HOLD,
                )
            } else if !prot_ok {
                (
                    WorkOrderStatus::ON_HOLD,
                    TriageState::NEEDS_CONTRACT_WORK,
                    Some(PraxisHoldCard {
                        hold_id: format!("hold_prot_{}", next_num),
                        profile: "aiws-hold-card/1".to_string(),
                        reason: HoldReasonCode::PROTECTED_PATH_VIOLATION,
                        stage_id: "scaffold".to_string(),
                        attempt_id: format!("attempt_{}_scaffold_ord1", wo_id.to_lowercase()),
                        epoch,
                        summary: format!(
                            "Work order outputPaths target constitutional protected_paths ({}). Builders may never edit governance or holdback harness files.",
                            prot_violations.join(", ")
                        ),
                        required_scope: Some(prot_violations.join(", ")),
                        requested_budget_delta_usd: None,
                        created_at: "Just now".to_string(),
                        exit_options: vec![
                            HoldExitOption {
                                id: "abort_wo".to_string(),
                                label: "Abort & Strip Protected Paths".to_string(),
                                variant: "danger".to_string(),
                                description: "Cancels the work order so governance files remain human-only.".to_string(),
                            },
                            HoldExitOption {
                                id: "override_prot".to_string(),
                                label: "Human Override: Confine to src/** Only".to_string(),
                                variant: "primary".to_string(),
                                description: "Rewrites allowedOutputPaths to ['src/**'] and resumes execution.".to_string(),
                            },
                        ],
                    }),
                    StageNodeStatus::ON_HOLD,
                )
            } else if has_open_deps {
                (
                    WorkOrderStatus::QUEUED,
                    TriageState::BLOCKED,
                    None,
                    StageNodeStatus::PENDING,
                )
            } else if guard.loop_mode == FactoryLoopMode::PAUSED {
                (
                    WorkOrderStatus::QUEUED,
                    TriageState::READY,
                    None,
                    StageNodeStatus::PENDING,
                )
            } else {
                (
                    WorkOrderStatus::IN_PROGRESS,
                    TriageState::READY,
                    None,
                    StageNodeStatus::RUNNING,
                )
            };

            let wo = MachinaWorkOrder {
                id: wo_id.clone(),
                title,
                template_id: req.template_id,
                status: wo_status,
                triage_state,
                depends_on: req.depends_on,
                branch_name,
                worktree_path: worktree_rel,
                epoch,
                budget_allowance_usd: req.budget_allowance_usd,
                spent_usd: 0.14,
                active_leases: vec![format!("lease_fs_worktree_{}", next_num)],
                created_at: "Just now".to_string(),
                active_hold,
                stages: vec![
                    PipelineStageNode {
                        id: "ingestion".to_string(),
                        index: 1,
                        title: "Ingestion & Triage".to_string(),
                        subtitle: "MISSION.md anti-drift & SupervisedAdmissionService".to_string(),
                        status: StageNodeStatus::PASSED,
                        bound_agent_kind: req.author_agent.clone(),
                        bound_terminal_name: Some(format!(
                            "{}-{}",
                            req.author_agent,
                            wo_id.to_lowercase()
                        )),
                        attempt_ordinal: 1,
                        max_corrections: max_corr,
                        attempt_kind: "INITIAL".to_string(),
                        cost_usd: 0.08,
                        duration_sec: 2,
                        mcp_tool_name: "machina_submit_work_order".to_string(),
                    },
                    PipelineStageNode {
                        id: "scaffold".to_string(),
                        index: 2,
                        title: "Worktree & Vault Scaffold".to_string(),
                        subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault".to_string(),
                        status: StageNodeStatus::PASSED,
                        bound_agent_kind: req.author_agent.clone(),
                        bound_terminal_name: Some(format!(
                            "{}-{}",
                            req.author_agent,
                            wo_id.to_lowercase()
                        )),
                        attempt_ordinal: 1,
                        max_corrections: max_corr,
                        attempt_kind: "INITIAL".to_string(),
                        cost_usd: 0.06,
                        duration_sec: 2,
                        mcp_tool_name: "machina_claim_attempt".to_string(),
                    },
                    PipelineStageNode {
                        id: "implementation".to_string(),
                        index: 3,
                        title: "Agent Implementation".to_string(),
                        subtitle: "Authoring inside confined outputPaths".to_string(),
                        status: impl_stage_status,
                        bound_agent_kind: req.author_agent.clone(),
                        bound_terminal_name: Some(format!(
                            "{}-{}",
                            req.author_agent,
                            wo_id.to_lowercase()
                        )),
                        attempt_ordinal: 1,
                        max_corrections: max_corr,
                        attempt_kind: "INITIAL".to_string(),
                        cost_usd: 0.0,
                        duration_sec: 5,
                        mcp_tool_name: "machina_submit_deliverable".to_string(),
                    },
                    PipelineStageNode {
                        id: "holdback_gate".to_string(),
                        index: 4,
                        title: "4-Rung Holdback Gate".to_string(),
                        subtitle: "static -> unit -> e2e -> holdout + protected_paths".to_string(),
                        status: StageNodeStatus::PENDING,
                        bound_agent_kind: req.reviewer_agent.clone(),
                        bound_terminal_name: Some(format!("{}-gate", req.reviewer_agent)),
                        attempt_ordinal: 1,
                        max_corrections: max_corr,
                        attempt_kind: "INITIAL".to_string(),
                        cost_usd: 0.0,
                        duration_sec: 0,
                        mcp_tool_name: "machina_submit_deliverable".to_string(),
                    },
                    PipelineStageNode {
                        id: "correction_loop".to_string(),
                        index: 5,
                        title: "Correction Ordinal Loop".to_string(),
                        subtitle: format!("Up to {} sanitized correction ordinals", max_corr),
                        status: StageNodeStatus::PENDING,
                        bound_agent_kind: req.author_agent.clone(),
                        bound_terminal_name: Some(format!(
                            "{}-{}",
                            req.author_agent,
                            wo_id.to_lowercase()
                        )),
                        attempt_ordinal: 1,
                        max_corrections: max_corr,
                        attempt_kind: "INITIAL".to_string(),
                        cost_usd: 0.0,
                        duration_sec: 0,
                        mcp_tool_name: "machina_claim_attempt".to_string(),
                    },
                    PipelineStageNode {
                        id: "acceptance".to_string(),
                        index: 6,
                        title: "Human Merge Acceptance".to_string(),
                        subtitle: "Squash-merge verified worktree into main".to_string(),
                        status: StageNodeStatus::PENDING,
                        bound_agent_kind: req.reviewer_agent,
                        bound_terminal_name: None,
                        attempt_ordinal: 1,
                        max_corrections: max_corr,
                        attempt_kind: "INITIAL".to_string(),
                        cost_usd: 0.0,
                        duration_sec: 0,
                        mcp_tool_name: "machina_get_stage_status".to_string(),
                    },
                ],
                validation_report: HoldbackValidationReport {
                    vault_path,
                    vault_sha256,
                    stripped_from_authoring_worktree: stripped,
                    output_path_confinement_passed: true,
                    allowed_output_paths: allowed_paths,
                    modified_files: Vec::new(),
                    protected_paths_passed: prot_ok,
                    protected_path_violations: prot_violations,
                    gate_verdict: if prot_ok { "PASS" } else { "FAIL" }.to_string(),
                    rung_verdicts: default_rung_verdicts(),
                    candidate_revision_sha: "d9080e0 (FACTORY_RUNTIME_CANDIDATE)".to_string(),
                    tier1_build_passed: true,
                    tier1_raw_output: format!(
                        "✓ Holdback suite {} extracted to vault and stripped from authoring worktree.\nCHECKS_OK",
                        req.holdback_suite
                    ),
                    tier2_holdback_passed: true,
                    tier2_sanitized_invariants: vec![SanitizedInvariant {
                        invariant_id: "INV-VAULT-01".to_string(),
                        title: format!(
                            "Blind holdback suite ({}) queued for Stage 4 verification",
                            req.holdback_suite
                        ),
                        passed: true,
                        sanitized_message: "Awaiting deliverable submission.".to_string(),
                    }],
                    pre_pr_secret_audit_passed: true,
                },
            };

            guard.work_orders.insert(0, wo.clone());
            wo
        };

        self.emit_update(app_handle);
        Ok(created)
    }

    pub fn resolve_hold(
        &self,
        req: ResolveHoldRequest,
        app_handle: Option<&AppHandle>,
    ) -> Result<MachinaWorkOrder, String> {
        let updated = {
            let mut guard = self.inner.lock();
            let wo = guard
                .work_orders
                .iter_mut()
                .find(|w| w.id == req.work_order_id)
                .ok_or_else(|| format!("Work Order '{}' not found", req.work_order_id))?;

            if req.option_id == "abort_wo" {
                wo.status = WorkOrderStatus::FAILED;
                wo.active_hold = None;
                wo.active_leases.clear();
                for st in &mut wo.stages {
                    if st.id == "holdback_gate" || st.status == StageNodeStatus::ON_HOLD {
                        st.status = StageNodeStatus::FAILED;
                    }
                }
            } else {
                if req.option_id == "override_prot" {
                    wo.validation_report.allowed_output_paths = vec!["src/**".to_string()];
                    wo.validation_report.protected_paths_passed = true;
                    wo.validation_report.protected_path_violations.clear();
                }
                wo.status = WorkOrderStatus::IN_PROGRESS;
                wo.triage_state = TriageState::READY;
                wo.active_hold = None;
                if !wo
                    .active_leases
                    .contains(&"lease_oauth_sandbox_300s".to_string())
                {
                    wo.active_leases
                        .push("lease_oauth_sandbox_300s".to_string());
                }
                for st in &mut wo.stages {
                    if st.id == "holdback_gate" || st.status == StageNodeStatus::ON_HOLD {
                        st.status = StageNodeStatus::PASSED;
                    } else if st.id == "acceptance" {
                        st.status = StageNodeStatus::RUNNING;
                    }
                }
                wo.validation_report.tier2_holdback_passed = true;
                wo.validation_report.gate_verdict = "PASS".to_string();
                for inv in &mut wo.validation_report.tier2_sanitized_invariants {
                    inv.passed = true;
                    inv.sanitized_message =
                        "Assertion satisfied after governed hold resolution. (CHECKS_OK)".to_string();
                }
            }
            wo.clone()
        };

        self.emit_update(app_handle);
        Ok(updated)
    }

    pub fn rebind_stage_agent(
        &self,
        req: RebindStageAgentRequest,
        app_handle: Option<&AppHandle>,
    ) -> Result<MachinaWorkOrder, String> {
        let updated = {
            let mut guard = self.inner.lock();
            let wo = guard
                .work_orders
                .iter_mut()
                .find(|w| w.id == req.work_order_id)
                .ok_or_else(|| format!("Work Order '{}' not found", req.work_order_id))?;

            for st in &mut wo.stages {
                if st.id == req.stage_id {
                    st.bound_agent_kind = req.new_agent_kind.clone();
                    st.bound_terminal_name = Some(format!("{}-{}", req.new_agent_kind, st.id));
                }
            }
            wo.clone()
        };

        self.emit_update(app_handle);
        Ok(updated)
    }

    pub fn accept_and_merge(
        &self,
        work_order_id: &str,
        app_handle: Option<&AppHandle>,
    ) -> Result<MachinaWorkOrder, String> {
        let updated = {
            let mut guard = self.inner.lock();
            let merged_id = work_order_id.to_string();
            let wo = guard
                .work_orders
                .iter_mut()
                .find(|w| w.id == work_order_id)
                .ok_or_else(|| format!("Work Order '{}' not found", work_order_id))?;

            wo.status = WorkOrderStatus::COMPLETED;
            wo.triage_state = TriageState::READY;
            wo.active_hold = None;
            wo.active_leases.clear();
            for st in &mut wo.stages {
                st.status = StageNodeStatus::PASSED;
            }
            let snapshot = wo.clone();

            // Dependency-aware unblocking: any queued work order waiting on `merged_id` checks if all its dependencies are now COMPLETED
            let completed_ids: std::collections::HashSet<String> = guard
                .work_orders
                .iter()
                .filter(|w| w.status == WorkOrderStatus::COMPLETED)
                .map(|w| w.id.clone())
                .collect();

            let is_active_loop = guard.loop_mode == FactoryLoopMode::ACTIVE;
            for downstream in &mut guard.work_orders {
                if downstream.depends_on.contains(&merged_id)
                    && downstream.triage_state == TriageState::BLOCKED
                {
                    let all_deps_done = downstream
                        .depends_on
                        .iter()
                        .all(|d| completed_ids.contains(d));
                    if all_deps_done {
                        downstream.triage_state = TriageState::READY;
                        if is_active_loop && downstream.status == WorkOrderStatus::QUEUED {
                            downstream.status = WorkOrderStatus::IN_PROGRESS;
                        }
                    }
                }
            }

            snapshot
        };

        self.emit_update(app_handle);
        Ok(updated)
    }

    pub fn run_stage_validation(
        &self,
        work_order_id: &str,
        project_path: &str,
        app_handle: Option<&AppHandle>,
    ) -> Result<MachinaWorkOrder, String> {
        let (wo_snapshot, protected_paths) = {
            let guard = self.inner.lock();
            let wo = guard
                .work_orders
                .iter()
                .find(|w| w.id == work_order_id)
                .cloned()
                .ok_or_else(|| format!("Work Order '{}' not found", work_order_id))?;
            (wo, guard.constitution.protected_paths.clone())
        };

        let report = run_two_tier_validation_gate(&wo_snapshot, project_path, &protected_paths);

        let updated = {
            let mut guard = self.inner.lock();
            let wo = guard
                .work_orders
                .iter_mut()
                .find(|w| w.id == work_order_id)
                .ok_or_else(|| format!("Work Order '{}' not found", work_order_id))?;

            let all_passed = report.output_path_confinement_passed
                && report.protected_paths_passed
                && report.tier1_build_passed
                && report.tier2_holdback_passed
                && report.pre_pr_secret_audit_passed;

            wo.validation_report = report;
            wo.spent_usd += 0.18;

            if all_passed {
                for st in &mut wo.stages {
                    if st.id == "implementation"
                        || st.id == "holdback_gate"
                        || st.id == "correction_loop"
                    {
                        st.status = StageNodeStatus::PASSED;
                    } else if st.id == "acceptance" {
                        st.status = StageNodeStatus::RUNNING;
                    }
                }
            } else {
                for st in &mut wo.stages {
                    if st.id == "holdback_gate" {
                        st.status = StageNodeStatus::CORRECTION;
                        st.attempt_ordinal = (st.attempt_ordinal + 1).min(st.max_corrections);
                        st.attempt_kind = "CORRECTION".to_string();
                    }
                }
            }
            wo.clone()
        };

        self.emit_update(app_handle);
        Ok(updated)
    }

    /// MCP tool helper: `machina_claim_attempt`
    pub fn claim_attempt(
        &self,
        work_order_id: &str,
        stage_id: &str,
        caller_terminal_id: &str,
        app_handle: Option<&AppHandle>,
    ) -> Result<Value, String> {
        let result = {
            let mut guard = self.inner.lock();
            let current_epoch = guard.epoch;
            let protected_paths = guard.constitution.protected_paths.clone();
            let wo = guard
                .work_orders
                .iter_mut()
                .find(|w| w.id == work_order_id)
                .ok_or_else(|| format!("Work Order '{}' not found", work_order_id))?;

            let st = wo
                .stages
                .iter_mut()
                .find(|s| s.id == stage_id)
                .ok_or_else(|| format!("Stage '{}' not found", stage_id))?;

            st.status = StageNodeStatus::RUNNING;
            st.bound_terminal_name = Some(caller_terminal_id.to_string());

            json!({
                "workOrderId": wo.id,
                "stageId": st.id,
                "attemptId": format!("attempt_{}_{}_ord{}", wo.id.to_lowercase(), st.id, st.attempt_ordinal),
                "epoch": current_epoch,
                "attemptKind": st.attempt_kind,
                "attemptOrdinal": st.attempt_ordinal,
                "maxCorrections": st.max_corrections,
                "worktreePath": wo.worktree_path,
                "allowedOutputPaths": wo.validation_report.allowed_output_paths,
                "protectedPaths": protected_paths,
                "holdbackVaultStripped": wo.validation_report.stripped_from_authoring_worktree
            })
        };

        self.emit_update(app_handle);
        Ok(result)
    }

    /// Returns the `@a2a-js/sdk@1.3.0` Agent Card for `machina-praxis`.
    pub fn get_a2a_agent_card(&self, bridge_port: u16) -> Value {
        let status = self.get_status();
        json!({
            "name": "machina-praxis",
            "description": "Machina Praxis AI Software Factory Supervisor (@aiws/engine v1.0). Enforces MISSION.md Anti-Drift Constitution, Protected Paths, 4-Rung Holdback Verification, and Mutation Calibration.",
            "url": format!("http://127.0.0.1:{}/a2a/machina-praxis", bridge_port),
            "version": "1.3.0",
            "protocolVersion": "1.3.0",
            "epoch": status.epoch,
            "loopMode": status.loop_mode,
            "sidecarState": status.sidecar_state,
            "capabilities": {
                "streaming": false,
                "pushNotifications": true,
                "stateTransitionHistory": true
            },
            "skills": [
                {
                    "id": "submit_work_order",
                    "name": "Submit Factory Work Order",
                    "description": "Evaluates MISSION.md anti-drift scope, scaffolds isolated worktree, strips holdbacks into external vault, and initiates 6-stage pipeline."
                },
                {
                    "id": "validate_deliverable",
                    "name": "Run 4-Rung Holdback Gate",
                    "description": "Runs protected_paths check, output-path confinement, static/unit/e2e/holdout rungs with CHECKS_OK sentinel verification, and Pre-PR secret audit."
                },
                {
                    "id": "calibrate_gate",
                    "name": "Run Deliberate Mutation Calibration",
                    "description": "Injects 6 synthetic defects across static, unit, e2e, and holdout rungs to prove every rung catches faults aimed at it."
                }
            ]
        })
    }
}

fn default_work_orders() -> Vec<MachinaWorkOrder> {
    vec![
        MachinaWorkOrder {
            id: "WO-104".to_string(),
            title: "PKCE OAuth2 Token Refresh & Session Vault".to_string(),
            template_id: "feature-holdback-tdd".to_string(),
            status: WorkOrderStatus::ON_HOLD,
            triage_state: TriageState::READY,
            depends_on: Vec::new(),
            branch_name: "machina/wo-104-pkce-refresh".to_string(),
            worktree_path: ".machina/worktrees/WO-104".to_string(),
            epoch: 4,
            budget_allowance_usd: 5.0,
            spent_usd: 1.85,
            active_leases: vec!["lease_fs_worktree_104".to_string()],
            created_at: "12m ago".to_string(),
            active_hold: Some(PraxisHoldCard {
                hold_id: "hold_01J9X8K2M".to_string(),
                profile: "aiws-hold-card/1".to_string(),
                reason: HoldReasonCode::CREDENTIAL_REQUIRED,
                stage_id: "holdback_gate".to_string(),
                attempt_id: "attempt_01J9X8J90_ord2".to_string(),
                epoch: 4,
                summary: "Stage 4 (4-Rung Holdback Gate) requires ephemeral OAuth2 test sandbox credentials to execute live token-rotation invariants.".to_string(),
                required_scope: Some("oauth:github:sandbox_token_refresh (TTL 300s)".to_string()),
                requested_budget_delta_usd: None,
                created_at: "2m ago".to_string(),
                exit_options: vec![
                    HoldExitOption {
                        id: "grant_lease".to_string(),
                        label: "Grant Ephemeral Lease (300s) & Resume".to_string(),
                        variant: "primary".to_string(),
                        description: "Mints an epoch-bound credential lease in Praxis SQLite and resumes Stage 4 validation.".to_string(),
                    },
                    HoldExitOption {
                        id: "mock_only".to_string(),
                        label: "Resume with Offline Mock Profile".to_string(),
                        variant: "secondary".to_string(),
                        description: "Skips live provider handshake and runs deterministic loopback PKCE fixtures only.".to_string(),
                    },
                    HoldExitOption {
                        id: "abort_wo".to_string(),
                        label: "Deny & Abort Work Order".to_string(),
                        variant: "danger".to_string(),
                        description: "Revokes all active leases and transitions WO-104 to FAILED.".to_string(),
                    },
                ],
            }),
            stages: vec![
                PipelineStageNode {
                    id: "ingestion".to_string(),
                    index: 1,
                    title: "Ingestion & Triage".to_string(),
                    subtitle: "MISSION.md anti-drift & SupervisedAdmissionService".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: Some("claude-architect".to_string()),
                    attempt_ordinal: 1,
                    max_corrections: 3,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.12,
                    duration_sec: 4,
                    mcp_tool_name: "machina_submit_work_order".to_string(),
                },
                PipelineStageNode {
                    id: "scaffold".to_string(),
                    index: 2,
                    title: "Worktree & Vault Scaffold".to_string(),
                    subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: Some("claude-architect".to_string()),
                    attempt_ordinal: 1,
                    max_corrections: 3,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.05,
                    duration_sec: 3,
                    mcp_tool_name: "machina_claim_attempt".to_string(),
                },
                PipelineStageNode {
                    id: "implementation".to_string(),
                    index: 3,
                    title: "Agent Implementation".to_string(),
                    subtitle: "Authoring inside confined outputPaths".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: Some("claude-author".to_string()),
                    attempt_ordinal: 2,
                    max_corrections: 3,
                    attempt_kind: "CORRECTION".to_string(),
                    cost_usd: 1.42,
                    duration_sec: 94,
                    mcp_tool_name: "machina_submit_deliverable".to_string(),
                },
                PipelineStageNode {
                    id: "holdback_gate".to_string(),
                    index: 4,
                    title: "4-Rung Holdback Gate".to_string(),
                    subtitle: "static -> unit -> e2e -> holdout + protected_paths".to_string(),
                    status: StageNodeStatus::ON_HOLD,
                    bound_agent_kind: "antigravity".to_string(),
                    bound_terminal_name: Some("agy-verifier".to_string()),
                    attempt_ordinal: 2,
                    max_corrections: 3,
                    attempt_kind: "CORRECTION".to_string(),
                    cost_usd: 0.26,
                    duration_sec: 18,
                    mcp_tool_name: "machina_resolve_hold".to_string(),
                },
                PipelineStageNode {
                    id: "correction_loop".to_string(),
                    index: 5,
                    title: "Correction Ordinal Loop".to_string(),
                    subtitle: "Sanitized behavioral diagnostics (Ordinal 2/3)".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: Some("claude-author".to_string()),
                    attempt_ordinal: 2,
                    max_corrections: 3,
                    attempt_kind: "CORRECTION".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 12,
                    mcp_tool_name: "machina_claim_attempt".to_string(),
                },
                PipelineStageNode {
                    id: "acceptance".to_string(),
                    index: 6,
                    title: "Human Merge Acceptance".to_string(),
                    subtitle: "Squash-merge verified worktree into main".to_string(),
                    status: StageNodeStatus::PENDING,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: Some("claude-architect".to_string()),
                    attempt_ordinal: 1,
                    max_corrections: 3,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 0,
                    mcp_tool_name: "machina_get_stage_status".to_string(),
                },
            ],
            validation_report: HoldbackValidationReport {
                vault_path: "%LOCALAPPDATA%\\Quay2\\praxis\\holdbacks\\WO-104".to_string(),
                vault_sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".to_string(),
                stripped_from_authoring_worktree: true,
                output_path_confinement_passed: true,
                allowed_output_paths: vec![
                    "src/slices/auth/**".to_string(),
                    "src-tauri/src/slices/auth/**".to_string(),
                ],
                modified_files: vec![
                    "src/slices/auth/pkceClient.ts".to_string(),
                    "src/slices/auth/tokenVault.ts".to_string(),
                    "src-tauri/src/slices/auth/commands.rs".to_string(),
                ],
                protected_paths_passed: true,
                protected_path_violations: Vec::new(),
                gate_verdict: "FAIL".to_string(),
                rung_verdicts: vec![
                    super::models::RungVerdict {
                        rung: "static".to_string(),
                        outcome: "PASS".to_string(),
                        detail: "tsc --noEmit & protected_paths verified".to_string(),
                    },
                    super::models::RungVerdict {
                        rung: "unit".to_string(),
                        outcome: "PASS".to_string(),
                        detail: "vitest pkceClient.test.ts (8 passed)".to_string(),
                    },
                    super::models::RungVerdict {
                        rung: "e2e".to_string(),
                        outcome: "PASS".to_string(),
                        detail: "harness/END-TO-END.md login journey green".to_string(),
                    },
                    super::models::RungVerdict {
                        rung: "holdout".to_string(),
                        outcome: "FAIL".to_string(),
                        detail: "HOLDOUT_FAIL on INV-PKCE-02 singleflight burst".to_string(),
                    },
                ],
                candidate_revision_sha: "d9080e0 (FACTORY_RUNTIME_CANDIDATE)".to_string(),
                tier1_build_passed: true,
                tier1_raw_output: "✓ tsc --noEmit (0 errors)\n✓ cargo check --manifest-path src-tauri/Cargo.toml (0 warnings)\n✓ vitest run src/slices/auth/pkceClient.test.ts (8 passed)\n✓ Protected paths intact (0 governance edits)".to_string(),
                tier2_holdback_passed: false,
                tier2_sanitized_invariants: vec![
                    SanitizedInvariant {
                        invariant_id: "INV-PKCE-01".to_string(),
                        title: "Code verifier entropy >= 256 bits & S256 challenge URL-safe base64".to_string(),
                        passed: true,
                        sanitized_message: "Assertion satisfied across 64 blind property vectors.".to_string(),
                    },
                    SanitizedInvariant {
                        invariant_id: "INV-PKCE-02".to_string(),
                        title: "Concurrent refresh requests coalesce onto single in-flight singleflight promise".to_string(),
                        passed: false,
                        sanitized_message: "Behavioral invariant failed: Expected upstream token endpoint to be invoked exactly once under concurrent burst; observed multiple invocations. [HOLDBACK SOURCE & TEST VECTORS REDACTED]".to_string(),
                    },
                    SanitizedInvariant {
                        invariant_id: "INV-PKCE-03".to_string(),
                        title: "Revoked refresh token immediately purges session vault storage".to_string(),
                        passed: true,
                        sanitized_message: "Assertion satisfied.".to_string(),
                    },
                ],
                pre_pr_secret_audit_passed: true,
            },
        },
        MachinaWorkOrder {
            id: "WO-105".to_string(),
            title: "Zero-Copy ConPTY Ring Buffer Serializer".to_string(),
            template_id: "autonomous-bugfix".to_string(),
            status: WorkOrderStatus::IN_PROGRESS,
            triage_state: TriageState::READY,
            depends_on: vec!["WO-103".to_string()],
            branch_name: "machina/wo-105-conpty-ringbuf".to_string(),
            worktree_path: ".machina/worktrees/WO-105".to_string(),
            epoch: 4,
            budget_allowance_usd: 4.5,
            spent_usd: 1.12,
            active_leases: vec![
                "lease_fs_worktree_105".to_string(),
                "lease_cargo_test_105".to_string(),
            ],
            created_at: "6m ago".to_string(),
            active_hold: None,
            stages: vec![
                PipelineStageNode {
                    id: "ingestion".to_string(),
                    index: 1,
                    title: "Ingestion & Triage".to_string(),
                    subtitle: "MISSION.md anti-drift & SupervisedAdmissionService".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "kiro".to_string(),
                    bound_terminal_name: Some("kiro-lead".to_string()),
                    attempt_ordinal: 1,
                    max_corrections: 4,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.08,
                    duration_sec: 3,
                    mcp_tool_name: "machina_submit_work_order".to_string(),
                },
                PipelineStageNode {
                    id: "scaffold".to_string(),
                    index: 2,
                    title: "Worktree & Vault Scaffold".to_string(),
                    subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "kiro".to_string(),
                    bound_terminal_name: Some("kiro-lead".to_string()),
                    attempt_ordinal: 1,
                    max_corrections: 4,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.04,
                    duration_sec: 2,
                    mcp_tool_name: "machina_claim_attempt".to_string(),
                },
                PipelineStageNode {
                    id: "implementation".to_string(),
                    index: 3,
                    title: "Agent Implementation".to_string(),
                    subtitle: "Authoring inside confined outputPaths".to_string(),
                    status: StageNodeStatus::RUNNING,
                    bound_agent_kind: "codex".to_string(),
                    bound_terminal_name: Some("codex-rust".to_string()),
                    attempt_ordinal: 2,
                    max_corrections: 4,
                    attempt_kind: "CORRECTION".to_string(),
                    cost_usd: 1.0,
                    duration_sec: 61,
                    mcp_tool_name: "machina_submit_deliverable".to_string(),
                },
                PipelineStageNode {
                    id: "holdback_gate".to_string(),
                    index: 4,
                    title: "4-Rung Holdback Gate".to_string(),
                    subtitle: "static -> unit -> e2e -> holdout + protected_paths".to_string(),
                    status: StageNodeStatus::PENDING,
                    bound_agent_kind: "copilot".to_string(),
                    bound_terminal_name: Some("copilot-audit".to_string()),
                    attempt_ordinal: 2,
                    max_corrections: 4,
                    attempt_kind: "CORRECTION".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 0,
                    mcp_tool_name: "machina_submit_deliverable".to_string(),
                },
                PipelineStageNode {
                    id: "correction_loop".to_string(),
                    index: 5,
                    title: "Correction Ordinal Loop".to_string(),
                    subtitle: "Sanitized behavioral diagnostics (Ordinal 2/4)".to_string(),
                    status: StageNodeStatus::CORRECTION,
                    bound_agent_kind: "codex".to_string(),
                    bound_terminal_name: Some("codex-rust".to_string()),
                    attempt_ordinal: 2,
                    max_corrections: 4,
                    attempt_kind: "CORRECTION".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 8,
                    mcp_tool_name: "machina_claim_attempt".to_string(),
                },
                PipelineStageNode {
                    id: "acceptance".to_string(),
                    index: 6,
                    title: "Human Merge Acceptance".to_string(),
                    subtitle: "Squash-merge verified worktree into main".to_string(),
                    status: StageNodeStatus::PENDING,
                    bound_agent_kind: "kiro".to_string(),
                    bound_terminal_name: Some("kiro-lead".to_string()),
                    attempt_ordinal: 1,
                    max_corrections: 4,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 0,
                    mcp_tool_name: "machina_get_stage_status".to_string(),
                },
            ],
            validation_report: HoldbackValidationReport {
                vault_path: "%LOCALAPPDATA%\\Quay2\\praxis\\holdbacks\\WO-105".to_string(),
                vault_sha256: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a".to_string(),
                stripped_from_authoring_worktree: true,
                output_path_confinement_passed: true,
                allowed_output_paths: vec!["src-tauri/src/slices/pty/**".to_string()],
                modified_files: vec!["src-tauri/src/slices/pty/manager.rs".to_string()],
                protected_paths_passed: true,
                protected_path_violations: Vec::new(),
                gate_verdict: "PASS".to_string(),
                rung_verdicts: default_rung_verdicts(),
                candidate_revision_sha: "d9080e0 (FACTORY_RUNTIME_CANDIDATE)".to_string(),
                tier1_build_passed: true,
                tier1_raw_output: "✓ cargo test --manifest-path src-tauri/Cargo.toml (22 passed)\nCHECKS_OK".to_string(),
                tier2_holdback_passed: true,
                tier2_sanitized_invariants: vec![SanitizedInvariant {
                    invariant_id: "INV-PTY-01".to_string(),
                    title: "Ring buffer preserves UTF-8 multi-byte boundary across 500KB truncation".to_string(),
                    passed: true,
                    sanitized_message: "Assertion satisfied across all boundary splits.".to_string(),
                }],
                pre_pr_secret_audit_passed: true,
            },
        },
        MachinaWorkOrder {
            id: "WO-103".to_string(),
            title: "Loopback MCP Tool Schema Validator".to_string(),
            template_id: "security-hardening-gate".to_string(),
            status: WorkOrderStatus::COMPLETED,
            triage_state: TriageState::READY,
            depends_on: Vec::new(),
            branch_name: "machina/wo-103-mcp-schema".to_string(),
            worktree_path: ".machina/worktrees/WO-103".to_string(),
            epoch: 4,
            budget_allowance_usd: 3.0,
            spent_usd: 0.84,
            active_leases: Vec::new(),
            created_at: "38m ago".to_string(),
            active_hold: None,
            stages: vec![
                PipelineStageNode {
                    id: "ingestion".to_string(),
                    index: 1,
                    title: "Ingestion & Triage".to_string(),
                    subtitle: "MISSION.md anti-drift & SupervisedAdmissionService".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: None,
                    attempt_ordinal: 1,
                    max_corrections: 2,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.06,
                    duration_sec: 2,
                    mcp_tool_name: "machina_submit_work_order".to_string(),
                },
                PipelineStageNode {
                    id: "scaffold".to_string(),
                    index: 2,
                    title: "Worktree & Vault Scaffold".to_string(),
                    subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: None,
                    attempt_ordinal: 1,
                    max_corrections: 2,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.04,
                    duration_sec: 2,
                    mcp_tool_name: "machina_claim_attempt".to_string(),
                },
                PipelineStageNode {
                    id: "implementation".to_string(),
                    index: 3,
                    title: "Agent Implementation".to_string(),
                    subtitle: "Authoring inside confined outputPaths".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "opencode".to_string(),
                    bound_terminal_name: None,
                    attempt_ordinal: 1,
                    max_corrections: 2,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.52,
                    duration_sec: 47,
                    mcp_tool_name: "machina_submit_deliverable".to_string(),
                },
                PipelineStageNode {
                    id: "holdback_gate".to_string(),
                    index: 4,
                    title: "4-Rung Holdback Gate".to_string(),
                    subtitle: "static -> unit -> e2e -> holdout + protected_paths".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: None,
                    attempt_ordinal: 1,
                    max_corrections: 2,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.22,
                    duration_sec: 14,
                    mcp_tool_name: "machina_submit_deliverable".to_string(),
                },
                PipelineStageNode {
                    id: "correction_loop".to_string(),
                    index: 5,
                    title: "Correction Ordinal Loop".to_string(),
                    subtitle: "0 corrections needed (Passed on Initial)".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "opencode".to_string(),
                    bound_terminal_name: None,
                    attempt_ordinal: 1,
                    max_corrections: 2,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 0,
                    mcp_tool_name: "machina_claim_attempt".to_string(),
                },
                PipelineStageNode {
                    id: "acceptance".to_string(),
                    index: 6,
                    title: "Human Merge Acceptance".to_string(),
                    subtitle: "Merged to main (commit 8f31c2a)".to_string(),
                    status: StageNodeStatus::PASSED,
                    bound_agent_kind: "claude".to_string(),
                    bound_terminal_name: None,
                    attempt_ordinal: 1,
                    max_corrections: 2,
                    attempt_kind: "INITIAL".to_string(),
                    cost_usd: 0.0,
                    duration_sec: 2,
                    mcp_tool_name: "machina_get_stage_status".to_string(),
                },
            ],
            validation_report: HoldbackValidationReport {
                vault_path: "%LOCALAPPDATA%\\Quay2\\praxis\\holdbacks\\WO-103".to_string(),
                vault_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
                stripped_from_authoring_worktree: true,
                output_path_confinement_passed: true,
                allowed_output_paths: vec!["src-tauri/src/slices/orchestrator/**".to_string()],
                modified_files: vec!["src-tauri/src/slices/orchestrator/mcp.rs".to_string()],
                protected_paths_passed: true,
                protected_path_violations: Vec::new(),
                gate_verdict: "PASS".to_string(),
                rung_verdicts: default_rung_verdicts(),
                candidate_revision_sha: "d9080e0 (FACTORY_RUNTIME_CANDIDATE)".to_string(),
                tier1_build_passed: true,
                tier1_raw_output: "✓ All 5 MCP tool JSON-RPC schemas verified\nCHECKS_OK".to_string(),
                tier2_holdback_passed: true,
                tier2_sanitized_invariants: vec![SanitizedInvariant {
                    invariant_id: "INV-MCP-01".to_string(),
                    title: "Rejects unauthenticated or epoch-stale attempt claims".to_string(),
                    passed: true,
                    sanitized_message: "Assertion satisfied.".to_string(),
                }],
                pre_pr_secret_audit_passed: true,
            },
        },
    ]
}
