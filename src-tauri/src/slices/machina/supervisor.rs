//! `MachinaManager`: the work order state machine.
//!
//! State lives in memory behind one mutex and is written to
//! `%LOCALAPPDATA%\Quay2\machina\state.json` after every change, while the lock is
//! held, so writes land in the order the changes happened. Long work (scaffolding and
//! gates) runs on background threads that never hold the lock while git or a gate
//! command runs. At most one such job runs per work order; the `jobs` map enforces it.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::config::{
    find_scope_drift, load_config, load_config_pinned, unapproved_reason, FactoryConfig,
    FACTORY_MANAGED, FEEDBACK_REL_DIR, HOLDBACKS_REL_DIR, WORKTREES_REL_DIR,
};
use super::gate::{run_check, run_gate, GateInput};
use super::git::{self, native_path};
use super::models::{
    CheckOutcome, FactoryLoopMode, GateReport, GateVerdict, HoldCard, HoldOption, HoldReason,
    MachinaStatusPayload, MachinaWorkOrder, ResolveHoldRequest, SpendSnapshot, StageRecord,
    StageStatus, SubmitWorkOrderRequest, VaultInfo, WorkOrderEvent, WorkOrderStatus, MAX_EVENTS,
    STAGE_IDS,
};
use super::paths::{patterns_overlap, validate_patterns};
use super::spend;
use super::vault::{self, default_vault_root, machina_data_dir};
use crate::dates::now_ms;
use crate::slices::pty::{PtyManager, RunKind};

const STATE_VERSION: u32 = 2;
const MAX_TITLE_CHARS: usize = 200;
const MAX_OBJECTIVE_CHARS: usize = 20_000;
const MAX_CORRECTIONS_LIMIT: u32 = 10;
const MAX_BUDGET_USD: f64 = 10_000.0;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    version: u32,
    epoch: u64,
    next_id: u64,
    loop_mode: FactoryLoopMode,
    /// Repository (`git::path_key`) to the SHA-256 of the factory.json the operator approved.
    #[serde(default)]
    approved_configs: BTreeMap<String, String>,
    work_orders: Vec<MachinaWorkOrder>,
}

struct Inner {
    loop_mode: FactoryLoopMode,
    epoch: u64,
    next_id: u64,
    session_started_at_ms: i64,
    approved_configs: BTreeMap<String, String>,
    /// Newest first.
    work_orders: Vec<MachinaWorkOrder>,
}

/// Receives the factory status after every change; the app forwards it as the
/// `machina-state-updated` event.
pub type StatusListener = Arc<dyn Fn(MachinaStatusPayload) + Send + Sync>;

/// Outcome of asking for a gate run.
pub enum GateStart {
    Started(u32),
    /// The work order went on hold instead (measured spend reached the budget).
    Held(String),
}

#[derive(Clone)]
pub struct MachinaManager {
    inner: Arc<Mutex<Inner>>,
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    listener: Arc<Mutex<Option<StatusListener>>>,
    pty: Arc<Mutex<Option<PtyManager>>>,
    state_path: PathBuf,
    vault_root: PathBuf,
}

// ---------------------------------------------------------------------------
// Input parsing (boundary checks for every request).
// ---------------------------------------------------------------------------

/// Accepts `WO-12` (any case, surrounding spaces) and returns the canonical form.
pub fn parse_wo_id(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    let digits = s
        .get(..3)
        .filter(|p| p.eq_ignore_ascii_case("WO-"))
        .map(|_| &s[3..])
        .ok_or_else(|| format!("'{}' is not a work order id (expected WO-<number>)", s))?;
    let valid = !digits.is_empty()
        && digits.len() <= 9
        && digits.bytes().all(|b| b.is_ascii_digit())
        && !digits.starts_with('0');
    if valid {
        Ok(format!("WO-{}", digits))
    } else {
        Err(format!("'{}' is not a work order id (expected WO-<number>)", s))
    }
}

fn parse_agent(raw: &str) -> Result<String, String> {
    let kind: RunKind = serde_json::from_value(Value::String(raw.trim().to_lowercase()))
        .map_err(|_| format!("'{}' is not a known agent", raw.trim()))?;
    if kind.is_agent() {
        Ok(kind.as_str().to_string())
    } else {
        Err(format!("'{}' is not an agent CLI", raw.trim()))
    }
}

fn parse_text(label: &str, raw: &str, max: usize) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(format!("{} is required", label));
    }
    if s.chars().count() > max {
        return Err(format!("{} is longer than {} characters", label, max));
    }
    Ok(s.to_string())
}

// ---------------------------------------------------------------------------
// Small helpers over a work order.
// ---------------------------------------------------------------------------

fn new_stages(now: i64) -> Vec<StageRecord> {
    STAGE_IDS
        .iter()
        .map(|id| StageRecord {
            id: id.to_string(),
            status: StageStatus::PENDING,
            started_at_ms: None,
            finished_at_ms: None,
            detail: String::new(),
        })
        .map(|mut s| {
            if s.id == "admission" {
                s.status = StageStatus::RUNNING;
                s.started_at_ms = Some(now);
            }
            s
        })
        .collect()
}

fn stage<'a>(wo: &'a mut MachinaWorkOrder, id: &str) -> &'a mut StageRecord {
    let idx = wo
        .stages
        .iter()
        .position(|s| s.id == id)
        .expect("every work order has all six stages");
    &mut wo.stages[idx]
}

/// Moves a stage to `status`, stamping start and finish times as it goes.
fn set_stage(wo: &mut MachinaWorkOrder, id: &str, status: StageStatus, detail: impl Into<String>) {
    let now = now_ms();
    let st = stage(wo, id);
    if status == StageStatus::RUNNING {
        if st.status != StageStatus::RUNNING {
            st.started_at_ms = Some(now);
        }
        st.finished_at_ms = None;
    } else if status != StageStatus::PENDING {
        st.started_at_ms.get_or_insert(now);
        st.finished_at_ms = Some(now);
    }
    st.status = status;
    st.detail = detail.into();
}

fn push_event(wo: &mut MachinaWorkOrder, message: impl Into<String>) {
    wo.events.push(WorkOrderEvent {
        at_ms: now_ms(),
        message: message.into(),
    });
    if wo.events.len() > MAX_EVENTS {
        let excess = wo.events.len() - MAX_EVENTS;
        wo.events.drain(..excess);
    }
}

fn option(id: &str, label: &str, description: &str, variant: &str) -> HoldOption {
    HoldOption {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        variant: variant.to_string(),
    }
}

fn abort_option() -> HoldOption {
    option(
        "abort",
        "Abort the work order",
        "Stops the work order. The worktree and branch stay until you remove them.",
        "danger",
    )
}

fn hold(reason: HoldReason, summary: String, options: Vec<HoldOption>) -> HoldCard {
    HoldCard {
        reason,
        summary,
        created_at_ms: now_ms(),
        options,
    }
}

fn short(sha: &str) -> &str {
    sha.get(..10).unwrap_or(sha)
}

