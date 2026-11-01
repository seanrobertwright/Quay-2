//! The one place Quay runs `praxis` headless (#228, #446). Each call is bounded by
//! [`CallBounds`], identical calls in flight share one process, any caller can cancel its own
//! call, and each outcome that says something about the host, see [`condition_after`], updates
//! its project's [`HostCondition`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use uuid::Uuid;

use super::launch::{self, Launch, LookupEnv};
use super::outcome::{condition_after, interpret, CallOutcome, HostCondition, Verb};
use super::process::{self, Bounds, Ended};
use super::settings::{PraxisCliSettings, SettingsStore};

/// How long each kind of call may take and how much output it may print.
#[derive(Debug, Clone, Copy)]
pub struct CallBounds {
    pub read: Duration,
    /// Run creation: `run`'s own resends can take about 64 s (#362).
    pub create: Duration,
    pub stdout_cap: usize,
    pub stderr_cap: usize,
    /// How long `node --version` may take.
    pub node_check: Duration,
}

impl Default for CallBounds {
    fn default() -> Self {
        Self {
            read: Duration::from_secs(15),
            create: Duration::from_secs(75),
            stdout_cap: 8 * 1024 * 1024,
            stderr_cap: 64 * 1024,
            node_check: Duration::from_secs(10),
        }
    }
}

/// How long a found `praxis` is trusted before it is looked up again. A failed lookup is never
/// kept, so linking the CLI takes effect on the next call.
const LAUNCH_FRESH_FOR: Duration = Duration::from_secs(60);

/// A project's host condition changed, as the `praxis-host-condition` event carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionChange {
    pub project_path: String,
    pub condition: HostCondition,
}

type Listener = Box<dyn Fn(&ConditionChange) + Send + Sync>;

/// One process that one or more identical calls are waiting on.
struct InFlight {
    outcome: Mutex<Option<CallOutcome>>,
    ready: Condvar,
    /// How many callers are still waiting. Changed only under [`Inner::calls`]'s lock.
    waiting: Mutex<usize>,
    kill: AtomicBool,
}

/// What identifies identical calls: the script and every argument.
type CallKey = (PathBuf, Vec<String>);

struct Inner {
    settings: SettingsStore,
    bounds: CallBounds,
    lookup: Box<dyn Fn() -> LookupEnv + Send + Sync>,
    launch: Mutex<Option<(Instant, PraxisCliSettings, Launch)>>,
    calls: Mutex<HashMap<CallKey, Arc<InFlight>>>,
    cancels: Mutex<HashMap<Uuid, Arc<AtomicBool>>>,
    conditions: Mutex<HashMap<String, HostCondition>>,
    listener: Mutex<Option<Listener>>,
}

/// The Praxis CLI runner, Tauri-managed state.
#[derive(Clone)]
pub struct PraxisCli {
    inner: Arc<Inner>,
}

impl Default for PraxisCli {
    fn default() -> Self {
        Self::new()
    }
}

impl PraxisCli {
    /// The runner Quay uses: its settings in `praxis-cli.json` in Quay's storage folder, and the
    /// default bounds.
    pub fn new() -> Self {
        Self::with(
            crate::slices::workspace::manager::storage_dir().join("praxis-cli.json"),
            CallBounds::default(),
            LookupEnv::from_process,
        )
    }

    pub fn with(settings_path: PathBuf, bounds: CallBounds, lookup: impl Fn() -> LookupEnv + Send + Sync + 'static) -> Self {
        Self {
            inner: Arc::new(Inner {
                settings: SettingsStore::at(settings_path),
                bounds,
                lookup: Box::new(lookup),
                launch: Mutex::new(None),
                calls: Mutex::new(HashMap::new()),
                cancels: Mutex::new(HashMap::new()),
                conditions: Mutex::new(HashMap::new()),
                listener: Mutex::new(None),
            }),
        }
    }

    /// Calls `listener` whenever a project's host condition changes.
    pub fn on_condition_changed(&self, listener: impl Fn(&ConditionChange) + Send + Sync + 'static) {
        *lock(&self.inner.listener) = Some(Box::new(listener));
    }

