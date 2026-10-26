use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::models::{
    ClaudeStatus, PermissionMode, PersistedTerminalSession, RunKind, SpawnTerminalRequest,
    TerminalInfo, TerminalOutputPayload, TerminalStatusPayload,
};
use super::osc7501::{AntigravityTurn, TurnReport};
use super::plugin_watch::{LaunchRef, PluginWatch, PLUGIN_SILENCE};
use super::session::{Osc7501Hook, PtySession};

/// Pause between typing a prompt and pressing Enter, so the two arrive as separate reads
const PROMPT_SUBMIT_DELAY: Duration = Duration::from_millis(250);

/// What the status watcher runs, with the id of the terminal whose status moved.
type StatusWatcher = Arc<dyn Fn(&str) + Send + Sync>;

/// What the server watcher runs, with a launch whose CLI serves its own events and the
/// loopback port it serves them on.
type ServerWatcher = Arc<dyn Fn(LaunchRef, u16) + Send + Sync>;

/// A free loopback port for a launch's CLI to serve its events on, for a CLI that serves
/// them (OpenCode), or `None`.
fn server_port_for(run_kind: RunKind) -> Result<Option<u16>, String> {
    if run_kind != RunKind::OpenCode {
        return Ok(None);
    }
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| Some(addr.port()))
        .map_err(|e| format!("Failed to find a free port for OpenCode's server: {}", e))
}

/// What a terminal's own output says about its turn, as the turn watcher hears it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnEvent {
    /// A turn started.
    Started,
    /// What a sender waiting on the running turn is told.
    Answered(String),
}

/// What the turn watcher runs, with the id of the terminal whose output reported the turn.
type TurnWatcher = Arc<dyn Fn(&str, TurnEvent) + Send + Sync>;

static LAST_CREATED_AT: Mutex<u64> = Mutex::new(0);

pub fn next_created_at() -> u64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut last = LAST_CREATED_AT.lock();
    let next = if now > *last { now } else { *last + 1 };
    *last = next;
    next
}

fn get_sessions_dir() -> PathBuf {
    #[cfg(test)]
    {
        let t = std::env::temp_dir().join("quay2_test_sessions");
        let _ = std::fs::create_dir_all(&t);
        t
    }
    #[cfg(not(test))]
    {
        let base_dir = if let Ok(local) = std::env::var("LOCALAPPDATA") {
            PathBuf::from(local).join("Quay2").join("sessions")
        } else {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home).join(".quay2").join("sessions")
        };
        let _ = std::fs::create_dir_all(&base_dir);
        base_dir
    }
}

/// The session list saved at `path`. A missing file means none. A file that can't be
/// parsed is logged and renamed to `sessions.json.corrupt-<ms>`, so the next save
/// can't overwrite what's left of it.
fn read_session_list(path: &Path) -> Vec<PersistedTerminalSession> {
    // Read as bytes so that invalid UTF-8 counts as unparseable, not unreadable
    let content = match std::fs::read(path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(e) => {
            tracing::error!("Could not read saved terminals from {}: {}", path.display(), e);
            return Vec::new();
        }
    };
    match serde_json::from_slice::<Vec<PersistedTerminalSession>>(&content) {
        Ok(list) => list,
        Err(e) => {
            let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
            let aside = path.with_file_name(format!("{}.corrupt-{}", name, crate::dates::now_ms()));
            tracing::error!(
                "Saved terminals in {} are unreadable ({}); moving the file to {}",
                path.display(),
                e,
                aside.display()
            );
            if let Err(e) = std::fs::rename(path, &aside) {
                tracing::error!("Could not move {} aside: {}", path.display(), e);
            }
            Vec::new()
        }
    }
}

/// Saves the session list to `path` through a temp file and rename, so a crash
/// mid-save leaves the previous list in place.
fn write_session_list(path: &Path, list: &[PersistedTerminalSession]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    crate::atomic_file::write_atomic(path, json.as_bytes())
        .map_err(|e| format!("cannot write {}: {}", path.display(), e))
}

fn read_saved_scrollback(terminal_id: &str) -> (String, u64) {
    let log_path = get_sessions_dir().join(format!("{}.log", terminal_id));
    if let Ok(bytes) = std::fs::read(&log_path) {
        let max_len = 256 * 1024;
        let slice = if bytes.len() > max_len {
            let start = bytes.len() - max_len;
            let mut cut = start;
            while cut < bytes.len() && (bytes[cut] & 0xC0) == 0x80 {
                cut += 1;
            }
            &bytes[cut..]
        } else {
            &bytes[..]
        };
        (String::from_utf8_lossy(slice).to_string(), 0)
    } else {
        (String::new(), 0)
    }
}

/// The spawn request that restarts a terminal from its stored info. It carries no launch
/// prompt: that was the first turn of the terminal's first run, and is never resent.
fn relaunch_request(
    info: &TerminalInfo,
    rows: Option<u16>,
    cols: Option<u16>,
    env_vars: Option<HashMap<String, String>>,
) -> SpawnTerminalRequest {
    SpawnTerminalRequest {
        id: Some(info.id.clone()),
        name: Some(info.name.clone()),
        project_path: info.project_path.clone(),
        run_kind: info.run_kind,
        permission_mode: Some(info.permission_mode),
        command_text: info.command_text.clone(),
        rows,
        cols,
        env_vars,
        custom_flags: info.custom_flags.clone(),
        initial_prompt: None,
    }
}

/// Moves a Starting terminal that has printed to its CLI's status after first output
/// (see `RunKind::status_after_first_output`). Returns whether the status moved.
fn settle_after_first_output(info: &mut TerminalInfo) -> bool {
    match info.run_kind.status_after_first_output() {
        Some(status) if info.claude_status == ClaudeStatus::Starting => {
            info.claude_status = status;
            true
        }
        _ => false,
    }
}