fn flatten(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn deps_done(work_orders: &[MachinaWorkOrder], deps: &[String]) -> bool {
    deps.iter().all(|d| {
        work_orders
            .iter()
            .any(|w| &w.id == d && w.status == WorkOrderStatus::COMPLETED)
    })
}

fn open_deps(work_orders: &[MachinaWorkOrder], deps: &[String]) -> Vec<String> {
    deps.iter()
        .filter(|d| {
            !work_orders
                .iter()
                .any(|w| &w.id == *d && w.status == WorkOrderStatus::COMPLETED)
        })
        .cloned()
        .collect()
}

/// After admission passes: queue the work order or mark it for scaffolding.
/// Returns true when the caller must start the scaffold job.
fn route_after_admission(
    wo: &mut MachinaWorkOrder,
    loop_mode: FactoryLoopMode,
    open: &[String],
) -> bool {
    if !open.is_empty() {
        wo.status = WorkOrderStatus::QUEUED;
        push_event(wo, format!("Queued until {} merge.", open.join(", ")));
        false
    } else if loop_mode != FactoryLoopMode::ACTIVE {
        wo.status = WorkOrderStatus::QUEUED;
        push_event(wo, format!("Queued because the factory loop is {:?}.", loop_mode));
        false
    } else {
        wo.status = WorkOrderStatus::SCAFFOLDING;
        set_stage(wo, "scaffold", StageStatus::RUNNING, "Creating the worktree");
        true
    }
}

impl Default for MachinaManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MachinaManager {
    pub fn new() -> Self {
        Self::with_paths(machina_data_dir().join("state.json"), default_vault_root())
    }

    pub fn with_paths(state_path: PathBuf, vault_root: PathBuf) -> Self {
        let (epoch, next_id, loop_mode, approved_configs, mut work_orders) =
            match load_state(&state_path) {
                Some(s) => (s.epoch, s.next_id.max(1), s.loop_mode, s.approved_configs, s.work_orders),
                None => (0, 1, FactoryLoopMode::ACTIVE, BTreeMap::new(), Vec::new()),
            };
        let epoch = epoch + 1;

        // Jobs from the previous run died with the process.
        for wo in &mut work_orders {
            if matches!(wo.status, WorkOrderStatus::SCAFFOLDING | WorkOrderStatus::GATING) {
                let was = wo.status;
                wo.status = WorkOrderStatus::INTERRUPTED;
                let running: Vec<String> = wo
                    .stages
                    .iter()
                    .filter(|s| s.status == StageStatus::RUNNING && s.id != "implementation")
                    .map(|s| s.id.clone())
                    .collect();
                for id in running {
                    set_stage(wo, &id, StageStatus::FAILED, "Interrupted when Quay stopped");
                }
                push_event(
                    wo,
                    format!(
                        "{:?} was cut off when Quay stopped; found at startup in epoch {}.",
                        was, epoch
                    ),
                );
            }
        }

        let mgr = Self {
            inner: Arc::new(Mutex::new(Inner {
                loop_mode,
                epoch,
                next_id,
                session_started_at_ms: now_ms(),
                approved_configs,
                work_orders,
            })),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            listener: Arc::new(Mutex::new(None)),
            pty: Arc::new(Mutex::new(None)),
            state_path,
            vault_root,
        };
        {
            let g = mgr.inner.lock();
            mgr.persist_locked(&g);
        }
        mgr
    }

    /// Connects the manager to a status listener and to the terminals (for briefs and
    /// HALT), then starts any queued work orders that are ready.
    pub fn start_supervisor(
        &self,
        on_change: impl Fn(MachinaStatusPayload) + Send + Sync + 'static,
        pty: PtyManager,
    ) {
        *self.listener.lock() = Some(Arc::new(on_change));
        *self.pty.lock() = Some(pty);
        self.start_ready();
        self.emit();
    }

    // -----------------------------------------------------------------------
    // Persistence and events.
    // -----------------------------------------------------------------------

    fn persist_locked(&self, inner: &Inner) {
        let state = PersistedState {
            version: STATE_VERSION,
            epoch: inner.epoch,
            next_id: inner.next_id,
            loop_mode: inner.loop_mode,
            approved_configs: inner.approved_configs.clone(),
            work_orders: inner.work_orders.clone(),
        };
        if let Err(e) = write_state(&self.state_path, &state) {
            tracing::error!("Machina could not save its state: {}", e);
        }
    }

    fn emit(&self) {
        let listener = self.listener.lock().clone();
        if let Some(listener) = listener {
            listener(self.status());
        }
    }

    /// Applies `f` under the lock, persists, then emits once the lock is released.
    fn mutate<R>(&self, f: impl FnOnce(&mut Inner) -> R) -> R {
        let r = {
            let mut g = self.inner.lock();
            let r = f(&mut g);
            self.persist_locked(&g);
            r
        };
        self.emit();
        r
    }

    fn with_wo<R>(
        &self,
        id: &str,
        f: impl FnOnce(&mut MachinaWorkOrder, FactoryLoopMode) -> Result<R, String>,
    ) -> Result<R, String> {
        self.mutate(|inner| {
            let mode = inner.loop_mode;
            let wo = inner
                .work_orders
                .iter_mut()
                .find(|w| w.id == id)
                .ok_or_else(|| format!("Work order {} not found", id))?;
            let r = f(wo, mode)?;
            wo.updated_at_ms = now_ms();
            Ok(r)
        })
    }

    fn get(&self, id: &str) -> Result<MachinaWorkOrder, String> {
        self.inner
            .lock()
            .work_orders
            .iter()
            .find(|w| w.id == id)
            .cloned()
            .ok_or_else(|| format!("Work order {} not found", id))
    }

    // -----------------------------------------------------------------------
    // Background jobs.
    // -----------------------------------------------------------------------

    /// Claims the job slot for `id`; `None` when a job is already running for it.
    fn claim_job(&self, id: &str) -> Option<Arc<AtomicBool>> {
        let mut jobs = self.jobs.lock();
        if jobs.contains_key(id) {
            return None;
        }
        let flag = Arc::new(AtomicBool::new(false));
        jobs.insert(id.to_string(), flag.clone());
        Some(flag)
    }

    /// Frees the slot only if it still holds this job's flag.
    fn release_job(&self, id: &str, flag: &Arc<AtomicBool>) {
        let mut jobs = self.jobs.lock();
        if jobs.get(id).is_some_and(|f| Arc::ptr_eq(f, flag)) {
            jobs.remove(id);
        }
    }

    fn cancel_job(&self, id: &str) {
        if let Some(flag) = self.jobs.lock().get(id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    fn spawn_scaffold(&self, id: String) {
        let Some(cancel) = self.claim_job(&id) else {
            return;
        };
        let mgr = self.clone();
        std::thread::spawn(move || {
            let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                mgr.scaffold_job(&id, &cancel)
            }));
            mgr.release_job(&id, &cancel);
            if run.is_err() {
                mgr.fail_after_panic(&id, "scaffold");
            }
            mgr.emit();
        });
    }

    /// Starts every queued work order whose dependencies have merged, if the loop is
    /// ACTIVE and its admission passed.
    fn start_ready(&self) {
        let ids = self.mutate(|inner| {
            if inner.loop_mode != FactoryLoopMode::ACTIVE {
                return Vec::new();
            }
            let ready: Vec<String> = inner
                .work_orders
                .iter()
                .filter(|w| {
                    w.status == WorkOrderStatus::QUEUED
                        && w.stages.first().is_some_and(|s| s.status == StageStatus::PASSED)
                        && deps_done(&inner.work_orders, &w.depends_on)
                })
                .map(|w| w.id.clone())
                .collect();
            for id in &ready {
                if let Some(wo) = inner.work_orders.iter_mut().find(|w| &w.id == id) {
                    wo.status = WorkOrderStatus::SCAFFOLDING;
                    set_stage(wo, "scaffold", StageStatus::RUNNING, "Creating the worktree");
                    push_event(wo, "Started: dependencies merged and the loop is ACTIVE.");
                }
            }
            ready
        });
        for id in ids {
            self.spawn_scaffold(id);
        }
    }

    // -----------------------------------------------------------------------
    // Queries.
    // -----------------------------------------------------------------------

    pub fn status(&self) -> MachinaStatusPayload {
        let running_jobs = self.jobs.lock().len();
        let g = self.inner.lock();
        let open = g.work_orders.iter().filter(|w| !w.status.is_final());
        MachinaStatusPayload {
            loop_mode: g.loop_mode,
            epoch: g.epoch,
            session_started_at_ms: g.session_started_at_ms,
            state_path: self.state_path.to_string_lossy().to_string(),
            vault_root: self.vault_root.to_string_lossy().to_string(),
            work_order_count: g.work_orders.len(),
            measured_spend_usd: open
                .clone()
                .filter(|w| w.spend.measured)
                .map(|w| w.spend.usd)
                .sum(),
            budget_usd: open.map(|w| w.budget_usd).sum(),
            active_holds: g
                .work_orders
                .iter()
                .filter(|w| w.status == WorkOrderStatus::ON_HOLD)
                .count(),
            running_jobs,
        }
    }

    /// All work orders, newest first, with spend re-measured for open ones.
    pub fn list_work_orders(&self) -> Vec<MachinaWorkOrder> {
        let targets: Vec<(String, String, String)> = self
            .inner
            .lock()
            .work_orders
            .iter()
            .filter(|w| !w.status.is_final() && !w.worktree_removed)
            .map(|w| (w.id.clone(), w.author_agent.clone(), w.worktree_path.clone()))
            .collect();
        let measured: Vec<(String, SpendSnapshot)> = targets
            .into_iter()
            .map(|(id, agent, wt)| (id, spend::measure(&agent, &wt)))
            .collect();

        let mut g = self.inner.lock();
        let mut changed = false;
        for (id, snap) in measured {
            if let Some(wo) = g.work_orders.iter_mut().find(|w| w.id == id) {
                if wo.spend.usd != snap.usd || wo.spend.responses != snap.responses {
                    changed = true;
                }
                wo.spend = snap;
            }
        }
        if changed {
            self.persist_locked(&g);
        }
        g.work_orders.clone()
    }

    pub fn get_work_order(&self, id: &str) -> Result<MachinaWorkOrder, String> {
        self.get(id)
    }

    // -----------------------------------------------------------------------
    // Config approval: commands from factory.json run only when the operator has
    // approved that exact file for that repository.
    // -----------------------------------------------------------------------

    pub fn approved_config(&self, repo_root: &Path) -> Option<String> {
        self.inner
            .lock()
            .approved_configs
            .get(&git::path_key(repo_root))
            .cloned()
    }

    /// Approves the repository's factory.json if its current contents still hash to
    /// `sha256`, the version the operator reviewed.
    pub fn approve_config(&self, repo_root: &Path, sha256: &str) -> Result<(), String> {
        let current = load_config_pinned(repo_root)?
            .sha256
            .ok_or_else(|| format!("{} has no .machina/factory.json to approve", repo_root.display()))?;
        if current != sha256.trim() {
            return Err(
                ".machina/factory.json changed since you reviewed it; review it again before approving"
                    .to_string(),
            );
        }
        self.mutate(|inner| {
            inner.approved_configs.insert(git::path_key(repo_root), current);
        });
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Submission and admission.
    // -----------------------------------------------------------------------

    /// Admits a work order. `submitted_by` names the agent terminal when the request
    /// came over MCP; such work orders wait on hold until a human admits them.
    pub fn submit_work_order(
        &self,
        req: SubmitWorkOrderRequest,
        submitted_by: Option<String>,
    ) -> Result<MachinaWorkOrder, String> {
        let title = parse_text("Title", &req.title, MAX_TITLE_CHARS)?;
        let objective = parse_text("Objective", &req.objective, MAX_OBJECTIVE_CHARS)?;
        let repo_root = git::repo_root(Path::new(req.project_path.trim()))?;
        let (cfg, _) = load_config(&repo_root)?;
        let allowed = validate_patterns(&req.allowed_output_paths)?;
        if allowed.is_empty() {
            return Err("Give at least one allowed output path".to_string());
        }
        let author_agent = parse_agent(&req.author_agent)?;
        if req.max_corrections > MAX_CORRECTIONS_LIMIT {
            return Err(format!(
                "Max corrections must be between 0 and {}",
                MAX_CORRECTIONS_LIMIT
            ));
        }
        if !req.budget_usd.is_finite() || req.budget_usd <= 0.0 || req.budget_usd > MAX_BUDGET_USD
        {
            return Err(format!(
                "Budget must be more than $0 and at most ${}",
                MAX_BUDGET_USD
            ));
        }
        let base_branch = match req.base_branch.as_deref().map(str::trim) {
            Some(b) if !b.is_empty() => git::validate_branch_name(&repo_root, b)?,
            _ => git::current_branch(&repo_root).ok_or(
                "The main checkout has a detached HEAD; name a base branch".to_string(),
            )?,
        };
        let base_sha = git::resolve_commit(&repo_root, &base_branch)?;
        let mut depends_on = Vec::new();
        for d in &req.depends_on {
            if d.trim().is_empty() {
                continue;
            }
            let id = parse_wo_id(d)?;
            if !depends_on.contains(&id) {
                depends_on.push(id);
            }
        }

        let drift = find_scope_drift(&cfg, &format!("{}\n{}", title, objective)).map(String::from);
        let protected = cfg.effective_protected();
        let overlaps: Vec<String> = allowed
            .iter()
            .flat_map(|a| {
                protected
                    .iter()
                    .filter(move |p| patterns_overlap(a, p))
                    .map(move |p| format!("{} overlaps {}", a, p))
            })
            .collect();

        let (created, start) = self.mutate(|inner| -> Result<(MachinaWorkOrder, bool), String> {
            if inner.loop_mode == FactoryLoopMode::HALTED {
                return Err("The factory is HALTED. Set it to ACTIVE or PAUSED first.".to_string());
            }
            for d in &depends_on {
                if !inner.work_orders.iter().any(|w| &w.id == d) {
                    return Err(format!("Dependency {} does not exist", d));
                }
            }
            let id = format!("WO-{}", inner.next_id);
            inner.next_id += 1;
            let now = now_ms();
            let worktree = repo_root.join(native_path(WORKTREES_REL_DIR)).join(&id);
            let mut wo = MachinaWorkOrder {
                id: id.clone(),
                title: title.clone(),
                objective: objective.clone(),
                repo_path: repo_root.to_string_lossy().to_string(),
                base_branch: base_branch.clone(),
                base_sha: base_sha.clone(),
                branch_name: format!("machina/{}", id.to_lowercase()),
                worktree_path: worktree.to_string_lossy().to_string(),
                author_agent: author_agent.clone(),
                author_terminal_id: None,
                allowed_output_paths: allowed.clone(),
                depends_on: depends_on.clone(),
                max_corrections: req.max_corrections,
                attempts: 0,
                budget_usd: req.budget_usd,
                spend: SpendSnapshot::default(),
                status: WorkOrderStatus::QUEUED,
                stages: new_stages(now),
                hold: None,
                vault: None,
                setup_checks: Vec::new(),
                last_gate: None,
                merge_commit: None,
                worktree_removed: false,
                error: None,
                epoch: inner.epoch,
                created_at_ms: now,
                updated_at_ms: now,
                events: Vec::new(),
            };
            push_event(
                &mut wo,
                format!("Submitted against {} at {}.", base_branch, short(&base_sha)),
            );

            let mut start = false;
            if let Some(rule) = &drift {
                wo.status = WorkOrderStatus::ON_HOLD;
                set_stage(&mut wo, "admission", StageStatus::ON_HOLD, format!("Matches out-of-scope rule \"{}\"", rule));
                wo.hold = Some(hold(
                    HoldReason::SCOPE_DRIFT,
                    format!(
                        "The title or objective contains \"{}\", which .machina/factory.json lists as out of scope.",
                        rule
                    ),
                    vec![
                        option("admit_anyway", "Admit anyway", "Overrides the out-of-scope rule for this work order only.", "secondary"),
                        abort_option(),
                    ],
                ));
                push_event(&mut wo, format!("Held: out-of-scope rule \"{}\".", rule));
            } else if !overlaps.is_empty() {
                wo.status = WorkOrderStatus::ON_HOLD;
                set_stage(&mut wo, "admission", StageStatus::ON_HOLD, "Allowed paths overlap protected paths");
                wo.hold = Some(hold(
                    HoldReason::PROTECTED_PATH_OVERLAP,
                    format!(
                        "Allowed output paths overlap protected paths: {}. The gate fails any change to a protected file either way.",
                        overlaps.join("; ")
                    ),
                    vec![
                        option("admit_anyway", "Admit anyway", "Keeps the paths as given; protected files still fail the gate.", "secondary"),
                        abort_option(),
                    ],
                ));
                push_event(&mut wo, "Held: allowed paths overlap protected paths.");
            } else if let Some(agent) = &submitted_by {
                wo.status = WorkOrderStatus::ON_HOLD;
                set_stage(&mut wo, "admission", StageStatus::ON_HOLD, format!("Submitted by agent {}", agent));
                wo.hold = Some(hold(
                    HoldReason::AGENT_SUBMITTED,
                    format!(
                        "Agent {} submitted this work order for {}. Nothing is created or run until you admit it.",
                        agent,
                        repo_root.display()
                    ),
                    vec![
                        option("admit_anyway", "Admit", "Creates the worktree and runs the approved setup commands.", "primary"),
                        abort_option(),
                    ],
                ));
                push_event(&mut wo, format!("Held: submitted by agent {}.", agent));
            } else {
                set_stage(&mut wo, "admission", StageStatus::PASSED, "Admitted");
                let open = open_deps(&inner.work_orders, &depends_on);
                start = route_after_admission(&mut wo, inner.loop_mode, &open);
            }
            inner.work_orders.insert(0, wo.clone());
            Ok((wo, start))
        })?;

        if start {
            self.spawn_scaffold(created.id.clone());
        }
        Ok(created)
    }

    // -----------------------------------------------------------------------
    // Scaffold: worktree, vault, setup commands.
    // -----------------------------------------------------------------------

    /// Records a job thread that panicked, so the work order is not left mid-step.
    fn fail_after_panic(&self, id: &str, job: &str) {
        let _ = self.with_wo(id, |wo, _| {
            if matches!(wo.status, WorkOrderStatus::SCAFFOLDING | WorkOrderStatus::GATING) {
                let stage_id = if job == "gate" { "gate" } else { "scaffold" };
                wo.status = WorkOrderStatus::INTERRUPTED;
                set_stage(wo, stage_id, StageStatus::FAILED, format!("The {} job crashed", job));
                push_event(wo, format!("The {} job crashed; resume to try again.", job));
            }
            Ok(())
        });
    }

    fn scaffold_job(&self, id: &str, cancel: &Arc<AtomicBool>) {
        let Ok(snap) = self.get(id) else {
            return;
        };
        let repo = PathBuf::from(&snap.repo_path);
        let wt = PathBuf::from(&snap.worktree_path);
        let mut notes: Vec<String> = Vec::new();
        let mut setup = Vec::new();

        let approved = self.approved_config(&repo);
        let result = (|| -> Result<VaultInfo, String> {
            let loaded = load_config_pinned(&repo)?;
            if let Some(why) = unapproved_reason(&loaded, approved.as_deref()) {
                return Err(why);
            }
            let cfg = loaded.config;
            git::ensure_excluded(&repo, &format!("/{}/", WORKTREES_REL_DIR))?;

            if git::is_registered_worktree(&repo, &wt) {
                notes.push("Reused the existing worktree.".to_string());
            } else {
                if wt.exists() {
                    return Err(format!(
                        "{} exists but is not a git worktree; move it away and retry",
                        wt.display()
                    ));
                }
                if let Some(parent) = wt.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("cannot create {}: {}", parent.display(), e))?;
                }
                let create = !git::branch_exists(&repo, &snap.branch_name);
                git::add_worktree(&repo, &wt, &snap.branch_name, &snap.base_sha, create)?;
                notes.push(if create {
                    format!("Created {} at {}.", snap.branch_name, short(&snap.base_sha))
                } else {
                    format!("Checked out the existing branch {}.", snap.branch_name)
                });
            }

            // Vault the main checkout's holdbacks and keep them out of the worktree.
            let vaulted = vault::vault_holdbacks(&self.vault_root, &repo, id)?;
            let tracked = git::ls_files(&wt, HOLDBACKS_REL_DIR)?;
            git::hide_tracked(&wt, &tracked)?;
            vault::remove_restored(&wt)?;
            notes.push(format!(
                "Vaulted {} holdback file(s) (sha256 {}).",
                vaulted.files.len(),
                short(&vaulted.sha256)
            ));

            let timeout = Duration::from_secs(cfg.timeout_sec);
            let env = vec![
                ("MACHINA_WORK_ORDER", id.to_string()),
                ("MACHINA_WORKTREE", wt.to_string_lossy().to_string()),
            ];
            for cmd in &cfg.setup {
                if cancel.load(Ordering::SeqCst) {
                    return Err("Cancelled".to_string());
                }
                let c = run_check(0, cmd, &wt, &env, timeout, cancel);
                let ok = c.outcome == CheckOutcome::PASS;
                let outcome = c.outcome;
                setup.push(c);
                if !ok {
                    return Err(format!("Setup command '{}' ended {:?}", cmd.name, outcome));
                }
            }
            if !cfg.setup.is_empty() {
                notes.push(format!("{} setup command(s) passed.", cfg.setup.len()));
            }

            Ok(VaultInfo {
                path: vaulted.dir.to_string_lossy().to_string(),
                sha256: vaulted.sha256,
                files: vaulted.files,
                tracked_in_git: !tracked.is_empty(),
            })
        })();

        let cancelled = cancel.load(Ordering::SeqCst);
        // Free the slot before the status leaves SCAFFOLDING, so a gate can start at once.
        self.release_job(id, cancel);
        let _ = self.with_wo(id, |wo, _| {
            for n in &notes {
                push_event(wo, n.clone());
            }
            wo.setup_checks = setup;
            if wo.status != WorkOrderStatus::SCAFFOLDING {
                // Aborted or halted while the job ran; keep that status, close the stage.
                if stage(wo, "scaffold").status == StageStatus::RUNNING {
                    set_stage(wo, "scaffold", StageStatus::FAILED, "Cancelled");
                }
                return Ok(());
            }
            match result {
                Ok(vault_info) => {
                    let detail = format!(
                        "{} on {}; {} holdback file(s) vaulted",
                        wo.worktree_path,
                        wo.branch_name,
                        vault_info.files.len()
                    );
                    wo.vault = Some(vault_info);
                    wo.error = None;
                    wo.status = WorkOrderStatus::IN_PROGRESS;
                    set_stage(wo, "scaffold", StageStatus::PASSED, detail);
                    set_stage(wo, "implementation", StageStatus::PENDING, "Waiting for the author agent to launch");
                    push_event(wo, "Scaffold finished; ready for the author agent.");
                }
                Err(e) if cancelled => {
                    wo.status = WorkOrderStatus::INTERRUPTED;
                    set_stage(wo, "scaffold", StageStatus::FAILED, "Cancelled");
                    push_event(wo, format!("Scaffold cancelled: {}", e));
                }
                Err(e) => {
                    wo.status = WorkOrderStatus::FAILED;
                    set_stage(wo, "scaffold", StageStatus::FAILED, e.clone());
                    push_event(wo, format!("Scaffold failed: {}", e));
                    wo.error = Some(e);
                }
            }
            Ok(())
        });
    }

    // -----------------------------------------------------------------------
    // Author agent.
    // -----------------------------------------------------------------------

    /// Records the terminal the operator launched as this work order's author.
    pub fn bind_author_terminal(&self, id: &str, terminal_id: &str) -> Result<MachinaWorkOrder, String> {
        let terminal_id = terminal_id.trim();
        let pty = self.pty.lock().clone().ok_or("Terminals are not ready yet")?;
        let info = pty
            .get_info(terminal_id)
            .ok_or_else(|| format!("Terminal {} not found", terminal_id))?;
        self.with_wo(id, |wo, _| {
            if wo.status != WorkOrderStatus::IN_PROGRESS {
                return Err(format!("{} is {:?}; launch the author while it is IN_PROGRESS", wo.id, wo.status));
            }
            if git::path_key(Path::new(&info.project_path)) != git::path_key(Path::new(&wo.worktree_path)) {
                return Err(format!("Terminal {} does not run in {}'s worktree", terminal_id, wo.id));
            }
            wo.author_terminal_id = Some(terminal_id.to_string());
            if stage(wo, "implementation").status == StageStatus::PENDING {
                set_stage(wo, "implementation", StageStatus::RUNNING, format!("{} is working in the worktree", wo.author_agent));
            }
            push_event(wo, format!("Author terminal {} ({}) bound.", info.name, wo.author_agent));
            Ok(wo.clone())
        })
    }

    fn finish_instruction(wo: &MachinaWorkOrder) -> String {
        if wo.author_agent == "claude" {
            format!(
                "When you are done, call the MCP tool machina_submit_deliverable with work_order_id \"{}\" and wait for the verdict.",
                wo.id
            )
        } else {
            "When you are done, say so and stop; the operator will run the gate.".to_string()
        }
    }

    /// The first message for the author, as one line (a newline would submit early).
    pub fn brief_text(&self, id: &str) -> Result<String, String> {
        let wo = self.get(id)?;
        let protected = load_config(Path::new(&wo.repo_path))
            .map(|(c, _)| c.effective_protected())
            .unwrap_or_default();
        Ok(flatten(&format!(
            "Machina work order {}: {}. Objective: {} You are in a git worktree on branch {}. Change only files matching: {}. Changing any of these protected paths fails the gate: {}. A gate will commit your work, build and test it, and run hidden holdback tests you cannot see. {}",
            wo.id,
            wo.title,
            wo.objective,
            wo.branch_name,
            wo.allowed_output_paths.join(", "),
            protected.join(", "),
            Self::finish_instruction(&wo)
        )))
    }

    /// The message that points the author at the latest gate feedback file.
    pub fn correction_text(&self, id: &str) -> Result<String, String> {
        let wo = self.get(id)?;
        let gate = wo.last_gate.as_ref().ok_or("No gate has run yet")?;
        if gate.verdict == GateVerdict::PASS {
            return Err("The last gate passed; there is nothing to correct".to_string());
        }
        Ok(flatten(&format!(
            "Machina {}: gate attempt {} {}. Read {}/attempt-{}.md for the findings, fix them, and stay inside the allowed paths. {}",
            wo.id,
            gate.attempt,
            if gate.verdict == GateVerdict::FAIL { "failed" } else { "was inconclusive" },
            FEEDBACK_REL_DIR,
            gate.attempt,
            Self::finish_instruction(&wo)
        )))
    }

    /// Types `text` into the author terminal and presses Enter.
    pub fn send_to_author(&self, id: &str, text: &str) -> Result<(), String> {
        let wo = self.get(id)?;
        let terminal = wo
            .author_terminal_id
            .clone()
            .ok_or_else(|| format!("{} has no author terminal; launch one first", wo.id))?;
        let pty = self.pty.lock().clone().ok_or("Terminals are not ready yet")?;
        pty.submit_prompt(&terminal, text)?;
        self.with_wo(id, |wo, _| {
            push_event(wo, format!("Sent to the author: {}", text.chars().take(160).collect::<String>()));
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // Gate.
    // -----------------------------------------------------------------------

    /// Starts a gate run. `requested_by` is the terminal that asked (via MCP); when it
    /// is the author terminal, the verdict is typed back into it.
    pub fn start_gate(&self, id: &str, requested_by: Option<String>) -> Result<GateStart, String> {
        let snap = self.get(id)?;
        let measured = spend::measure(&snap.author_agent, &snap.worktree_path);

        let started = self.with_wo(id, |wo, mode| {
            if mode == FactoryLoopMode::HALTED {
                return Err("The factory is HALTED".to_string());
            }
            if !matches!(wo.status, WorkOrderStatus::IN_PROGRESS | WorkOrderStatus::AWAITING_ACCEPTANCE) {
                return Err(format!("{} is {:?}; the gate runs on work in progress", wo.id, wo.status));
            }
            wo.spend = measured;
            if wo.spend.measured && wo.spend.usd >= wo.budget_usd {
                let raised = (wo.budget_usd * 1.5 * 100.0).round() / 100.0;
                wo.status = WorkOrderStatus::ON_HOLD;
                set_stage(wo, "gate", StageStatus::ON_HOLD, "Budget reached");
                wo.hold = Some(hold(
                    HoldReason::BUDGET_EXCEEDED,
                    format!(
                        "Measured spend ${:.2} has reached the ${:.2} budget.",
                        wo.spend.usd, wo.budget_usd
                    ),
                    vec![
                        option("raise_budget", &format!("Raise the budget to ${:.2}", raised), "Adds 50% and returns the work order to the author.", "primary"),
                        abort_option(),
                    ],
                ));
                push_event(wo, "Held: measured spend reached the budget.");
                return Ok(GateStart::Held("Measured spend reached the budget".to_string()));
            }
            wo.attempts += 1;
            wo.status = WorkOrderStatus::GATING;
            if stage(wo, "acceptance").status == StageStatus::RUNNING {
                set_stage(wo, "acceptance", StageStatus::PENDING, "");
            }
            if stage(wo, "implementation").status == StageStatus::RUNNING {
                set_stage(wo, "implementation", StageStatus::PASSED, "Candidate submitted to the gate");
            }
            set_stage(wo, "gate", StageStatus::RUNNING, format!("Attempt {} running", wo.attempts));
            push_event(
                wo,
                format!(
                    "Gate attempt {} started{}.",
                    wo.attempts,
                    requested_by.as_deref().map(|t| format!(" by terminal {}", t)).unwrap_or_default()
                ),
            );
            Ok(GateStart::Started(wo.attempts))
        })?;

        if let GateStart::Started(attempt) = started {
            let Some(cancel) = self.claim_job(id) else {
                // Unreachable while GATING is only entered here, but never leave it stuck.
                let _ = self.with_wo(id, |wo, _| {
                    wo.status = WorkOrderStatus::INTERRUPTED;
                    Ok(())
                });
                return Err(format!("{} already has a job running", id));
            };
            let wo = self.get(id)?;
            let input = GateInput {
                wo_id: wo.id.clone(),
                attempt,
                repo_root: PathBuf::from(&wo.repo_path),
                worktree: PathBuf::from(&wo.worktree_path),
                base_sha: wo.base_sha.clone(),
                allowed: wo.allowed_output_paths.clone(),
                vault_root: self.vault_root.clone(),
                vault_sha: wo.vault.as_ref().map(|v| v.sha256.clone()),
                vault_file_count: wo.vault.as_ref().map_or(0, |v| v.files.len()),
                approved_config_sha: self.approved_config(Path::new(&wo.repo_path)),
            };
            let mgr = self.clone();
            let id = id.to_string();
            std::thread::spawn(move || {
                let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_gate(&input, &cancel)
                }));
                mgr.release_job(&id, &cancel);
                match run {
                    Ok(report) => mgr.apply_gate_result(&id, report, requested_by),
                    Err(_) => mgr.fail_after_panic(&id, "gate"),
                }
            });
        }
        Ok(started)
    }

    fn apply_gate_result(&self, id: &str, report: GateReport, requested_by: Option<String>) {
        let feedback = feedback_markdown(id, &report);
        let applied = self.with_wo(id, |wo, _| {
            let still_gating = wo.status == WorkOrderStatus::GATING;
            let k = report.attempt;
            if report.verdict != GateVerdict::PASS {
                let dir = Path::new(&wo.worktree_path).join(native_path(FEEDBACK_REL_DIR));
                let path = dir.join(format!("attempt-{}.md", k));
                if let Err(e) = fs::create_dir_all(&dir).and_then(|_| fs::write(&path, &feedback)) {
                    push_event(wo, format!("Could not write the feedback file: {}", e));
                }
            }
            push_event(wo, format!("Gate attempt {}: {:?}. {}", k, report.verdict, report.reasons.first().cloned().unwrap_or_default()));
            let verdict = report.verdict;
            let first_reason = report.reasons.first().cloned().unwrap_or_default();
            let sha = report.candidate_sha.clone();
            wo.last_gate = Some(report);
            if !still_gating {
                set_stage(wo, "gate", StageStatus::FAILED, "Cancelled");
                return Ok(None);
            }
            match verdict {
                GateVerdict::PASS => {
                    set_stage(wo, "gate", StageStatus::PASSED, format!("Attempt {} passed at {}", k, short(&sha)));
                    set_stage(wo, "correction", StageStatus::PASSED, match k {
                        1 => "No corrections needed".to_string(),
                        n => format!("{} correction(s)", n - 1),
                    });
                    set_stage(wo, "acceptance", StageStatus::RUNNING, "Waiting for a human to accept and merge");
                    wo.status = WorkOrderStatus::AWAITING_ACCEPTANCE;
                }
                GateVerdict::FAIL if k <= wo.max_corrections => {
                    set_stage(wo, "gate", StageStatus::FAILED, format!("Attempt {} failed: {}", k, first_reason));
                    set_stage(wo, "correction", StageStatus::RUNNING, format!("Correction {} of {}", k, wo.max_corrections));
                    wo.status = WorkOrderStatus::IN_PROGRESS;
                }
                GateVerdict::FAIL => {
                    set_stage(wo, "gate", StageStatus::FAILED, format!("Attempt {} failed: {}", k, first_reason));
                    set_stage(wo, "correction", StageStatus::ON_HOLD, "No corrections left");
                    wo.status = WorkOrderStatus::ON_HOLD;
                    wo.hold = Some(hold(
                        HoldReason::MAX_CORRECTIONS_EXCEEDED,
                        format!("Attempt {} failed and all {} correction(s) are used.", k, wo.max_corrections),
                        vec![
                            option("grant_attempt", "Allow one more correction", "Raises the limit by one and returns the work order to the author.", "primary"),
                            abort_option(),
                        ],
                    ));
                }
                GateVerdict::INCONCLUSIVE => {
                    set_stage(wo, "gate", StageStatus::ON_HOLD, format!("Attempt {} inconclusive: {}", k, first_reason));
                    wo.status = WorkOrderStatus::ON_HOLD;
                    wo.hold = Some(hold(
                        HoldReason::GATE_INCONCLUSIVE,
                        format!("The gate could not reach a verdict: {}", first_reason),
                        vec![
                            option("rerun_gate", "Run the gate again", "Use this after fixing the config or the environment.", "primary"),
                            option("resume_work", "Return to the author", "Leaves the gate result as is and lets the author keep working.", "secondary"),
                            abort_option(),
                        ],
                    ));
                }
            }
            Ok(Some((verdict, wo.status, wo.author_terminal_id.clone())))
        });

        // Tell the author when it asked for this gate itself.
        if let Ok(Some((verdict, status, Some(author)))) = applied
            && requested_by.as_deref() == Some(author.as_str())
        {
            let msg = match (verdict, status) {
                (GateVerdict::PASS, _) => format!(
                    "Machina {}: the gate passed. Stop here; a human will review and merge.",
                    id
                ),
                (_, WorkOrderStatus::IN_PROGRESS) => match self.correction_text(id) {
                    Ok(t) => t,
                    Err(_) => return,
                },
                _ => format!(
                    "Machina {}: the gate result needs a human decision. Stop and wait.",
                    id
                ),
            };
            if let Err(e) = self.send_to_author(id, &msg) {
                tracing::warn!("Machina could not notify the author of {}: {}", id, e);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Holds, acceptance, abort, resume, cleanup.
    // -----------------------------------------------------------------------

    pub fn resolve_hold(&self, req: ResolveHoldRequest) -> Result<MachinaWorkOrder, String> {
        let id = parse_wo_id(&req.work_order_id)?;
        let option_id = req.option_id.trim().to_string();
        let mut start_scaffold = false;
        let mut rerun = false;
        let updated = self.mutate(|inner| -> Result<MachinaWorkOrder, String> {
            let mode = inner.loop_mode;
            let open = {
                let wo = inner.work_orders.iter().find(|w| w.id == id).ok_or_else(|| format!("Work order {} not found", id))?;
                open_deps(&inner.work_orders, &wo.depends_on)
            };
            let wo = inner.work_orders.iter_mut().find(|w| w.id == id).ok_or_else(|| format!("Work order {} not found", id))?;
            let card = wo.hold.clone().ok_or_else(|| format!("{} has no hold to resolve", id))?;
            let chosen = card
                .options
                .iter()
                .find(|o| o.id == option_id)
                .ok_or_else(|| format!("'{}' is not an option for this hold", option_id))?;
            push_event(wo, format!("Hold {:?} resolved: {}.", card.reason, chosen.label));
            wo.hold = None;
            match option_id.as_str() {
                "abort" => {
                    wo.status = WorkOrderStatus::ABORTED;
                    let held: Vec<String> = wo.stages.iter().filter(|s| s.status == StageStatus::ON_HOLD).map(|s| s.id.clone()).collect();
                    for s in held {
                        set_stage(wo, &s, StageStatus::FAILED, "Aborted by the operator");
                    }
                }
                "admit_anyway" => {
                    set_stage(wo, "admission", StageStatus::PASSED, format!("Admitted by operator override ({:?})", card.reason));
                    start_scaffold = route_after_admission(wo, mode, &open);
                }
                "grant_attempt" => {
                    wo.max_corrections += 1;
                    wo.status = WorkOrderStatus::IN_PROGRESS;
                    set_stage(wo, "correction", StageStatus::RUNNING, format!("Correction {} of {}", wo.attempts, wo.max_corrections));
                }
                "rerun_gate" => {
                    wo.status = WorkOrderStatus::IN_PROGRESS;
                    set_stage(wo, "gate", StageStatus::PENDING, "Re-run requested");
                    rerun = true;
                }
                "resume_work" => {
                    wo.status = WorkOrderStatus::IN_PROGRESS;
                    set_stage(wo, "gate", StageStatus::PENDING, "Returned to the author");
                }
                "raise_budget" => {
                    wo.budget_usd = (wo.budget_usd * 1.5 * 100.0).round() / 100.0;
                    wo.status = WorkOrderStatus::IN_PROGRESS;
                    set_stage(wo, "gate", StageStatus::PENDING, format!("Budget raised to ${:.2}", wo.budget_usd));
                }
                other => return Err(format!("Unknown hold option '{}'", other)),
            }
            wo.updated_at_ms = now_ms();
            Ok(wo.clone())
        })?;
        if start_scaffold {
            self.spawn_scaffold(id.clone());
        }
        if rerun {
            self.start_gate(&id, None)?;
            return self.get(&id);
        }
        Ok(updated)
    }

    /// Squash-merges the gated commit into the base branch in the main checkout.
    pub fn accept_and_merge(&self, id: &str) -> Result<MachinaWorkOrder, String> {
        let flag = self
            .claim_job(id)
            .ok_or_else(|| format!("{} is busy; wait for its current job to finish", id))?;
        let result = self.accept_locked(id);
        self.release_job(id, &flag);
        if result.is_ok() {
            self.start_ready();
        }
        result
    }

    fn accept_locked(&self, id: &str) -> Result<MachinaWorkOrder, String> {
        let wo = self.get(id)?;
        if wo.status != WorkOrderStatus::AWAITING_ACCEPTANCE {
            return Err(format!("{} is {:?}; only a work order whose gate passed can be merged", wo.id, wo.status));
        }
        let gate = wo.last_gate.as_ref().filter(|g| g.verdict == GateVerdict::PASS).ok_or("The last gate did not pass")?;
        let repo = PathBuf::from(&wo.repo_path);
        let wt = PathBuf::from(&wo.worktree_path);
        let head = git::head_sha(&wt)?;
        if head != gate.candidate_sha {
            return Err(format!(
                "The worktree moved from the gated commit {} to {}; run the gate again",
                short(&gate.candidate_sha),
                short(&head)
            ));
        }
        let dirty = git::dirty_paths(&wt, &FACTORY_MANAGED)?;
        if !dirty.is_empty() {
            return Err(format!(
                "The worktree has {} uncommitted change(s) since the gate; run the gate again",
                dirty.len()
            ));
        }
        let message = format!(
            "{}\n\nMachina {}: {}\n\nGated commit {} on {} (attempt {}).",
            wo.title,
            wo.id,
            wo.objective.chars().take(2_000).collect::<String>(),
            gate.candidate_sha,
            wo.branch_name,
            gate.attempt
        );
        let merged = git::squash_merge(&repo, &wo.base_branch, &wo.branch_name, &message)?;
        let final_spend = spend::measure(&wo.author_agent, &wo.worktree_path);
        let removal = clear_factory_files(&wt).and_then(|_| git::remove_worktree(&repo, &wt, false));

        self.with_wo(id, |wo, _| {
            wo.status = WorkOrderStatus::COMPLETED;
            wo.merge_commit = Some(merged.clone());
            wo.spend = final_spend;
            set_stage(wo, "acceptance", StageStatus::PASSED, format!("Squash-merged into {} as {}", wo.base_branch, short(&merged)));
            push_event(wo, format!("Merged into {} as {}.", wo.base_branch, short(&merged)));
            match &removal {
                Ok(()) => {
                    wo.worktree_removed = true;
                    push_event(wo, format!("Removed the worktree; branch {} is kept.", wo.branch_name));
                }
                Err(e) => push_event(wo, format!("Kept the worktree: {}", e)),
            }
            Ok(wo.clone())
        })
    }

    pub fn abort(&self, id: &str) -> Result<MachinaWorkOrder, String> {
        self.cancel_job(id);
        self.with_wo(id, |wo, _| {
            if wo.status.is_final() {
                return Err(format!("{} is already {:?}", wo.id, wo.status));
            }
            wo.status = WorkOrderStatus::ABORTED;
            wo.hold = None;
            let open: Vec<String> = wo
                .stages
                .iter()
                .filter(|s| matches!(s.status, StageStatus::RUNNING | StageStatus::ON_HOLD))
                .map(|s| s.id.clone())
                .collect();
            for s in open {
                set_stage(wo, &s, StageStatus::FAILED, "Aborted by the operator");
            }
            push_event(wo, "Aborted by the operator. The worktree and branch are kept.");
            Ok(wo.clone())
        })
    }

    /// Picks an INTERRUPTED or FAILED work order back up: re-runs the scaffold if it
    /// never finished, otherwise returns the work to the author.
    pub fn resume(&self, id: &str) -> Result<MachinaWorkOrder, String> {
        let mut rescaffold = false;
        let updated = self.with_wo(id, |wo, mode| {
            if mode == FactoryLoopMode::HALTED {
                return Err("The factory is HALTED. Set it to ACTIVE or PAUSED first.".to_string());
            }
            if !matches!(wo.status, WorkOrderStatus::INTERRUPTED | WorkOrderStatus::FAILED) {
                return Err(format!("{} is {:?}; only interrupted or failed work orders resume", wo.id, wo.status));
            }
            if stage(wo, "scaffold").status != StageStatus::PASSED {
                wo.status = WorkOrderStatus::SCAFFOLDING;
                set_stage(wo, "scaffold", StageStatus::RUNNING, "Retrying the scaffold");
                rescaffold = true;
            } else {
                wo.status = WorkOrderStatus::IN_PROGRESS;
                let gate = stage(wo, "gate");
                let cut_off = gate.status == StageStatus::RUNNING
                    || gate.detail == "Cancelled"
                    || gate.detail.starts_with("Interrupted");
                if cut_off {
                    set_stage(wo, "gate", StageStatus::PENDING, "Interrupted; run the gate again");
                }
            }
            wo.error = None;
            push_event(wo, "Resumed by the operator.");
            Ok(wo.clone())
        })?;
        if rescaffold {
            self.spawn_scaffold(id.to_string());
        }
        Ok(updated)
    }

    /// Removes the worktree of a finished, aborted or failed work order. `force`
    /// discards uncommitted changes in it. The branch is always kept.
    pub fn remove_worktree(&self, id: &str, force: bool) -> Result<MachinaWorkOrder, String> {
        let wo = self.get(id)?;
        if !matches!(wo.status, WorkOrderStatus::COMPLETED | WorkOrderStatus::ABORTED | WorkOrderStatus::FAILED) {
            return Err(format!("{} is {:?}; finish or abort it before removing its worktree", wo.id, wo.status));
        }
        if wo.worktree_removed {
            return Err(format!("{}'s worktree is already removed", wo.id));
        }
        let repo = PathBuf::from(&wo.repo_path);
        let wt = PathBuf::from(&wo.worktree_path);
        if git::is_registered_worktree(&repo, &wt) {
            clear_factory_files(&wt)?;
            git::remove_worktree(&repo, &wt, force)?;
        }
        self.with_wo(id, |wo, _| {
            wo.worktree_removed = true;
            push_event(wo, format!("Removed the worktree{}; branch {} is kept.", if force { " (forced)" } else { "" }, wo.branch_name));
            Ok(wo.clone())
        })
    }

    // -----------------------------------------------------------------------
    // Loop control.
    // -----------------------------------------------------------------------

    pub fn set_loop_mode(&self, mode: FactoryLoopMode) -> MachinaStatusPayload {
        let mut interrupt_terminals = Vec::new();
        let mut cancel_ids = Vec::new();
        self.mutate(|inner| {
            inner.loop_mode = mode;
            if mode == FactoryLoopMode::HALTED {
                for wo in &mut inner.work_orders {
                    match wo.status {
                        WorkOrderStatus::SCAFFOLDING | WorkOrderStatus::GATING => {
                            cancel_ids.push(wo.id.clone());
                            wo.status = WorkOrderStatus::INTERRUPTED;
                            push_event(wo, "Interrupted by HALT.");
                        }
                        WorkOrderStatus::IN_PROGRESS => {
                            if let Some(t) = &wo.author_terminal_id {
                                interrupt_terminals.push(t.clone());
                            }
                            wo.status = WorkOrderStatus::INTERRUPTED;
                            push_event(wo, "Interrupted by HALT; Ctrl+C sent to the author terminal.");
                        }
                        _ => {}
                    }
                }
            }
        });
        for id in cancel_ids {
            self.cancel_job(&id);
        }
        let pty = self.pty.lock().clone();
        if let Some(pty) = pty {
            for t in interrupt_terminals {
                let _ = pty.write(&t, "\u{3}");
            }
        }
        if mode == FactoryLoopMode::ACTIVE {
            self.start_ready();
        }
        self.status()
    }

    // -----------------------------------------------------------------------
    // Agent-facing views (MCP and A2A). Never include the vault path or raw Tier 2
    // output.
    // -----------------------------------------------------------------------

    pub fn agent_view(&self, id: &str) -> Result<Value, String> {
        let wo = self.get(id)?;
        let cfg: FactoryConfig = load_config(Path::new(&wo.repo_path)).map(|(c, _)| c).unwrap_or_default();
        let gate = wo.last_gate.as_ref().map(|g| {
            json!({
                "attempt": g.attempt,
                "verdict": g.verdict,
                "candidateSha": g.candidate_sha,
                "reasons": g.reasons,
                "changedFiles": g.changed_files,
                "scopeViolations": g.scope_violations,
                "protectedViolations": g.protected_violations,
                "auditFindings": g.audit.as_ref().map(|a| a.findings.clone()).unwrap_or_default(),
                "checks": g.checks.iter().map(|c| json!({
                    "tier": c.tier,
                    "name": c.name,
                    "command": if c.tier == 2 { "(hidden)".to_string() } else { c.command.clone() },
                    "outcome": c.outcome,
                    "exitCode": c.exit_code,
                    "output": c.output,
                })).collect::<Vec<_>>(),
            })
        });
        Ok(json!({
            "id": wo.id,
            "title": wo.title,
            "objective": wo.objective,
            "status": wo.status,
            "branch": wo.branch_name,
            "worktreePath": wo.worktree_path,
            "allowedOutputPaths": wo.allowed_output_paths,
            "protectedPaths": cfg.effective_protected(),
            "attempts": wo.attempts,
            "maxCorrections": wo.max_corrections,
            "lastGate": gate,
        }))
    }

    pub fn get_a2a_agent_card(&self, bridge_port: u16) -> Value {
        let status = self.status();
        json!({
            "name": "machina",
            "description": "Quay's software factory. Runs each work order in its own git worktree, gates candidates with the project's configured build, test and holdback commands plus a pre-PR audit, and leaves the merge to a human.",
            "url": format!("http://127.0.0.1:{}/mcp", bridge_port),
            "version": env!("CARGO_PKG_VERSION"),
            "loopMode": status.loop_mode,
            "epoch": status.epoch,
            "capabilities": { "streaming": false, "pushNotifications": false },
            "skills": [
                { "id": "machina_submit_work_order", "name": "Submit a work order", "description": "Admits a work order and creates its worktree and branch." },
                { "id": "machina_get_work_order", "name": "Read a work order", "description": "Returns the objective, allowed paths and the latest gate findings (Tier 2 details withheld)." },
                { "id": "machina_submit_deliverable", "name": "Run the gate", "description": "Commits the worktree and runs the gate in the background; the verdict is typed into the author terminal." }
            ]
        })
    }
}

/// Deletes the files the factory itself put in a worktree (feedback, restored
/// holdbacks), so a plain `git worktree remove` can succeed.
fn clear_factory_files(wt: &Path) -> Result<(), String> {
    for rel in FACTORY_MANAGED {
        let dir = wt.join(native_path(rel));
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {}", dir.display(), e))?;
        }
    }
    Ok(())
}

/// The feedback file written into the worktree after a failed or inconclusive gate.
fn feedback_markdown(id: &str, g: &GateReport) -> String {
    let mut s = format!(
        "# {} gate attempt {}: {:?}\n\nCandidate commit: {}\n\n## Reasons\n\n",
        id, g.attempt, g.verdict, g.candidate_sha
    );
    for r in &g.reasons {
        s.push_str(&format!("- {}\n", r));
    }
    if !g.scope_violations.is_empty() {
        s.push_str("\n## Files outside the allowed output paths\n\n");
        for f in &g.scope_violations {
            s.push_str(&format!("- {}\n", f));
        }
    }
    if !g.protected_violations.is_empty() {
        s.push_str("\n## Protected files you changed (revert these)\n\n");
        for f in &g.protected_violations {
            s.push_str(&format!("- {}\n", f));
        }
    }
    if let Some(a) = &g.audit
        && !a.findings.is_empty()
    {
        s.push_str("\n## Pre-PR audit findings\n\n");
        for f in &a.findings {
            s.push_str(&format!("- {}\n", f));
        }
    }
    for c in g.checks.iter().filter(|c| c.outcome != CheckOutcome::PASS) {
        let tier = if c.tier == 2 { "Tier 2 (holdback)" } else { "Tier 1" };
        s.push_str(&format!("\n## {} check `{}`: {:?}\n\n", tier, c.name, c.outcome));
        if c.tier == 1 {
            s.push_str(&format!("Command: `{}`\n\n", c.command));
        }
        s.push_str("```text\n");
        s.push_str(c.output.trim_end());
        s.push_str("\n```\n");
    }
    s
}

fn load_state(path: &Path) -> Option<PersistedState> {
    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            tracing::error!("Machina could not read {}: {}", path.display(), e);
            return None;
        }
    };
    match serde_json::from_str::<PersistedState>(&raw) {
        Ok(s) if s.version == STATE_VERSION => Some(s),
        other => {
            let why = match other {
                Ok(s) => format!("version {}", s.version),
                Err(e) => e.to_string(),
            };
            let aside = path.with_extension(format!("unreadable-{}.json", now_ms()));
            tracing::error!(
                "Machina state {} is unreadable ({}); moving it to {} and starting empty",
                path.display(),
                why,
                aside.display()
            );
            let _ = fs::rename(path, &aside);
            None
        }
    }
}