    pub fn settings(&self) -> PraxisCliSettings {
        self.inner.settings.read()
    }

    /// Checks and stores `settings`; the next call looks `praxis` up again under them.
    pub fn write_settings(&self, settings: PraxisCliSettings) -> Result<PraxisCliSettings, String> {
        let written = self.inner.settings.write(settings)?;
        *lock(&self.inner.launch) = None;
        Ok(written)
    }

    /// `project`'s host condition: [`HostCondition::NotCheckedYet`] until a call for it ends.
    pub fn condition(&self, project: &Path) -> HostCondition {
        lock(&self.inner.conditions).get(&project_key(project)).cloned().unwrap_or(HostCondition::NotCheckedYet)
    }

    /// Cancels the call `call_id`: it returns [`CallOutcome::Cancelled`] at once, and its
    /// process is killed once no other identical call is waiting on it. An id with no running
    /// call is ignored.
    pub fn cancel(&self, call_id: Uuid) {
        if let Some(flag) = lock(&self.inner.cancels).get(&call_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// How to start `praxis`, and the `--state` folder to pass, under the current settings.
    pub fn launch(&self) -> Result<(Launch, Option<PathBuf>), String> {
        let settings = self.inner.settings.read();
        let checked = settings.check()?;
        {
            let cached = lock(&self.inner.launch);
            if let Some((at, for_settings, launch)) = cached.as_ref()
                && *for_settings == settings
                && at.elapsed() < LAUNCH_FRESH_FOR
            {
                return Ok((launch.clone(), checked.installation));
            }
        }
        // Looked up outside the lock, so a slow `node --version` never holds up other calls.
        let env = (self.inner.lookup)();
        let script = launch::find_script(checked.checkout_script.as_deref(), &env)?;
        let node = launch::find_node(&env)?;
        self.check_node(&node)?;
        let found = Launch { node, script };
        *lock(&self.inner.launch) = Some((Instant::now(), settings, found.clone()));
        Ok((found, checked.installation))
    }

    fn check_node(&self, node: &Path) -> Result<(), String> {
        let mut cmd = crate::spawn::hidden_command(node);
        cmd.arg("--version");
        let bounds = Bounds { timeout: self.inner.bounds.node_check, stdout_cap: 4096, stderr_cap: 4096 };
        match process::run(cmd, &bounds, &AtomicBool::new(false)) {
            Ended::Exited { code: Some(0), stdout, .. } => launch::check_node_version(&String::from_utf8_lossy(&stdout)),
            Ended::SpawnFailed(e) | Ended::WaitFailed(e) => Err(format!("Quay couldn't run {}: {}", node.display(), e)),
            _ => Err(format!("{} --version didn't answer.", node.display())),
        }
    }

    /// Runs `praxis <args> --json`, with `--state` when an installation is set, for `project`,
    /// and updates `project`'s host condition from the outcome. Blocks until it ends.
    pub fn call(&self, project: &Path, verb: Verb, args: &[String], call_id: Uuid) -> CallOutcome {
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.inner.cancels).insert(call_id, cancel.clone());
        let outcome = match self.launch() {
            Ok(_) if cancel.load(Ordering::SeqCst) => CallOutcome::Cancelled,
            Ok((launch, state)) => {
                let mut argv = args.to_vec();
                argv.push("--json".into());
                if let Some(state) = state {
                    argv.push("--state".into());
                    argv.push(state.to_string_lossy().into_owned());
                }
                self.shared(project, verb, launch, argv, &cancel)
            }
            Err(reason) => CallOutcome::CliNotFound { reason },
        };
        {
            // A caller that reused `call_id` for another call keeps its own entry.
            let mut cancels = lock(&self.inner.cancels);
            if cancels.get(&call_id).is_some_and(|flag| Arc::ptr_eq(flag, &cancel)) {
                cancels.remove(&call_id);
            }
        }
        if let Some(condition) = condition_after(&outcome) {
            self.set_condition(project, condition);
        }
        outcome
    }

    /// Joins the identical call in flight, or starts one, and waits for it or for `cancel`.
    fn shared(&self, project: &Path, verb: Verb, launch: Launch, argv: Vec<String>, cancel: &AtomicBool) -> CallOutcome {
        let key: CallKey = (launch.script.clone(), argv.clone());
        let flight = {
            let mut calls = lock(&self.inner.calls);
            match calls.get(&key) {
                Some(flight) => {
                    *lock(&flight.waiting) += 1;
                    flight.clone()
                }
                None => {
                    let flight = Arc::new(InFlight { outcome: Mutex::new(None), ready: Condvar::new(), waiting: Mutex::new(1), kill: AtomicBool::new(false) });
                    calls.insert(key.clone(), flight.clone());
                    self.start(project, verb, launch, argv, key.clone(), flight.clone());
                    flight
                }
            }
        };
        let mut outcome = lock(&flight.outcome);
        loop {
            if let Some(done) = outcome.as_ref() {
                return done.clone();
            }
            if cancel.load(Ordering::SeqCst) {
                drop(outcome);
                self.leave(&key, &flight);
                return CallOutcome::Cancelled;
            }
            outcome = flight.ready.wait_timeout(outcome, Duration::from_millis(25)).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    /// A cancelled caller stops waiting on `flight`; the last one to go kills its process, and
    /// takes it out of the map so a later identical call starts afresh.
    fn leave(&self, key: &CallKey, flight: &Arc<InFlight>) {
        let mut calls = lock(&self.inner.calls);
        let mut waiting = lock(&flight.waiting);
        *waiting -= 1;
        if *waiting == 0 {
            flight.kill.store(true, Ordering::SeqCst);
            if calls.get(key).is_some_and(|f| Arc::ptr_eq(f, flight)) {
                calls.remove(key);
            }
        }
    }

    fn start(&self, project: &Path, verb: Verb, launch: Launch, argv: Vec<String>, key: CallKey, flight: Arc<InFlight>) {
        let inner = self.inner.clone();
        let project = project.to_path_buf();
        std::thread::spawn(move || {
            let mut cmd = crate::spawn::hidden_command(&launch.node);
            // No command reads its working folder, which is why identical calls from two
            // projects can share one process.
            cmd.current_dir(&project).arg(&launch.script).args(&argv);
            let bounds = Bounds {
                timeout: if verb.creates() { inner.bounds.create } else { inner.bounds.read },
                stdout_cap: inner.bounds.stdout_cap,
                stderr_cap: inner.bounds.stderr_cap,
            };
            let outcome = match process::run(cmd, &bounds, &flight.kill) {
                Ended::Exited { code, stdout, stderr } => interpret(verb, code, &stdout, &stderr),
                Ended::TimedOut => CallOutcome::TimedOut,
                Ended::StdoutOverflow => CallOutcome::Refused {
                    message: format!("praxis printed more than {} MiB, so Quay stopped it.", bounds.stdout_cap / (1024 * 1024)),
                },
                Ended::Killed => CallOutcome::Cancelled,
                Ended::SpawnFailed(e) => CallOutcome::CliNotFound { reason: format!("Quay couldn't start praxis: {e}") },
                Ended::WaitFailed(e) => CallOutcome::Refused { message: format!("Quay lost track of praxis: {e}") },
            };
            {
                let mut calls = lock(&inner.calls);
                if calls.get(&key).is_some_and(|f| Arc::ptr_eq(f, &flight)) {
                    calls.remove(&key);
                }
            }
            *lock(&flight.outcome) = Some(outcome);
            flight.ready.notify_all();
        });
    }

    fn set_condition(&self, project: &Path, condition: HostCondition) {
        let key = project_key(project);
        let changed = {
            let mut conditions = lock(&self.inner.conditions);
            if conditions.get(&key) == Some(&condition) {
                false
            } else {
                conditions.insert(key.clone(), condition.clone());
                true
            }
        };
        if changed && let Some(listener) = lock(&self.inner.listener).as_ref() {
            listener(&ConditionChange { project_path: key, condition });
        }
    }
}

/// The key a project's condition is kept under: its root, as the commands resolve it, written
/// without the `\\?\` prefix of a canonical Windows path.
fn project_key(project: &Path) -> String {
    crate::slices::praxis::store::display_path(project).unwrap_or_else(|_| project.to_string_lossy().into_owned())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