fn status_payload(info: &TerminalInfo) -> TerminalStatusPayload {
    TerminalStatusPayload {
        terminal_id: info.id.clone(),
        claude_status: info.claude_status.clone(),
        plugin_hint: info.plugin_hint,
    }
}

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    terminals_info: Arc<Mutex<HashMap<String, TerminalInfo>>>,
    dormant_buffers: Arc<Mutex<HashMap<String, (String, u64)>>>,
    /// Each running terminal's current launch. Lock before `terminals_info` when taking both.
    plugin_watches: Arc<Mutex<HashMap<String, PluginWatch>>>,
    /// One lock per terminal, held from a prompt's text to its Enter, so two prompts never interleave.
    submit_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    status_watcher: Arc<Mutex<Option<StatusWatcher>>>,
    server_watcher: Arc<Mutex<Option<ServerWatcher>>>,
    turn_watcher: Arc<Mutex<Option<TurnWatcher>>>,
    /// What tests typed into each test terminal, which stands in for its PTY.
    #[cfg(test)]
    test_input: Arc<Mutex<HashMap<String, Vec<String>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            terminals_info: Arc::new(Mutex::new(HashMap::new())),
            dormant_buffers: Arc::new(Mutex::new(HashMap::new())),
            plugin_watches: Arc::new(Mutex::new(HashMap::new())),
            submit_locks: Arc::new(Mutex::new(HashMap::new())),
            status_watcher: Arc::new(Mutex::new(None)),
            server_watcher: Arc::new(Mutex::new(None)),
            turn_watcher: Arc::new(Mutex::new(None)),
            #[cfg(test)]
            test_input: Arc::new(Mutex::new(HashMap::new())),
        };
        manager.load_persisted_sessions();
        manager
    }

    pub fn load_persisted_sessions(&self) {
        let list = read_session_list(&get_sessions_dir().join("sessions.json"));
        let mut info_map = self.terminals_info.lock();
        let mut dormant_map = self.dormant_buffers.lock();

        for (idx, item) in list.into_iter().enumerate() {
            let (scrollback, seq) = read_saved_scrollback(&item.id);
            dormant_map.insert(item.id.clone(), (scrollback, seq));

            let created_at = if item.created_at > 0 {
                item.created_at
            } else if item.last_updated > 0 {
                item.last_updated + idx as u64
            } else {
                next_created_at()
            };

            {
                let mut last = LAST_CREATED_AT.lock();
                if created_at > *last {
                    *last = created_at;
                }
            }

            // A Pi session an older Quay saved as Ask comes back as Skip, since Pi never asks
            let permission_mode = item.run_kind.permission_mode(Some(item.permission_mode));
            let info = TerminalInfo {
                id: item.id.clone(),
                name: item.name,
                project_path: item.project_path,
                run_kind: item.run_kind,
                permission_mode,
                live_mode: permission_mode,
                claude_status: ClaudeStatus::Exited,
                auto_approved_count: item.auto_approved_count,
                exit_code: Some(0),
                task_title: item.task_title,
                current_tool: None,
                custom_name: item.custom_name,
                custom_flags: item.custom_flags,
                command_text: item.command_text,
                created_at,
                plugin_hint: false,
            };
            info_map.insert(item.id, info);
        }
    }

    pub fn save_sessions_to_disk(&self) {
        let info_map = self.terminals_info.lock();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let mut list: Vec<PersistedTerminalSession> = info_map
            .values()
            .map(|info| PersistedTerminalSession {
                id: info.id.clone(),
                name: info.name.clone(),
                project_path: info.project_path.clone(),
                run_kind: info.run_kind,
                permission_mode: info.permission_mode,
                task_title: info.task_title.clone(),
                custom_name: info.custom_name,
                auto_approved_count: info.auto_approved_count,
                command_text: info.command_text.clone(),
                custom_flags: info.custom_flags.clone(),
                last_updated: now,
                created_at: info.created_at,
            })
            .collect();

        list.sort_by_key(|s| s.created_at);

        // Still under the terminals lock, so saves can't overtake each other
        if let Err(e) = write_session_list(&get_sessions_dir().join("sessions.json"), &list) {
            tracing::error!("Could not save terminals: {}", e);
        }
    }

    pub fn spawn(
        &self,
        request: SpawnTerminalRequest,
        bridge_port: u16,
        bridge_token: String,
        app_handle: AppHandle,
    ) -> Result<TerminalInfo, String> {
        let terminal_id = request
            .id
            .clone()
            .unwrap_or_else(|| format!("term-{}", Uuid::new_v4().simple()));

        let start_seq = self.last_seq(&terminal_id);
        let server_port = server_port_for(request.run_kind)?;
        let launch_ref = self.begin_launch(&terminal_id, request.run_kind);
        let on_first_output = self.first_output_hook(launch_ref.clone(), app_handle.clone());
        let on_osc7501 = self.osc7501_hook(request.run_kind, &launch_ref, &app_handle);
        let on_exit = self.exit_hook(launch_ref.clone());
        let session = PtySession::spawn(
            request.clone(),
            terminal_id.clone(),
            start_seq,
            bridge_port,
            bridge_token,
            server_port,
            app_handle,
            on_first_output,
            on_osc7501,
            on_exit,
        )?;

        let created_at = next_created_at();

        let info = TerminalInfo {
            id: terminal_id.clone(),
            name: session.name.clone(),
            project_path: session.project_path.clone(),
            run_kind: session.run_kind,
            permission_mode: session.permission_mode,
            live_mode: session.permission_mode,
            claude_status: if session.run_kind.is_agent() {
                ClaudeStatus::Starting
            } else {
                ClaudeStatus::Unknown
            },
            auto_approved_count: 0,
            exit_code: None,
            task_title: None,
            current_tool: None,
            custom_name: request.name.is_some(),
            custom_flags: request.custom_flags.clone(),
            command_text: request.command_text.clone(),
            created_at,
            plugin_hint: false,
        };

        self.dormant_buffers.lock().remove(&terminal_id);
        self.sessions.lock().insert(terminal_id, session);
        let info = self.insert_launched(&launch_ref, info);
        self.save_sessions_to_disk();
        self.notify_server_watcher(launch_ref, server_port);

        Ok(info)
    }

    pub fn relaunch(
        &self,
        terminal_id: &str,
        rows: Option<u16>,
        cols: Option<u16>,
        bridge_port: u16,
        bridge_token: String,
        env_vars: Option<HashMap<String, String>>,
        app_handle: AppHandle,
    ) -> Result<TerminalInfo, String> {
        let info = {
            let info_map = self.terminals_info.lock();
            info_map.get(terminal_id).cloned().ok_or_else(|| {
                format!("Terminal {} not found to relaunch", terminal_id)
            })?
        };

        // Read before the old session goes: its pane stays mounted and has seen up to this seq
        let start_seq = self.last_seq(terminal_id);

        let server_port = server_port_for(info.run_kind)?;
        // Begin the new launch before the old session goes, so the old process's exit, which
        // dropping its session causes, finds its launch over and leaves the terminal alone
        let launch_ref = self.begin_launch(terminal_id, info.run_kind);

        // If an active session is running, terminate it before relaunching
        {
            let mut sessions = self.sessions.lock();
            sessions.remove(terminal_id);
        }

        let request = relaunch_request(&info, rows, cols, env_vars);
        let on_first_output = self.first_output_hook(launch_ref.clone(), app_handle.clone());
        let on_osc7501 = self.osc7501_hook(info.run_kind, &launch_ref, &app_handle);
        let on_exit = self.exit_hook(launch_ref.clone());
        let session = PtySession::spawn(
            request,
            terminal_id.to_string(),
            start_seq,
            bridge_port,
            bridge_token,
            server_port,
            app_handle,
            on_first_output,
            on_osc7501,
            on_exit,
        )?;

        let mut updated_info = info;
        updated_info.claude_status = if updated_info.run_kind.is_agent() {
            ClaudeStatus::Starting
        } else {
            ClaudeStatus::Unknown
        };
        updated_info.exit_code = None;
        updated_info.plugin_hint = false;

        let sessions = self.sessions.clone();
        let id = terminal_id.to_string();
        let attach = move || {
            sessions.lock().insert(id, session);
        };
        let updated_info = match self.relist_launched(&launch_ref, updated_info, attach) {
            Ok(info) => info,
            Err(unattached) => {
                // Dropping the session ends its process. Its reader may have written a
                // new log after the close deleted the old one.
                drop(unattached);
                if self.get_info(terminal_id).is_none() {
                    let log_path = get_sessions_dir().join(format!("{}.log", terminal_id));
                    let _ = std::fs::remove_file(log_path);
                }
                return Err(format!(
                    "Terminal {} was closed or relaunched again while it relaunched",
                    terminal_id
                ));
            }
        };
        self.dormant_buffers.lock().remove(terminal_id);
        self.save_sessions_to_disk();
        self.notify_server_watcher(launch_ref, server_port);

        Ok(updated_info)
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        #[cfg(test)]
        if let Some(input) = self.test_input.lock().get_mut(terminal_id) {
            input.push(data.to_string());
            return Ok(());
        }
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(terminal_id) {
            session.write(data)
        } else {
            Err(format!("Terminal {} not found or inactive", terminal_id))
        }
    }

    /// Types `prompt` into an agent terminal and presses Enter, as one unit: another prompt
    /// to the same terminal waits until this one's Enter is in. Agent TUIs read text and
    /// Enter that arrive in one chunk as a paste and leave it unsent, so Enter is a separate
    /// write `PROMPT_SUBMIT_DELAY` later, and the call blocks for that long. It fails when
    /// either write fails.
    pub fn submit_prompt(&self, terminal_id: &str, prompt: &str) -> Result<(), String> {
        let unit = self
            .submit_locks
            .lock()
            .entry(terminal_id.to_string())
            .or_default()
            .clone();
        let _unit = unit.lock();
        self.write(terminal_id, prompt)?;
        std::thread::sleep(PROMPT_SUBMIT_DELAY);
        self.write(terminal_id, "\r")
            .map_err(|e| format!("Typed the prompt but couldn't press Enter: {}", e))
    }

    pub fn resize(&self, terminal_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(terminal_id) {
            session.resize(rows, cols)
        } else {
            Err(format!("Terminal {} not found or inactive", terminal_id))
        }
    }

    /// The last output seq sent under `terminal_id`, from its session or its dormant buffer
    /// (0 when there is neither). A session that replaces it numbers its output above this.
    fn last_seq(&self, terminal_id: &str) -> u64 {
        if let Some(session) = self.sessions.lock().get(terminal_id) {
            return session.last_seq();
        }
        self.dormant_buffers
            .lock()
            .get(terminal_id)
            .map(|(_, seq)| *seq)
            .unwrap_or(0)
    }

    pub fn get_output(&self, terminal_id: &str) -> Result<TerminalOutputPayload, String> {
        // 1. Check active running session
        {
            let sessions = self.sessions.lock();
            if let Some(session) = sessions.get(terminal_id) {
                return Ok(session.get_output());
            }
        }

        // 2. Check dormant buffer
        {
            let dormant = self.dormant_buffers.lock();
            if let Some((data, last_seq)) = dormant.get(terminal_id) {
                return Ok(TerminalOutputPayload {
                    terminal_id: terminal_id.to_string(),
                    data: data.clone(),
                    last_seq: *last_seq,
                    rows: None,
                    cols: None,
                });
            }
        }

        // 3. Fallback: try reading saved scrollback from disk
        let (data, seq) = read_saved_scrollback(terminal_id);
        if !data.is_empty() {
            self.dormant_buffers.lock().insert(terminal_id.to_string(), (data.clone(), seq));
            return Ok(TerminalOutputPayload {
                terminal_id: terminal_id.to_string(),
                data,
                last_seq: seq,
                rows: None,
                cols: None,
            });
        }

        Err(format!("Terminal {} not found", terminal_id))
    }

    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        // 1. End the current launch first, so a relaunch still starting sees the terminal
        //    closed and never lists it or its session again (see `relist_launched`)
        self.plugin_watches.lock().remove(terminal_id);
        self.submit_locks.lock().remove(terminal_id);

        // 2. Terminate running session process if active
        {
            let mut sessions = self.sessions.lock();
            sessions.remove(terminal_id);
        }

        // 3. Remove from terminals_info and dormant_buffers
        let removed = {
            let mut info_map = self.terminals_info.lock();
            info_map.remove(terminal_id).is_some()
        };
        self.dormant_buffers.lock().remove(terminal_id);

        // 4. Clean up disk files
        let log_path = get_sessions_dir().join(format!("{}.log", terminal_id));
        let _ = std::fs::remove_file(log_path);
        self.save_sessions_to_disk();

        if removed {
            self.notify_status_watcher(terminal_id);
            Ok(())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    /// Runs `watcher` with a terminal's id when its status moves outside the bridge's event
    /// route: its first output moves it out of Starting, the plugin silence clock makes it
    /// Unknown, an OSC 7501 sequence moves it (`apply_turn_report`), or the terminal closes.
    /// It runs on the thread that moved the status, with no lock of this manager held.
    pub fn set_status_watcher(&self, watcher: impl Fn(&str) + Send + Sync + 'static) {
        *self.status_watcher.lock() = Some(Arc::new(watcher));
    }

    fn notify_status_watcher(&self, terminal_id: &str) {
        let watcher = self.status_watcher.lock().clone();
        if let Some(watcher) = watcher {
            watcher(terminal_id);
        }
    }

    /// Runs `watcher` with each launch whose CLI serves its own events (OpenCode), and the
    /// loopback port it serves them on, once the launch's terminal is listed. It runs on the
    /// thread that spawned the terminal, with no lock of this manager held.
    pub fn set_server_watcher(&self, watcher: impl Fn(LaunchRef, u16) + Send + Sync + 'static) {
        *self.server_watcher.lock() = Some(Arc::new(watcher));
    }

    fn notify_server_watcher(&self, launch: LaunchRef, server_port: Option<u16>) {
        let watcher = self.server_watcher.lock().clone();
        if let (Some(watcher), Some(port)) = (watcher, server_port) {
            watcher(launch, port);
        }
    }

    /// Whether `launch` is its terminal's current launch: the terminal is open and hasn't
    /// been relaunched since.
    pub fn launch_current(&self, launch: &LaunchRef) -> bool {
        launch.current_in(&mut self.plugin_watches.lock()).is_some()
    }

    /// Whether `launch` is its terminal's current launch and the terminal hasn't exited.
    pub fn launch_running(&self, launch: &LaunchRef) -> bool {
        let mut watches = self.plugin_watches.lock();
        if launch.current_in(&mut watches).is_none() {
            return false;
        }
        self.terminals_info
            .lock()
            .get(&launch.terminal_id)
            .is_some_and(|info| info.claude_status != ClaudeStatus::Exited)
    }

    /// Shows the terminal Unknown when `launch` is still running and Quay can no longer see
    /// its turns, and tells the status watcher. Returns the new status when it moved.
    pub fn lose_turn_sight(&self, launch: &LaunchRef) -> Option<TerminalStatusPayload> {
        let payload = {
            let mut watches = self.plugin_watches.lock();
            launch.current_in(&mut watches)?;
            let mut info_map = self.terminals_info.lock();
            let info = info_map.get_mut(&launch.terminal_id)?;
            if matches!(info.claude_status, ClaudeStatus::Exited | ClaudeStatus::Unknown) {
                return None;
            }
            info.claude_status = ClaudeStatus::Unknown;
            status_payload(info)
        };
        self.notify_status_watcher(&launch.terminal_id);
        Some(payload)
    }

    /// Runs `watcher` with a terminal's id and what its own output says about its turn, from
    /// Antigravity's OSC 7501 sequences (see `apply_turn_report`). It runs on the PTY reader
    /// thread, with no lock of this manager held.
    pub fn set_turn_watcher(&self, watcher: impl Fn(&str, TurnEvent) + Send + Sync + 'static) {
        *self.turn_watcher.lock() = Some(Arc::new(watcher));
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        let mut list: Vec<TerminalInfo> = self.terminals_info.lock().values().cloned().collect();
        list.sort_by_key(|t| t.created_at);
        list
    }

    pub fn get_info(&self, terminal_id: &str) -> Option<TerminalInfo> {
        self.terminals_info.lock().get(terminal_id).cloned()
    }

    /// Puts `info` in the terminal list without opening a PTY. What is typed into it is kept
    /// for `test_input` until `close_test_input`.
    #[cfg(test)]
    pub fn insert_test_terminal(&self, info: TerminalInfo) {
        self.test_input.lock().insert(info.id.clone(), Vec::new());
        self.terminals_info.lock().insert(info.id.clone(), info);
    }

    /// Everything typed into test terminal `terminal_id`, one entry per write.
    #[cfg(test)]
    pub fn test_input(&self, terminal_id: &str) -> Vec<String> {
        self.test_input.lock().get(terminal_id).cloned().unwrap_or_default()
    }

    /// Makes every later write to test terminal `terminal_id` fail, as a closed PTY does.
    #[cfg(test)]
    pub fn close_test_input(&self, terminal_id: &str) {
        self.test_input.lock().remove(terminal_id);
    }

    pub fn update_status(&self, terminal_id: &str, status: ClaudeStatus) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.claude_status = status;
        }
    }

    /// Starts a new launch of `terminal_id`: no plugin heard and no clock running.
    pub fn begin_launch(&self, terminal_id: &str, run_kind: RunKind) -> LaunchRef {
        let watch = PluginWatch::new(run_kind);
        let launch = LaunchRef {
            terminal_id: terminal_id.to_string(),
            launch: watch.launch(),
        };
        self.plugin_watches.lock().insert(terminal_id.to_string(), watch);
        launch
    }

    /// What a launch's PTY reader runs on its first output: it moves a terminal that has no
    /// plugin out of Starting, and for a Claude terminal starts the plugin silence clock and,
    /// once that has run, sends `terminal-status` if the terminal went Unknown.
    fn first_output_hook(
        &self,
        launch: LaunchRef,
        app_handle: AppHandle,
    ) -> Box<dyn FnOnce() + Send> {
        let manager = self.clone();
        Box::new(move || {
            let starts_clock = manager.note_first_output(&launch, Instant::now());
            if let Some(status) = manager.apply_first_output_status(&launch) {
                let _ = app_handle.emit("terminal-status", status);
            }
            if !starts_clock {
                return;
            }
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(PLUGIN_SILENCE).await;
                if let Some(status) = manager.check_plugin_silence(&launch, Instant::now()) {
                    let _ = app_handle.emit("terminal-status", status);
                    manager.notify_status_watcher(&launch.terminal_id);
                }
            });
        })
    }

    /// Records the first output of `launch` at `now`. Returns true when that starts the
    /// plugin silence clock; the caller then calls `check_plugin_silence` once it has run.
    pub fn note_first_output(&self, launch: &LaunchRef, now: Instant) -> bool {
        launch
            .current_in(&mut self.plugin_watches.lock())
            .is_some_and(|watch| watch.first_output(now))
    }

    /// Moves the terminal out of Starting once `launch`, still current, has printed (see
    /// `RunKind::status_after_first_output`), and tells the status watcher, since a terminal
    /// that left Starting may stop holding its messages. Returns the new status when it moved.
    /// Nothing moves when the terminal isn't listed yet; `insert_launched` applies the rule then.
    pub fn apply_first_output_status(&self, launch: &LaunchRef) -> Option<TerminalStatusPayload> {
        let moved = {
            let mut watches = self.plugin_watches.lock();
            launch.current_in(&mut watches)?;
            let mut info_map = self.terminals_info.lock();
            let info = info_map.get_mut(&launch.terminal_id)?;
            settle_after_first_output(info).then(|| status_payload(info))
        };
        if moved.is_some() {
            self.notify_status_watcher(&launch.terminal_id);
        }
        moved
    }

    /// Lists `info` as the terminal `launch` started, and returns it as listed. The PTY reader
    /// can print before the terminal is listed, so a launch that already has output is moved
    /// out of Starting here.
    pub fn insert_launched(&self, launch: &LaunchRef, mut info: TerminalInfo) -> TerminalInfo {
        let mut watches = self.plugin_watches.lock();
        if launch
            .current_in(&mut watches)
            .is_some_and(|watch| watch.has_output())
        {
            settle_after_first_output(&mut info);
        }
        self.terminals_info.lock().insert(info.id.clone(), info.clone());
        info
    }

    /// Lists `info` again as the terminal `launch` restarted, running `attach` in the same step
    /// to put the new session in place, and returns it as listed. A terminal closed while it
    /// relaunched stays closed: when it is no longer listed, or `launch` is no longer its
    /// current launch, nothing is listed and `attach` comes back unrun, for the caller to drop
    /// outside this manager's locks. `kill` ends the launch before it removes the session and
    /// the listing, so a close either comes after this step and removes what it put in place,
    /// or comes before it and is seen here.
    pub fn relist_launched<F: FnOnce()>(
        &self,
        launch: &LaunchRef,
        mut info: TerminalInfo,
        attach: F,
    ) -> Result<TerminalInfo, F> {
        let mut watches = self.plugin_watches.lock();
        let Some(watch) = launch.current_in(&mut watches) else {
            return Err(attach);
        };
        let has_output = watch.has_output();
        if !self.terminals_info.lock().contains_key(&launch.terminal_id) {
            // Closed before this launch began, so the launch is the closed terminal's last trace
            watches.remove(&launch.terminal_id);
            return Err(attach);
        }
        if has_output {
            settle_after_first_output(&mut info);
        }
        attach();
        self.terminals_info.lock().insert(info.id.clone(), info.clone());
        Ok(info)
    }

    /// Shows the terminal as Unknown, a Claude terminal with the plugin hint, when `launch`
    /// is still current and its silence clock has run out at `now` with nothing heard. Returns the new
    /// status when it moved.
    pub fn check_plugin_silence(
        &self,
        launch: &LaunchRef,
        now: Instant,
    ) -> Option<TerminalStatusPayload> {
        let mut watches = self.plugin_watches.lock();
        let watch = launch.current_in(&mut watches)?;
        if !watch.silence_due(now) {
            return None;
        }
        let mut info_map = self.terminals_info.lock();
        let info = info_map.get_mut(&launch.terminal_id)?;
        if info.claude_status == ClaudeStatus::Exited {
            return None;
        }
        info.claude_status = ClaudeStatus::Unknown;
        // The hint tells how to install Claude Code's plugin; PiG's extension ships with Quay
        info.plugin_hint = info.run_kind == RunKind::Claude;
        Some(status_payload(info))
    }

    /// Applies an authenticated event from the event-bridge plugin to the terminal's status,
    /// and returns the status it leaves. The event marks the plugin heard for this launch
    /// and clears the plugin hint. An `attention.notification` goes through
    /// `apply_notification` instead.
    pub fn apply_plugin_event(
        &self,
        terminal_id: &str,
        event_type: &str,
    ) -> Option<TerminalStatusPayload> {
        self.apply_plugin_status(terminal_id, |heard| match event_type {
            "turn.started" | "tool.started" => ClaudeStatus::Working,
            "turn.completed" | "session.started" => ClaudeStatus::Idle,
            "session.ended" => ClaudeStatus::Exited,
            _ => heard,
        })
    }

    /// Applies the event-bridge plugin's `attention.notification`, as `apply_plugin_event`
    /// does, by its `notificationType`. Claude Code's `idle_prompt`, sent about a minute after
    /// a turn ends, and its `auth_success` leave the status as it was, so an Idle terminal
    /// keeps taking deliveries. Any other notification, such as a permission prompt, a dialog,
    /// or one with a type Quay doesn't know or no type, makes the terminal Waiting, which
    /// holds its deliveries.
    pub fn apply_notification(
        &self,
        terminal_id: &str,
        notification_type: Option<&str>,
    ) -> Option<TerminalStatusPayload> {
        self.apply_plugin_status(terminal_id, |heard| match notification_type {
            Some("idle_prompt") | Some("auth_success") => heard,
            _ => ClaudeStatus::Waiting,
        })
    }

    /// Marks the plugin heard for the terminal's launch, clears the plugin hint, and sets
    /// the status `status_for` gives from the heard status, unless the process has exited.
    fn apply_plugin_status(
        &self,
        terminal_id: &str,
        status_for: impl FnOnce(ClaudeStatus) -> ClaudeStatus,
    ) -> Option<TerminalStatusPayload> {
        let mut watches = self.plugin_watches.lock();
        let mut info_map = self.terminals_info.lock();
        let watch = watches.get_mut(terminal_id)?;
        let info = info_map.get_mut(terminal_id)?;
        info.plugin_hint = false;
        // A terminal whose process has exited stays Exited: Codex's turn-end helper runs on its
        // own and can report a turn after Codex quit
        if info.claude_status == ClaudeStatus::Exited && info.exit_code.is_some() {
            return Some(status_payload(info));
        }
        let heard = watch.hear(&info.claude_status);
        info.claude_status = status_for(heard);
        Some(status_payload(info))
    }

    /// What a launch's PTY reader runs with each OSC 7501 sequence, for a CLI that prints
    /// them (`RunKind::prints_osc7501`): it follows the launch's turns and applies each
    /// report, sending `terminal-status` when the status moved. `None` for any other CLI.
    fn osc7501_hook(
        &self,
        run_kind: RunKind,
        launch: &LaunchRef,
        app_handle: &AppHandle,
    ) -> Option<Osc7501Hook> {
        if !run_kind.prints_osc7501() {
            return None;
        }
        let manager = self.clone();
        let launch = launch.clone();
        let app_handle = app_handle.clone();
        let mut turn = AntigravityTurn::default();
        Some(Box::new(move |seq| {
            let report = turn.read(&seq);
            if let Some(status) = manager.apply_turn_report(&launch, &report) {
                let _ = app_handle.emit("terminal-status", status);
            }
        }))
    }

    /// Applies what one of `launch`'s OSC 7501 sequences said (see `AntigravityTurn::read`),
    /// while `launch` is still current. It sets the terminal's status, unless its process has
    /// exited, then tells the turn watcher of a turn start and of an answer, and last the
    /// status watcher, when the status moved: a terminal that went Idle lets its next held
    /// message in. Returns the new status when it moved.
    pub fn apply_turn_report(
        &self,
        launch: &LaunchRef,
        report: &TurnReport,
    ) -> Option<TerminalStatusPayload> {
        let moved = {
            let mut watches = self.plugin_watches.lock();
            launch.current_in(&mut watches)?;
            let mut info_map = self.terminals_info.lock();
            let info = info_map.get_mut(&launch.terminal_id)?;
            match &report.status {
                Some(status) if *status != info.claude_status && info.exit_code.is_none() => {
                    info.claude_status = status.clone();
                    Some(status_payload(info))
                }
                _ => None,
            }
        };
        let watcher = self.turn_watcher.lock().clone();
        if let Some(watcher) = watcher {
            if report.starts_turn {
                watcher(&launch.terminal_id, TurnEvent::Started);
            }
            if let Some(answer) = &report.answer {
                watcher(&launch.terminal_id, TurnEvent::Answered(answer.clone()));
            }
        }
        if moved.is_some() {
            self.notify_status_watcher(&launch.terminal_id);
        }
        moved
    }

    /// Hides the plugin hint for the rest of the terminal's current launch, and returns
    /// the terminal's status, which stays as it was.
    pub fn dismiss_plugin_hint(&self, terminal_id: &str) -> Option<TerminalStatusPayload> {
        let mut watches = self.plugin_watches.lock();
        if let Some(watch) = watches.get_mut(terminal_id) {
            watch.dismiss_hint();
        }
        let mut info_map = self.terminals_info.lock();
        let info = info_map.get_mut(terminal_id)?;
        info.plugin_hint = false;
        Some(status_payload(info))
    }

    /// Shows the terminal Working after an A2A message reached it, when Quay will also see
    /// that turn end (see `TerminalInfo::shows_working_on_delivery`). Any other terminal
    /// keeps its status, so it is never left Working with nothing to show it Idle again.
    pub fn mark_a2a_delivered(&self, terminal_id: &str) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map
            .get_mut(terminal_id)
            .filter(|info| info.shows_working_on_delivery())
        {
            info.claude_status = ClaudeStatus::Working;
        }
    }

    pub fn increment_auto_approved(&self, terminal_id: &str) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.auto_approved_count += 1;
        }
    }

    /// Shows the terminal Exited with `exit_code` once `launch`'s process has ended, while
    /// `launch` is still current, and tells the status watcher, so held messages fail rather
    /// than wait. An earlier launch that a relaunch ended, or a closed terminal, changes
    /// nothing. Returns whether the terminal moved.
    pub fn exit_launch(&self, launch: &LaunchRef, exit_code: Option<i32>) -> bool {
        {
            let mut watches = self.plugin_watches.lock();
            if launch.current_in(&mut watches).is_none() {
                return false;
            }
            let mut info_map = self.terminals_info.lock();
            let Some(info) = info_map.get_mut(&launch.terminal_id) else {
                return false;
            };
            info.claude_status = ClaudeStatus::Exited;
            info.exit_code = exit_code;
        }
        self.save_sessions_to_disk();
        self.notify_status_watcher(&launch.terminal_id);
        true
    }

    /// What a launch's exit watcher runs with the exit code once its process ends, before it
    /// sends `terminal-exited` (see `exit_launch`).
    fn exit_hook(&self, launch: LaunchRef) -> Box<dyn FnOnce(Option<i32>) + Send> {
        let manager = self.clone();
        Box::new(move |exit_code| {
            manager.exit_launch(&launch, exit_code);
        })
    }

    pub fn rename(&self, terminal_id: &str, new_name: &str) -> Result<(), String> {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.name = new_name.to_string();
            info.custom_name = true;
            drop(info_map);
            self.save_sessions_to_disk();
            Ok(())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub fn update_task_title(&self, terminal_id: &str, task_title: &str) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.task_title = Some(task_title.to_string());
            if !info.custom_name && (info.name == "claude" || info.name.starts_with("term-")) {
                info.name = task_title.to_string();
            }
            drop(info_map);
            self.save_sessions_to_disk();
        }
    }

    pub fn update_current_tool(&self, terminal_id: &str, tool: Option<String>) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.current_tool = tool;
        }
    }

    /// Sets the terminal's live mode and returns the mode it now has, which stays Skip for a
    /// CLI that never asks before a tool call.
    pub fn set_live_mode(&self, terminal_id: &str, mode: PermissionMode) -> Result<PermissionMode, String> {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.live_mode = info.run_kind.permission_mode(Some(mode));
            Ok(info.live_mode)
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::pty::models::{test_terminal, PermissionMode, RunKind};

    fn temp_sessions_file() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("quay2-sessions-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sessions.json");
        (dir, path)
    }

    fn dir_entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn persisted(id: &str) -> PersistedTerminalSession {
        PersistedTerminalSession {
            id: id.to_string(),
            name: id.to_string(),
            project_path: "E:\\Projects\\Test".to_string(),
            run_kind: RunKind::Claude,
            permission_mode: PermissionMode::Normal,
            task_title: None,
            custom_name: false,
            auto_approved_count: 0,
            command_text: None,
            custom_flags: None,
            last_updated: 1,
            created_at: 1,
        }
    }

    #[test]
    fn a_missing_session_list_reads_as_none_and_creates_nothing() {
        let (dir, path) = temp_sessions_file();
        assert!(read_session_list(&path).is_empty());
        assert!(dir_entries(&dir).is_empty());
    }

    #[test]
    fn a_saved_session_list_reads_back() {
        let (dir, path) = temp_sessions_file();
        write_session_list(&path, &[persisted("term-a"), persisted("term-b")]).unwrap();
        let ids: Vec<String> = read_session_list(&path).into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["term-a", "term-b"]);
        assert_eq!(dir_entries(&dir), vec!["sessions.json"]);
    }

    #[test]
    fn an_unparseable_session_list_is_moved_aside_and_survives_the_next_save() {
        let (dir, path) = temp_sessions_file();
        let truncated = "[\n  {\n    \"id\": \"term-a\",\n    \"na";
        std::fs::write(&path, truncated).unwrap();

        assert!(read_session_list(&path).is_empty());
        let entries = dir_entries(&dir);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].starts_with("sessions.json.corrupt-"), "{:?}", entries);
        let aside = dir.join(&entries[0]);
        assert_eq!(std::fs::read_to_string(&aside).unwrap(), truncated);

        write_session_list(&path, &[persisted("term-b")]).unwrap();
        assert_eq!(std::fs::read_to_string(&aside).unwrap(), truncated);
        assert_eq!(read_session_list(&path).len(), 1);
    }

    #[test]
    fn a_session_list_cut_inside_a_character_is_moved_aside() {
        let (dir, path) = temp_sessions_file();
        // "é" is 0xC3 0xA9; a write cut after its first byte leaves invalid UTF-8
        let cut = b"[{\"id\": \"term-a\", \"name\": \"caf\xC3".to_vec();
        std::fs::write(&path, &cut).unwrap();

        assert!(read_session_list(&path).is_empty());
        let entries = dir_entries(&dir);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].starts_with("sessions.json.corrupt-"), "{:?}", entries);
        assert_eq!(std::fs::read(dir.join(&entries[0])).unwrap(), cut);
    }

    #[test]
    fn test_last_seq_reads_dormant_buffer_then_defaults_to_zero() {
        let manager = PtyManager::new();
        manager
            .dormant_buffers
            .lock()
            .insert("term-dormant".to_string(), ("restored".to_string(), 7));

        assert_eq!(manager.last_seq("term-dormant"), 7);
        assert_eq!(manager.last_seq("term-unknown"), 0);
    }

    #[test]
    fn a_terminal_whose_cli_never_asks_keeps_a_skip_live_mode() {
        let manager = PtyManager::new();
        for (id, run_kind) in [("term-pi", RunKind::Pi), ("term-claude", RunKind::Claude)] {
            manager
                .terminals_info
                .lock()
                .insert(id.to_string(), test_terminal(id, run_kind, ClaudeStatus::Idle));
            manager.set_live_mode(id, PermissionMode::Normal).unwrap();
        }
        assert_eq!(manager.get_info("term-pi").unwrap().live_mode, PermissionMode::Skip);
        assert_eq!(manager.get_info("term-claude").unwrap().live_mode, PermissionMode::Normal);
    }

    #[test]
    fn test_pty_manager_rename_and_task_title() {
        let manager = PtyManager::new();
        let term_id = "term-123".to_string();

        let initial_info = TerminalInfo {
            id: term_id.clone(),
            name: "claude".to_string(),
            project_path: "E:\\Projects\\Test".to_string(),
            run_kind: RunKind::Claude,
            permission_mode: PermissionMode::Normal,
            live_mode: PermissionMode::Normal,
            claude_status: ClaudeStatus::Starting,
            auto_approved_count: 0,
            exit_code: None,
            task_title: None,
            current_tool: None,
            custom_name: false,
            custom_flags: None,
            command_text: None,
            created_at: 1000,
            plugin_hint: false,
        };

        manager.terminals_info.lock().insert(term_id.clone(), initial_info);

        // Auto-update task title should update default name
        manager.update_task_title(&term_id, "Fix authentication bug");
        let info = manager.get_info(&term_id).unwrap();
        assert_eq!(info.task_title.as_deref(), Some("Fix authentication bug"));
        assert_eq!(info.name, "Fix authentication bug");

        // Tool tracking
        manager.update_current_tool(&term_id, Some("Bash".to_string()));
        let info = manager.get_info(&term_id).unwrap();
        assert_eq!(info.current_tool.as_deref(), Some("Bash"));

        manager.update_current_tool(&term_id, None);
        let info = manager.get_info(&term_id).unwrap();
        assert_eq!(info.current_tool, None);

        // Explicit rename sets custom_name = true
        manager.rename(&term_id, "My Custom Agent").unwrap();
        let info = manager.get_info(&term_id).unwrap();
        assert_eq!(info.name, "My Custom Agent");
        assert!(info.custom_name);

        // Subsequent task title update should not overwrite custom name
        manager.update_task_title(&term_id, "Refactor database models");
        let info = manager.get_info(&term_id).unwrap();
        assert_eq!(info.name, "My Custom Agent");
        assert_eq!(info.task_title.as_deref(), Some("Refactor database models"));
    }

    #[test]
    fn relaunching_a_terminal_does_not_resend_its_launch_prompt() {
        let info = TerminalInfo {
            id: "term-relaunch".to_string(),
            name: "lead-dev".to_string(),
            project_path: "E:\\Projects\\Test".to_string(),
            run_kind: RunKind::Codex,
            permission_mode: PermissionMode::Skip,
            live_mode: PermissionMode::Skip,
            claude_status: ClaudeStatus::Exited,
            auto_approved_count: 0,
            exit_code: Some(0),
            task_title: Some("Role: Lead Developer".to_string()),
            current_tool: None,
            custom_name: true,
            custom_flags: Some("--model gpt-5".to_string()),
            command_text: None,
            created_at: 1000,
            plugin_hint: false,
        };

        let request = relaunch_request(&info, Some(30), Some(100), None);

        assert_eq!(request.initial_prompt, None);
        assert_eq!(request.custom_flags.as_deref(), Some("--model gpt-5"));
        let cmd = crate::slices::pty::session::build_command(&request, &info.id, 1234, "tok", None);
        let args: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(
            args[..4],
            ["codex.exe", "--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5"]
        );
        // Then Codex's bus overrides, ending with `notify`, and no prompt after them
        assert!(args.last().unwrap().starts_with("notify=["), "{:?}", args);
    }

    /// Puts a running terminal of `run_kind` under `id` and starts its first launch,
    /// as `spawn` does, without opening a PTY.
    fn launched(manager: &PtyManager, id: &str, run_kind: RunKind) -> LaunchRef {
        let info = TerminalInfo {
            id: id.to_string(),
            name: id.to_string(),
            project_path: "E:\\Projects\\Test".to_string(),
            run_kind,
            permission_mode: PermissionMode::Skip,
            live_mode: PermissionMode::Skip,
            claude_status: ClaudeStatus::Starting,
            auto_approved_count: 0,
            exit_code: None,
            task_title: None,
            current_tool: None,
            custom_name: false,
            custom_flags: None,
            command_text: None,
            created_at: 1000,
            plugin_hint: false,
        };
        manager.terminals_info.lock().insert(id.to_string(), info);
        manager.begin_launch(id, run_kind)
    }

    fn status_of(manager: &PtyManager, id: &str) -> ClaudeStatus {
        manager.get_info(id).unwrap().claude_status
    }

    #[test]
    fn a_launch_runs_until_its_terminal_exits_is_relaunched_or_closes() {
        let manager = PtyManager::new();
        let first = launched(&manager, "term-oc-run", RunKind::OpenCode);
        assert!(manager.launch_running(&first));

        manager.update_status("term-oc-run", ClaudeStatus::Exited);
        assert!(!manager.launch_running(&first));
        assert!(manager.launch_current(&first));

        let second = manager.begin_launch("term-oc-run", RunKind::OpenCode);
        manager.update_status("term-oc-run", ClaudeStatus::Starting);
        assert!(!manager.launch_current(&first));
        assert!(!manager.launch_running(&first));
        assert!(manager.launch_running(&second));

        let _ = manager.kill("term-oc-run");
        assert!(!manager.launch_current(&second));
    }

    #[test]
    fn losing_sight_of_a_launchs_turns_shows_its_terminal_unknown_once() {
        let manager = PtyManager::new();
        let told = Arc::new(Mutex::new(Vec::new()));
        let seen = told.clone();
        manager.set_status_watcher(move |id| seen.lock().push(id.to_string()));
        let launch = launched(&manager, "term-oc-lost", RunKind::OpenCode);
        manager.update_status("term-oc-lost", ClaudeStatus::Working);

        let status = manager.lose_turn_sight(&launch).expect("the status moves");
        assert_eq!(status.claude_status, ClaudeStatus::Unknown);
        assert_eq!(status_of(&manager, "term-oc-lost"), ClaudeStatus::Unknown);
        assert!(manager.lose_turn_sight(&launch).is_none());
        assert_eq!(*told.lock(), ["term-oc-lost"]);
    }

    #[test]
    fn losing_sight_of_an_old_launch_or_an_exited_one_changes_nothing() {
        let manager = PtyManager::new();
        let old = launched(&manager, "term-oc-old", RunKind::OpenCode);
        manager.begin_launch("term-oc-old", RunKind::OpenCode);
        manager.update_status("term-oc-old", ClaudeStatus::Idle);
        assert!(manager.lose_turn_sight(&old).is_none());
        assert_eq!(status_of(&manager, "term-oc-old"), ClaudeStatus::Idle);

        let exited = launched(&manager, "term-oc-exited", RunKind::OpenCode);
        manager.update_status("term-oc-exited", ClaudeStatus::Exited);
        assert!(manager.lose_turn_sight(&exited).is_none());
        assert_eq!(status_of(&manager, "term-oc-exited"), ClaudeStatus::Exited);
    }

    #[test]
    fn only_an_opencode_launch_gets_a_server_port() {
        let port = server_port_for(RunKind::OpenCode).unwrap().expect("OpenCode gets a port");
        assert_ne!(port, 0);
        for kind in [RunKind::Claude, RunKind::Codex, RunKind::Antigravity, RunKind::PowerShell] {
            assert_eq!(server_port_for(kind).unwrap(), None, "{:?}", kind);
        }
    }

    #[test]
    fn the_first_plugin_event_moves_a_claude_terminal_from_starting_to_idle() {
        let manager = PtyManager::new();
        launched(&manager, "term-plugin-first", RunKind::Claude);

        manager.apply_plugin_event("term-plugin-first", "boot.started");

        assert_eq!(status_of(&manager, "term-plugin-first"), ClaudeStatus::Idle);
    }

    #[test]
    fn a_plugin_reload_during_a_turn_leaves_the_terminal_working() {
        let manager = PtyManager::new();
        launched(&manager, "term-plugin-reload", RunKind::Claude);
        manager.apply_plugin_event("term-plugin-reload", "turn.started");

        manager.apply_plugin_event("term-plugin-reload", "boot.started");

        assert_eq!(status_of(&manager, "term-plugin-reload"), ClaudeStatus::Working);
    }

    #[test]
    fn thirty_silent_seconds_after_first_output_make_a_claude_terminal_unknown_with_the_hint() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-silent", RunKind::Claude);
        let first_output = Instant::now();
        manager.note_first_output(&launch, first_output);

        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(29));
        let before = manager.get_info("term-plugin-silent").unwrap();
        assert_eq!(before.claude_status, ClaudeStatus::Starting);
        assert!(!before.plugin_hint);

        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(30));
        let after = manager.get_info("term-plugin-silent").unwrap();
        assert_eq!(after.claude_status, ClaudeStatus::Unknown);
        assert!(after.plugin_hint);
    }

    #[test]
    fn a_pig_terminal_waits_for_its_extension_then_turns_unknown_without_the_hint() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-pig-silent", RunKind::Pig);
        let first_output = Instant::now();
        manager.note_first_output(&launch, first_output);
        // Its first output leaves it Starting, holding its messages, until the extension reports
        assert!(manager.apply_first_output_status(&launch).is_none());
        assert_eq!(status_of(&manager, "term-pig-silent"), ClaudeStatus::Starting);

        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(29));
        assert_eq!(status_of(&manager, "term-pig-silent"), ClaudeStatus::Starting);

        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(30));
        let silent = manager.get_info("term-pig-silent").unwrap();
        assert_eq!(silent.claude_status, ClaudeStatus::Unknown);
        assert!(silent.plugin_silent());
        // The pane's hint installs Claude Code's plugin, which a PiG terminal doesn't use
        assert!(!silent.plugin_hint);
    }

    #[test]
    fn a_late_session_started_brings_a_silent_pig_terminal_back_to_full_peer() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-pig-late", RunKind::Pig);
        silent_for_thirty_seconds(&manager, &launch, Instant::now());
        assert!(manager.get_info("term-pig-late").unwrap().plugin_silent());

        manager.apply_plugin_event("term-pig-late", "session.started");

        let info = manager.get_info("term-pig-late").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Idle);
        assert!(!info.plugin_silent());
        assert_eq!(info.bus_level(), Some(crate::slices::pty::models::BusLevel::FullPeer));
    }

    /// Starts the launch's clock at `first_output` and checks it once 30 seconds have passed.
    fn silent_for_thirty_seconds(manager: &PtyManager, launch: &LaunchRef, first_output: Instant) {
        manager.note_first_output(launch, first_output);
        manager.check_plugin_silence(launch, first_output + Duration::from_secs(30));
    }

    #[test]
    fn any_plugin_event_clears_the_hint_and_moves_unknown_to_idle() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-reloaded", RunKind::Claude);
        silent_for_thirty_seconds(&manager, &launch, Instant::now());

        manager.apply_plugin_event("term-plugin-reloaded", "boot.started");

        let info = manager.get_info("term-plugin-reloaded").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Idle);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn once_the_plugin_is_heard_silence_never_brings_the_hint_back_in_that_launch() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-heard", RunKind::Claude);
        let first_output = Instant::now();
        manager.note_first_output(&launch, first_output);
        manager.apply_plugin_event("term-plugin-heard", "session.started");

        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(300));

        let info = manager.get_info("term-plugin-heard").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Idle);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn the_clock_does_not_run_before_the_first_output() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-quiet", RunKind::Claude);

        manager.check_plugin_silence(&launch, Instant::now() + Duration::from_secs(300));

        assert_eq!(status_of(&manager, "term-plugin-quiet"), ClaudeStatus::Starting);
    }

    #[test]
    fn only_the_first_output_of_a_launch_starts_the_clock() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-chatty", RunKind::Claude);
        let first_output = Instant::now();

        assert!(manager.note_first_output(&launch, first_output));
        assert!(!manager.note_first_output(
            &launch,
            first_output + Duration::from_secs(20),
        ));
        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(30));

        assert_eq!(status_of(&manager, "term-plugin-chatty"), ClaudeStatus::Unknown);
    }

    #[test]
    fn relaunch_starts_over_with_a_new_clock_and_no_mark() {
        let manager = PtyManager::new();
        let first = launched(&manager, "term-plugin-relaunch", RunKind::Claude);
        let first_output = Instant::now();
        manager.note_first_output(&first, first_output);
        manager.apply_plugin_event("term-plugin-relaunch", "boot.started");

        manager.update_status("term-plugin-relaunch", ClaudeStatus::Starting);
        let second = manager.begin_launch("term-plugin-relaunch", RunKind::Claude);

        // The first launch's clock no longer counts
        manager.check_plugin_silence(&first, first_output + Duration::from_secs(30));
        assert_eq!(status_of(&manager, "term-plugin-relaunch"), ClaudeStatus::Starting);

        // The second launch has not heard the plugin, so its own silence counts
        let second_output = first_output + Duration::from_secs(40);
        silent_for_thirty_seconds(&manager, &second, second_output);
        let info = manager.get_info("term-plugin-relaunch").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Unknown);
        assert!(info.plugin_hint);
    }

    #[test]
    fn silence_after_the_process_exits_leaves_it_exited() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-exited", RunKind::Claude);
        let first_output = Instant::now();
        manager.note_first_output(&launch, first_output);
        manager.exit_launch(&launch, Some(1));

        let silence_ends = first_output + Duration::from_secs(30);
        assert!(manager.check_plugin_silence(&launch, silence_ends).is_none());

        let info = manager.get_info("term-plugin-exited").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Exited);
        assert_eq!(info.exit_code, Some(1));
        assert!(!info.plugin_hint);
    }

    #[test]
    fn a_launch_whose_process_exits_shows_exited_with_its_code_and_tells_the_status_watcher() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-exit-pig", RunKind::Pig);
        first_output(&manager, &launch);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        manager.set_status_watcher(move |id| log.lock().push(id.to_string()));

        assert!(manager.exit_launch(&launch, Some(1)));

        let info = manager.get_info("term-exit-pig").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Exited);
        assert_eq!(info.exit_code, Some(1));
        assert_eq!(*seen.lock(), ["term-exit-pig"]);
    }

    #[test]
    fn an_old_launchs_exit_leaves_the_relaunched_terminal_running() {
        let manager = PtyManager::new();
        let old = launched(&manager, "term-exit-old", RunKind::Claude);
        let new = manager.begin_launch("term-exit-old", RunKind::Claude);

        assert!(!manager.exit_launch(&old, Some(1)));

        let info = manager.get_info("term-exit-old").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Starting);
        assert_eq!(info.exit_code, None);
        assert!(manager.launch_running(&new));
    }

    #[test]
    fn a_closed_terminals_exit_lists_nothing() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-exit-closed", RunKind::Codex);
        manager.kill("term-exit-closed").unwrap();

        assert!(!manager.exit_launch(&launch, Some(0)));
        assert!(manager.get_info("term-exit-closed").is_none());
    }

    #[test]
    fn other_agent_kinds_run_no_plugin_clock() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-codex", RunKind::Codex);
        let first_output = Instant::now();

        assert!(!manager.note_first_output(&launch, first_output));
        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(30));

        let info = manager.get_info("term-plugin-codex").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Starting);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn a2a_delivery_sets_a_terminal_working_but_leaves_an_unknown_one_alone() {
        let manager = PtyManager::new();
        launched(&manager, "term-a2a-heard", RunKind::Claude);
        manager.apply_plugin_event("term-a2a-heard", "boot.started");
        let launch = launched(&manager, "term-a2a-unknown", RunKind::Claude);
        silent_for_thirty_seconds(&manager, &launch, Instant::now());

        manager.mark_a2a_delivered("term-a2a-heard");
        manager.mark_a2a_delivered("term-a2a-unknown");

        assert_eq!(status_of(&manager, "term-a2a-heard"), ClaudeStatus::Working);
        assert_eq!(status_of(&manager, "term-a2a-unknown"), ClaudeStatus::Unknown);
    }

    #[test]
    fn a_codex_terminal_works_from_a_delivery_until_its_helper_reports_the_turn_end() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-a2a-codex", RunKind::Codex);
        first_output(&manager, &launch);

        manager.mark_a2a_delivered("term-a2a-codex");
        assert_eq!(status_of(&manager, "term-a2a-codex"), ClaudeStatus::Working);

        let sent = manager.apply_plugin_event("term-a2a-codex", "turn.completed").unwrap();
        assert_eq!(sent.claude_status, ClaudeStatus::Idle);
    }

    #[test]
    fn a_turn_end_reported_after_the_process_exited_leaves_it_exited() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-late-codex", RunKind::Codex);
        first_output(&manager, &launch);
        manager.exit_launch(&launch, Some(0));

        let sent = manager.apply_plugin_event("term-late-codex", "turn.completed").unwrap();

        assert_eq!(sent.claude_status, ClaudeStatus::Exited);
    }

    /// A Claude terminal whose plugin reported a session and one finished turn.
    fn after_a_turn(manager: &PtyManager, id: &str) -> LaunchRef {
        let launch = launched(manager, id, RunKind::Claude);
        manager.apply_plugin_event(id, "session.started");
        manager.apply_plugin_event(id, "turn.started");
        manager.apply_plugin_event(id, "turn.completed");
        launch
    }

    #[test]
    fn an_idle_prompt_leaves_a_claude_terminal_idle_and_taking_deliveries() {
        let manager = PtyManager::new();
        after_a_turn(&manager, "term-idle-prompt");

        let sent = manager.apply_notification("term-idle-prompt", Some("idle_prompt")).unwrap();

        assert_eq!(sent.claude_status, ClaudeStatus::Idle);
        assert!(!manager.get_info("term-idle-prompt").unwrap().holds_deliveries());
    }

    #[test]
    fn an_idle_prompt_leaves_a_working_or_ended_terminal_as_it_was() {
        // A late idle prompt must not let a held message into a turn that just began
        let manager = PtyManager::new();
        launched(&manager, "term-idle-working", RunKind::Claude);
        manager.apply_plugin_event("term-idle-working", "turn.started");
        after_a_turn(&manager, "term-idle-ended");
        manager.apply_plugin_event("term-idle-ended", "session.ended");

        manager.apply_notification("term-idle-working", Some("idle_prompt"));
        manager.apply_notification("term-idle-ended", Some("idle_prompt"));

        assert_eq!(status_of(&manager, "term-idle-working"), ClaudeStatus::Working);
        assert_eq!(status_of(&manager, "term-idle-ended"), ClaudeStatus::Exited);
    }

    #[test]
    fn a_permission_prompt_or_a_dialog_makes_the_terminal_waiting_and_holding_deliveries() {
        for kind in ["permission_prompt", "elicitation_dialog"] {
            let manager = PtyManager::new();
            launched(&manager, "term-blocked", RunKind::Claude);
            manager.apply_plugin_event("term-blocked", "turn.started");

            manager.apply_notification("term-blocked", Some(kind));

            let info = manager.get_info("term-blocked").unwrap();
            assert_eq!(info.claude_status, ClaudeStatus::Waiting, "{kind}");
            assert!(info.holds_deliveries(), "{kind}");
        }
    }

    #[test]
    fn an_idle_prompt_leaves_a_terminal_waiting_on_a_permission_waiting() {
        let manager = PtyManager::new();
        launched(&manager, "term-still-blocked", RunKind::Claude);
        manager.apply_plugin_event("term-still-blocked", "turn.started");
        manager.apply_notification("term-still-blocked", Some("permission_prompt"));

        manager.apply_notification("term-still-blocked", Some("idle_prompt"));

        assert_eq!(status_of(&manager, "term-still-blocked"), ClaudeStatus::Waiting);
    }

    #[test]
    fn an_auth_success_leaves_the_status_as_it_was() {
        let manager = PtyManager::new();
        after_a_turn(&manager, "term-auth-idle");
        launched(&manager, "term-auth-working", RunKind::Claude);
        manager.apply_plugin_event("term-auth-working", "turn.started");

        manager.apply_notification("term-auth-idle", Some("auth_success"));
        manager.apply_notification("term-auth-working", Some("auth_success"));

        assert_eq!(status_of(&manager, "term-auth-idle"), ClaudeStatus::Idle);
        assert_eq!(status_of(&manager, "term-auth-working"), ClaudeStatus::Working);
    }

    #[test]
    fn a_notification_of_an_unknown_type_or_none_makes_the_terminal_waiting() {
        for kind in [Some("something_new"), None] {
            let manager = PtyManager::new();
            after_a_turn(&manager, "term-unknown-notice");

            manager.apply_notification("term-unknown-notice", kind);

            assert_eq!(status_of(&manager, "term-unknown-notice"), ClaudeStatus::Waiting, "{kind:?}");
        }
    }

    #[test]
    fn a_notification_after_the_process_exited_leaves_it_exited() {
        let manager = PtyManager::new();
        let launch = after_a_turn(&manager, "term-late-notice");
        manager.exit_launch(&launch, Some(0));

        let sent = manager.apply_notification("term-late-notice", Some("permission_prompt")).unwrap();

        assert_eq!(sent.claude_status, ClaudeStatus::Exited);
    }

    #[test]
    fn a2a_delivery_leaves_a_terminal_whose_turn_end_quay_cannot_see_as_it_was() {
        let manager = PtyManager::new();
        launched(&manager, "term-a2a-opencode", RunKind::OpenCode);
        manager.update_status("term-a2a-opencode", ClaudeStatus::Unknown);
        launched(&manager, "term-a2a-gemini", RunKind::Gemini);
        manager.update_status("term-a2a-gemini", ClaudeStatus::Unknown);

        manager.mark_a2a_delivered("term-a2a-opencode");
        manager.mark_a2a_delivered("term-a2a-gemini");

        assert_eq!(status_of(&manager, "term-a2a-opencode"), ClaudeStatus::Unknown);
        assert_eq!(status_of(&manager, "term-a2a-gemini"), ClaudeStatus::Unknown);
    }

    /// Runs what a launch's PTY reader does on its first output, at `now`.
    fn first_output(manager: &PtyManager, launch: &LaunchRef) -> Option<TerminalStatusPayload> {
        manager.note_first_output(launch, Instant::now());
        manager.apply_first_output_status(launch)
    }

    #[test]
    fn a_full_peer_or_responder_without_a_plugin_goes_idle_when_its_pane_first_prints() {
        let manager = PtyManager::new();
        for (id, run_kind) in [
            ("term-first-codex", RunKind::Codex),
            ("term-first-opencode", RunKind::OpenCode),
            ("term-first-agy", RunKind::Antigravity),
        ] {
            let launch = launched(&manager, id, run_kind);

            let sent = first_output(&manager, &launch).expect("status moved");

            assert_eq!(sent.claude_status, ClaudeStatus::Idle, "{:?}", run_kind);
            assert_eq!(status_of(&manager, id), ClaudeStatus::Idle, "{:?}", run_kind);
        }
    }

    #[test]
    fn a_listener_shows_unknown_once_its_pane_first_prints() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-first-gemini", RunKind::Gemini);

        first_output(&manager, &launch);

        let info = manager.get_info("term-first-gemini").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Unknown);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn a_claude_terminal_stays_starting_on_first_output() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-first-claude", RunKind::Claude);

        assert!(first_output(&manager, &launch).is_none());

        assert_eq!(status_of(&manager, "term-first-claude"), ClaudeStatus::Starting);
    }

    #[test]
    fn first_output_moves_only_a_starting_terminal() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-first-exited", RunKind::Codex);
        manager.update_status("term-first-exited", ClaudeStatus::Exited);

        assert!(first_output(&manager, &launch).is_none());

        assert_eq!(status_of(&manager, "term-first-exited"), ClaudeStatus::Exited);
    }

    #[test]
    fn output_that_comes_before_the_terminal_is_listed_still_moves_it_out_of_starting() {
        let manager = PtyManager::new();
        let launch = manager.begin_launch("term-first-early", RunKind::Codex);
        // The reader thread can print before spawn has listed the terminal
        assert!(first_output(&manager, &launch).is_none());

        let listed = manager.insert_launched(&launch, test_terminal("term-first-early", RunKind::Codex, ClaudeStatus::Starting));

        assert_eq!(listed.claude_status, ClaudeStatus::Idle);
        assert_eq!(status_of(&manager, "term-first-early"), ClaudeStatus::Idle);
    }

    #[test]
    fn a_terminal_listed_before_any_output_stays_starting() {
        let manager = PtyManager::new();
        let launch = manager.begin_launch("term-first-late", RunKind::Codex);

        let listed = manager.insert_launched(&launch, test_terminal("term-first-late", RunKind::Codex, ClaudeStatus::Starting));

        assert_eq!(listed.claude_status, ClaudeStatus::Starting);
    }

    #[test]
    fn dismissing_the_hint_hides_it_for_the_launch_and_leaves_the_terminal_unknown() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-dismissed", RunKind::Claude);
        let first_output = Instant::now();
        silent_for_thirty_seconds(&manager, &launch, first_output);

        manager.dismiss_plugin_hint("term-plugin-dismissed");
        manager.check_plugin_silence(&launch, first_output + Duration::from_secs(300));

        let info = manager.get_info("term-plugin-dismissed").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Unknown);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn two_prompts_to_one_terminal_each_go_in_with_their_enter() {
        let manager = PtyManager::new();
        manager.insert_test_terminal(crate::slices::pty::models::test_terminal(
            "term-submit-unit",
            RunKind::Claude,
            ClaudeStatus::Idle,
        ));

        std::thread::scope(|scope| {
            for prompt in ["first", "second"] {
                let manager = &manager;
                scope.spawn(move || manager.submit_prompt("term-submit-unit", prompt).unwrap());
            }
        });

        let input = manager.test_input("term-submit-unit");
        assert_eq!(input.len(), 4, "{input:?}");
        assert_eq!(input[1], "\r", "{input:?}");
        assert_eq!(input[3], "\r", "{input:?}");
        let mut prompts = [input[0].as_str(), input[2].as_str()];
        prompts.sort();
        assert_eq!(prompts, ["first", "second"]);
    }

    #[test]
    fn a_prompt_to_a_closed_terminal_fails() {
        let manager = PtyManager::new();
        manager.insert_test_terminal(crate::slices::pty::models::test_terminal(
            "term-submit-closed",
            RunKind::Claude,
            ClaudeStatus::Idle,
        ));
        manager.close_test_input("term-submit-closed");

        assert!(manager.submit_prompt("term-submit-closed", "hello").is_err());
    }

    #[test]
    fn leaving_starting_on_first_output_tells_the_status_watcher() {
        let manager = PtyManager::new();
        let codex = launched(&manager, "term-watched-codex", RunKind::Codex);
        let claude = launched(&manager, "term-watched-claude", RunKind::Claude);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        manager.set_status_watcher(move |id| log.lock().push(id.to_string()));

        first_output(&manager, &codex);
        first_output(&manager, &claude);

        // The Claude terminal stayed Starting, so only the Codex one is reported
        assert_eq!(*seen.lock(), ["term-watched-codex"]);
    }

    /// Applies the OSC 7501 sequence with body `body` as `launch`'s PTY reader does.
    fn agy_says(
        manager: &PtyManager,
        launch: &LaunchRef,
        turn: &mut AntigravityTurn,
        body: &str,
    ) -> Option<TerminalStatusPayload> {
        let seq = crate::slices::pty::osc7501::Osc7501::parse(body).unwrap();
        manager.apply_turn_report(launch, &turn.read(&seq))
    }

    /// Logs what the turn watcher hears.
    fn turn_log(manager: &PtyManager) -> Arc<Mutex<Vec<TurnEvent>>> {
        let heard = Arc::new(Mutex::new(Vec::new()));
        let log = heard.clone();
        manager.set_turn_watcher(move |_, event| log.lock().push(event));
        heard
    }

    #[test]
    fn an_antigravity_terminals_osc7501_states_set_its_status_and_report_its_turn() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-agy-turn", RunKind::Antigravity);
        first_output(&manager, &launch);
        let heard = turn_log(&manager);
        let moved = Arc::new(Mutex::new(Vec::new()));
        let log = moved.clone();
        manager.set_status_watcher(move |id| log.lock().push(id.to_string()));
        let mut turn = AntigravityTurn::default();

        agy_says(&manager, &launch, &mut turn, "state=working:app=antigravity");
        assert_eq!(status_of(&manager, "term-agy-turn"), ClaudeStatus::Working);
        agy_says(
            &manager,
            &launch,
            &mut turn,
            "state=blocked:kind=permission:app=antigravity:msg=VHJ1c3QgdGhpcyBmb2xkZXI/",
        );
        assert_eq!(status_of(&manager, "term-agy-turn"), ClaudeStatus::Waiting);
        agy_says(&manager, &launch, &mut turn, "state=working:app=antigravity");
        let sent = agy_says(&manager, &launch, &mut turn, "state=done:app=antigravity:msg=cG9uZw==");

        assert_eq!(sent.unwrap().claude_status, ClaudeStatus::Idle);
        assert_eq!(
            *heard.lock(),
            [
                TurnEvent::Started,
                TurnEvent::Answered("blocked (permission): Trust this folder?".to_string()),
                TurnEvent::Answered("pong".to_string()),
            ]
        );
        // Each move is reported, so the Idle at the end lets a held message in
        assert_eq!(moved.lock().len(), 4);
    }

    #[test]
    fn a_relaunched_antigravity_terminal_ignores_the_old_launchs_sequences() {
        let manager = PtyManager::new();
        let old = launched(&manager, "term-agy-old", RunKind::Antigravity);
        first_output(&manager, &old);
        manager.begin_launch("term-agy-old", RunKind::Antigravity);
        let heard = turn_log(&manager);

        let mut turn = AntigravityTurn::default();
        assert!(agy_says(&manager, &old, &mut turn, "state=working").is_none());
        assert!(agy_says(&manager, &old, &mut turn, "state=done:msg=cG9uZw==").is_none());

        assert_eq!(status_of(&manager, "term-agy-old"), ClaudeStatus::Idle);
        assert!(heard.lock().is_empty());
    }

    #[test]
    fn an_antigravity_terminal_that_exited_stays_exited_but_its_last_answer_still_counts() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-agy-exit", RunKind::Antigravity);
        first_output(&manager, &launch);
        manager.exit_launch(&launch, Some(0));
        let heard = turn_log(&manager);

        let mut turn = AntigravityTurn::default();
        assert!(agy_says(&manager, &launch, &mut turn, "state=done:msg=cG9uZw==").is_none());

        assert_eq!(status_of(&manager, "term-agy-exit"), ClaudeStatus::Exited);
        assert_eq!(*heard.lock(), [TurnEvent::Started, TurnEvent::Answered("pong".to_string())]);
    }

    #[test]
    fn closing_a_terminal_tells_the_status_watcher() {
        let manager = PtyManager::new();
        launched(&manager, "term-watched-close", RunKind::Claude);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        manager.set_status_watcher(move |id| log.lock().push(id.to_string()));

        manager.kill("term-watched-close").unwrap();

        assert_eq!(*seen.lock(), ["term-watched-close"]);
    }

    #[test]
    fn a_relaunch_that_finishes_lists_the_terminal_again_with_its_new_session() {
        let manager = PtyManager::new();
        launched(&manager, "term-relist-done", RunKind::Codex);
        let info = manager.get_info("term-relist-done").unwrap();
        let relaunch = manager.begin_launch("term-relist-done", RunKind::Codex);
        let mut attached = false;

        let listed = manager.relist_launched(&relaunch, info, || attached = true);

        assert!(listed.is_ok());
        assert!(attached);
        assert!(manager.get_info("term-relist-done").is_some());
    }

    #[test]
    fn a_terminal_closed_while_it_relaunches_stays_closed() {
        let manager = PtyManager::new();
        launched(&manager, "term-relist-closed", RunKind::Codex);
        let info = manager.get_info("term-relist-closed").unwrap();
        let relaunch = manager.begin_launch("term-relist-closed", RunKind::Codex);
        manager.kill("term-relist-closed").unwrap();
        let mut attached = false;

        let listed = manager.relist_launched(&relaunch, info, || attached = true);

        assert!(listed.is_err());
        assert!(!attached);
        assert!(manager.get_info("term-relist-closed").is_none());
        assert!(!manager.plugin_watches.lock().contains_key("term-relist-closed"));
    }

    #[test]
    fn a_terminal_closed_before_its_relaunch_begins_its_launch_stays_closed() {
        let manager = PtyManager::new();
        launched(&manager, "term-relist-early", RunKind::Codex);
        let info = manager.get_info("term-relist-early").unwrap();
        manager.kill("term-relist-early").unwrap();
        let relaunch = manager.begin_launch("term-relist-early", RunKind::Codex);
        let mut attached = false;

        let listed = manager.relist_launched(&relaunch, info, || attached = true);

        assert!(listed.is_err());
        assert!(!attached);
        assert!(manager.get_info("term-relist-early").is_none());
        // The launch it began for the closed terminal is gone too
        assert!(!manager.plugin_watches.lock().contains_key("term-relist-early"));
    }

    #[test]
    fn a_relaunch_overtaken_by_a_later_one_leaves_the_later_one_in_place() {
        let manager = PtyManager::new();
        launched(&manager, "term-relist-twice", RunKind::Codex);
        let info = manager.get_info("term-relist-twice").unwrap();
        let earlier = manager.begin_launch("term-relist-twice", RunKind::Codex);
        let later = manager.begin_launch("term-relist-twice", RunKind::Codex);
        let mut attached = false;

        let listed = manager.relist_launched(&earlier, info, || attached = true);

        assert!(listed.is_err());
        assert!(!attached);
        assert!(manager.get_info("term-relist-twice").is_some());
        assert!(later.current_in(&mut manager.plugin_watches.lock()).is_some());
    }

    #[test]
    fn test_pty_manager_list_preserves_creation_order() {
        let manager = PtyManager::new();
        manager.terminals_info.lock().clear();
        let ids_and_times = vec![
            ("term-third", 3000),
            ("term-first", 1000),
            ("term-fourth", 4000),
            ("term-second", 2000),
        ];

        for (id, created_at) in ids_and_times {
            let info = TerminalInfo {
                id: id.to_string(),
                name: id.to_string(),
                project_path: "E:\\Projects\\Test".to_string(),
                run_kind: RunKind::Claude,
                permission_mode: PermissionMode::Normal,
                live_mode: PermissionMode::Normal,
                claude_status: ClaudeStatus::Starting,
                auto_approved_count: 0,
                exit_code: None,
                task_title: None,
                current_tool: None,
                custom_name: false,
                custom_flags: None,
                command_text: None,
                created_at,
                plugin_hint: false,
            };
            manager.terminals_info.lock().insert(id.to_string(), info);
        }

        let listed = manager.list();
        let listed_ids: Vec<&str> = listed.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            listed_ids,
            vec!["term-first", "term-second", "term-third", "term-fourth"]
        );
    }
}