fn write_state(path: &Path, state: &PersistedState) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("cannot write {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, path).map_err(|e| format!("cannot replace {}: {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_work_order_ids() {
        assert_eq!(parse_wo_id(" wo-12 ").unwrap(), "WO-12");
        assert!(parse_wo_id("WO-0").is_err());
        assert!(parse_wo_id("WO-012").is_err());
        assert!(parse_wo_id("WO-").is_err());
        assert!(parse_wo_id("12").is_err());
        assert!(parse_wo_id("WO-1a").is_err());
        assert!(parse_wo_id("WO-1234567890").is_err());
    }

    #[test]
    fn parses_agents() {
        assert_eq!(parse_agent("Claude").unwrap(), "claude");
        assert_eq!(parse_agent("opencode").unwrap(), "opencode");
        assert!(parse_agent("powershell").is_err());
        assert!(parse_agent("vim").is_err());
    }

    fn sh_git(dir: &Path, args: &[&str]) -> String {
        git::run_ok(dir, args).unwrap_or_else(|e| panic!("{}", e))
    }

    fn wait_while(mgr: &MachinaManager, id: &str, busy: WorkOrderStatus) -> MachinaWorkOrder {
        for _ in 0..600 {
            let wo = mgr.get(id).unwrap();
            if wo.status != busy {
                return wo;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("{} stayed {:?}", id, busy);
    }

    /// A throwaway repository on `main` with `factory_json` committed and one untracked
    /// holdback (`expected.txt` = "hello world\n"). Returns (root, repo).
    fn test_repo(factory_json: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("machina-e2e-{}", uuid::Uuid::new_v4().simple()));
        let repo = root.join("repo");
        fs::create_dir_all(&repo).unwrap();
        sh_git(&repo, &["init", "-q", "-b", "main"]);
        for (k, v) in [
            ("user.name", "Machina Test"),
            ("user.email", "machina@example.invalid"),
            ("core.hooksPath", ".git/no-hooks"),
            ("core.autocrlf", "false"),
        ] {
            sh_git(&repo, &["config", k, v]);
        }
        fs::write(repo.join("README.md"), "readme\n").unwrap();
        fs::create_dir_all(repo.join(".machina").join("holdbacks")).unwrap();
        fs::write(repo.join(".machina").join("factory.json"), factory_json).unwrap();
        sh_git(&repo, &["add", "-A"]);
        sh_git(&repo, &["commit", "-q", "-m", "init"]);
        // Holdbacks stay untracked, the recommended setup.
        fs::write(repo.join(".machina").join("holdbacks").join("expected.txt"), "hello world\n").unwrap();
        (root, repo)
    }

    fn approve_current(mgr: &MachinaManager, repo: &Path) {
        let sha = load_config_pinned(repo).unwrap().sha256.unwrap();
        mgr.approve_config(repo, &sha).unwrap();
    }

    fn test_request(repo: &Path) -> SubmitWorkOrderRequest {
        SubmitWorkOrderRequest {
            project_path: repo.to_string_lossy().to_string(),
            title: "Say hello".to_string(),
            objective: "Write src/a.txt".to_string(),
            allowed_output_paths: vec!["src/**".to_string()],
            base_branch: None,
            author_agent: "claude".to_string(),
            max_corrections: 1,
            budget_usd: 5.0,
            depends_on: Vec::new(),
        }
    }

    fn submit_test_order(mgr: &MachinaManager, repo: &Path) -> MachinaWorkOrder {
        approve_current(mgr, repo);
        mgr.submit_work_order(test_request(repo), None).unwrap()
    }

    /// An unapproved or changed factory.json runs no commands; an agent's submission
    /// waits for a human.
    #[test]
    fn config_approval_and_agent_submissions_gate_execution() {
        let marker_cmd = if cfg!(windows) { "echo ran> ran.txt" } else { "echo ran > ran.txt" };
        let (root, repo) = test_repo(&format!(
            r#"{{ "setup": [{{ "name": "marker", "run": "{}" }}], "tier1": [{{ "name": "ok", "run": "git --version" }}] }}"#,
            marker_cmd
        ));
        let mgr = MachinaManager::with_paths(root.join("state.json"), root.join("vault"));

        // Not approved: the scaffold fails before creating anything or running setup.
        mgr.submit_work_order(test_request(&repo), None).unwrap();
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::SCAFFOLDING);
        assert_eq!(wo.status, WorkOrderStatus::FAILED);
        assert!(wo.error.as_deref().unwrap_or("").contains("not been approved"));
        assert!(!PathBuf::from(&wo.worktree_path).exists());

        // Approving a stale hash is refused.
        assert!(mgr.approve_config(&repo, "0000").is_err());
        approve_current(&mgr, &repo);
        let wo = mgr.resume("WO-1").unwrap();
        assert_eq!(wo.status, WorkOrderStatus::SCAFFOLDING);
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::SCAFFOLDING);
        assert_eq!(wo.status, WorkOrderStatus::IN_PROGRESS, "{:?}", wo.error);
        let wt = PathBuf::from(&wo.worktree_path);
        assert!(wt.join("ran.txt").exists(), "the approved setup command should have run");

        // Editing the config after approval stops the gate before it runs anything.
        let cfg_path = repo.join(".machina").join("factory.json");
        let edited = fs::read_to_string(&cfg_path).unwrap().replace("git --version", "git status");
        fs::write(&cfg_path, edited).unwrap();
        fs::create_dir_all(wt.join("src")).unwrap();
        fs::write(wt.join("src").join("a.txt"), "x\n").unwrap();
        mgr.start_gate("WO-1", None).unwrap();
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::GATING);
        let gate = wo.last_gate.as_ref().unwrap();
        assert_eq!(gate.verdict, GateVerdict::INCONCLUSIVE);
        assert!(gate.reasons[0].contains("changed since it was approved"), "{:?}", gate.reasons);
        assert!(gate.checks.is_empty());
        assert!(gate.candidate_sha.is_empty(), "nothing should be committed");

        // An agent's submission is held until a human admits it.
        let wo = mgr
            .submit_work_order(test_request(&repo), Some("terminal t-1".to_string()))
            .unwrap();
        assert_eq!(wo.status, WorkOrderStatus::ON_HOLD);
        assert_eq!(wo.hold.as_ref().unwrap().reason, HoldReason::AGENT_SUBMITTED);
        assert!(!PathBuf::from(&wo.worktree_path).exists());

        let _ = mgr.abort("WO-1");
        let _ = mgr.remove_worktree("WO-1", true);
        let _ = fs::remove_dir_all(&root);
    }

    /// HALT cancels a running gate, kills its command, and the work order resumes.
    #[test]
    fn halt_cancels_a_running_gate() {
        let slow = if cfg!(windows) { "ping -n 30 127.0.0.1 > nul" } else { "sleep 30" };
        let (root, repo) = test_repo(&format!(
            r#"{{ "tier1": [{{ "name": "slow", "run": "{}" }}], "timeoutSec": 120 }}"#,
            slow
        ));
        let mgr = MachinaManager::with_paths(root.join("state.json"), root.join("vault"));
        submit_test_order(&mgr, &repo);
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::SCAFFOLDING);
        let wt = PathBuf::from(&wo.worktree_path);
        fs::create_dir_all(wt.join("src")).unwrap();
        fs::write(wt.join("src").join("a.txt"), "hello\n").unwrap();

        let started = std::time::Instant::now();
        mgr.start_gate("WO-1", None).unwrap();
        std::thread::sleep(Duration::from_millis(1500));
        mgr.set_loop_mode(FactoryLoopMode::HALTED);
        assert_eq!(mgr.get("WO-1").unwrap().status, WorkOrderStatus::INTERRUPTED);
        for _ in 0..200 {
            if mgr.jobs.lock().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(mgr.jobs.lock().is_empty(), "the gate job never finished");
        assert!(started.elapsed() < Duration::from_secs(25), "the slow check was not killed");

        let wo = mgr.get("WO-1").unwrap();
        let gate = wo.last_gate.as_ref().unwrap();
        assert_eq!(gate.verdict, GateVerdict::INCONCLUSIVE);
        assert_eq!(gate.checks[0].outcome, CheckOutcome::ERROR);
        assert!(mgr.submit_work_order(test_request(&repo), None).is_err(), "HALTED must refuse new work");

        mgr.set_loop_mode(FactoryLoopMode::ACTIVE);
        let wo = mgr.resume("WO-1").unwrap();
        assert_eq!(wo.status, WorkOrderStatus::IN_PROGRESS);
        assert_eq!(wo.stages.iter().find(|s| s.id == "gate").unwrap().status, StageStatus::PENDING);

        mgr.abort("WO-1").unwrap();
        mgr.remove_worktree("WO-1", true).unwrap();
        assert!(!wt.exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// Full path through a real git repository: scaffold, a Tier 2 failure, a scope
    /// failure that exhausts the corrections, a hold, a pass, and the squash merge.
    #[test]
    fn work_order_end_to_end() {
        let (root, repo) = test_repo(
            r#"{
              "tier1": [{ "name": "has-hello", "run": "git grep -q hello -- src/a.txt" }],
              "tier2": [{ "name": "matches-holdback", "run": "git diff --no-index --quiet .machina/holdbacks/expected.txt src/a.txt" }],
              "timeoutSec": 60
            }"#,
        );
        let mgr = MachinaManager::with_paths(root.join("state.json"), root.join("vault"));
        let wo = submit_test_order(&mgr, &repo);
        assert_eq!(wo.id, "WO-1");
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::SCAFFOLDING);
        assert_eq!(wo.status, WorkOrderStatus::IN_PROGRESS, "{:?}", wo.error);
        let wt = PathBuf::from(&wo.worktree_path);
        assert!(wt.join("README.md").exists());
        assert!(!wt.join(".machina").join("holdbacks").exists());
        assert_eq!(wo.vault.as_ref().unwrap().files, vec!["expected.txt".to_string()]);

        // Attempt 1: Tier 1 passes, the holdback does not.
        fs::create_dir_all(wt.join("src")).unwrap();
        fs::write(wt.join("src").join("a.txt"), "hello there\n").unwrap();
        assert!(matches!(mgr.start_gate("WO-1", None).unwrap(), GateStart::Started(1)));
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::GATING);
        let gate = wo.last_gate.as_ref().unwrap();
        assert_eq!(gate.verdict, GateVerdict::FAIL, "{:?}", gate.reasons);
        assert_eq!(wo.status, WorkOrderStatus::IN_PROGRESS);
        let tier2 = gate.checks.iter().find(|c| c.tier == 2).unwrap();
        assert_eq!(tier2.outcome, CheckOutcome::FAIL);
        assert!(tier2.output.contains("withheld"));
        assert!(!wt.join(".machina").join("holdbacks").exists());
        assert!(wt.join(".machina").join("feedback").join("attempt-1.md").exists());

        // Attempt 2: also edits a file outside src/**, exhausting the one correction.
        fs::write(wt.join("README.md"), "changed\n").unwrap();
        mgr.start_gate("WO-1", None).unwrap();
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::GATING);
        let gate = wo.last_gate.as_ref().unwrap();
        assert_eq!(gate.scope_violations, vec!["README.md".to_string()]);
        assert_eq!(wo.status, WorkOrderStatus::ON_HOLD);
        assert_eq!(wo.hold.as_ref().unwrap().reason, HoldReason::MAX_CORRECTIONS_EXCEEDED);

        mgr.resolve_hold(ResolveHoldRequest {
            work_order_id: "WO-1".to_string(),
            option_id: "grant_attempt".to_string(),
        })
        .unwrap();

        // Attempt 3: README restored, output matches the holdback.
        fs::write(wt.join("README.md"), "readme\n").unwrap();
        fs::write(wt.join("src").join("a.txt"), "hello world\n").unwrap();
        mgr.start_gate("WO-1", None).unwrap();
        let wo = wait_while(&mgr, "WO-1", WorkOrderStatus::GATING);
        let gate = wo.last_gate.as_ref().unwrap();
        assert_eq!(gate.verdict, GateVerdict::PASS, "{:?}", gate.reasons);
        assert_eq!(gate.changed_files, vec!["src/a.txt".to_string()]);
        assert_eq!(wo.status, WorkOrderStatus::AWAITING_ACCEPTANCE);

        let wo = mgr.accept_and_merge("WO-1").unwrap();
        assert_eq!(wo.status, WorkOrderStatus::COMPLETED);
        let merged = wo.merge_commit.clone().unwrap();
        assert_eq!(sh_git(&repo, &["rev-parse", "HEAD"]).trim(), merged);
        assert_eq!(fs::read_to_string(repo.join("src").join("a.txt")).unwrap(), "hello world\n");
        assert!(wo.worktree_removed);
        assert!(!wt.exists());

        // State survives a restart, which bumps the epoch.
        let reloaded = MachinaManager::with_paths(root.join("state.json"), root.join("vault"));
        assert_eq!(reloaded.status().epoch, 2);
        assert_eq!(reloaded.get("WO-1").unwrap().status, WorkOrderStatus::COMPLETED);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unreadable_state_is_moved_aside() {
        let dir = std::env::temp_dir().join(format!("machina-state-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        fs::write(&path, "{\"not\": \"a state\"}").unwrap();
        assert!(load_state(&path).is_none());
        assert!(!path.exists());
        let moved = fs::read_dir(&dir).unwrap().count();
        assert_eq!(moved, 1);
        let _ = fs::remove_dir_all(dir);
    }
}
