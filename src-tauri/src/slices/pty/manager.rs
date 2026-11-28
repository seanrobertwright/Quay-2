use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use tauri::AppHandle;
use uuid::Uuid;

use super::handshake::Handshake;
use super::models::{
    ClaudeStatus, PermissionMode, PersistedTerminalSession, RunKind, SpawnTerminalRequest,
    TerminalInfo, TerminalLink, TerminalOutputPayload, TerminalStatusPayload,
};
use super::osc7501::{TurnReader, TurnReport};
use super::plugin_watch::{LaunchRef, PluginWatch, PLUGIN_SILENCE};
use super::opencode_serve::OpenCodeLaunch;
use super::session::{opencode_launch, same_variable, ExitReport, Osc7501Hook, PtySession};
use crate::dates::now_ms;
use crate::webview::WebviewEvents;

/// Pause between typing a prompt and pressing Enter, so the two arrive as separate reads
const PROMPT_SUBMIT_DELAY: Duration = Duration::from_millis(250);

/// The End key, which Quay presses after a prompt to a Codex terminal and before its Enter.
/// Codex on Windows reads a fast stream of typed characters as a paste and takes an Enter
/// within 120 ms of the last one it processed as a newline, and a long prompt takes it longer
/// than `PROMPT_SUBMIT_DELAY` to process. A key that isn't text ends the paste and that window
/// at once; End leaves the cursor where the prompt left it.
const END_KEY: &str = "\x1b[F";

/// What the status watcher runs, with the id of the terminal whose status moved.
type StatusWatcher = Arc<dyn Fn(&str) + Send + Sync>;

/// What the input watcher runs, with a terminal's id and what the operator typed into it.
type InputWatcher = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// What the server watcher runs, with a launch whose CLI serves its own events and how it was
/// launched, which says where it serves them.
type ServerWatcher = Arc<dyn Fn(LaunchRef, OpenCodeLaunch) + Send + Sync>;

/// What becomes of a terminal's launches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchEvent {
    /// The terminal is listed, with this launch's process started in it.
    Listed(LaunchRef),
    /// The launch's CLI has shaken hands with Quay's MCP server, for the first time.
    ShookHands(LaunchRef),
    /// The launch's CLI works for the first time, and is one that connects to Quay's MCP server then.
    Prompted(LaunchRef),
    /// The launch is over: its process exited, or a later launch has begun.
    Over(LaunchRef),
    /// The terminal with this id closed.
    Closed(String),
}

/// What a launch watcher runs.
type LaunchWatcher = Arc<dyn Fn(LaunchEvent) + Send + Sync>;

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

/// How an OpenCode `request` is launched, on a free loopback port, from a probe of its version
/// (see `opencode_launch`), which blocks for a few seconds at most. `None` for other CLIs,
/// which aren't probed.
fn opencode_launch_for(request: &SpawnTerminalRequest) -> Result<Option<OpenCodeLaunch>, String> {
    Ok(server_port_for(request.run_kind)?.map(|port| opencode_launch(request, port)))
}

/// What a terminal's own output says about its turn, as the turn watchers hear it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnEvent {
    /// A turn started.
    Started,
    /// What a sender waiting on the running turn is told.
    Answered(String),
    /// The running turn ended. It comes after that turn's answer.
    Ended,
    /// The output shows the running turn over, while its answer comes another way: before this,
    /// after it, or never. The agent may still wait on a call of that turn.
    Stopped,
}

/// What a turn watcher runs, with the id of the terminal whose output reported the turn.
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

/// Where terminal sessions and their scrollback logs are kept: `sessions` in Quay's
/// storage folder.
pub(crate) fn get_sessions_dir() -> PathBuf {
    let dir = crate::slices::workspace::manager::storage_dir().join("sessions");
    let _ = std::fs::create_dir_all(&dir);
    dir
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
    match parse_session_list(&content) {
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

/// The session list `content` holds, or where it can't be parsed. The error is logged, so it
/// quotes nothing of the list, as serde_json's own message would: the terminals' environment
/// variables may hold secrets.
fn parse_session_list(content: &[u8]) -> Result<Vec<PersistedTerminalSession>, String> {
    serde_json::from_slice(content)
        .map_err(|e| format!("{:?} error at line {} column {}", e.classify(), e.line(), e.column()))
}

/// Saves the session list to `path` through a temp file and rename, so a crash
/// mid-save leaves the previous list in place. It is written private, since the terminals'
/// environment variables may hold secrets.
fn write_session_list(path: &Path, list: &[PersistedTerminalSession]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    crate::atomic_file::write_atomic_private(path, json.as_bytes())
        .map_err(|e| format!("cannot write {}: {}", path.display(), e))
}

/// What a terminal with no running process shows, and the seq its output reached.
#[derive(Clone)]
struct DormantOutput {
    data: String,
    seq: u64,
}

/// A dormant terminal's output from disk: its saved screen, or the raw log when an older
/// Quay saved none. Both are empty when the terminal has neither. A saved screen is text
/// and line breaks with no cursor movement, so a pane of any size lays it out again; its
/// size isn't passed on, since the pane would take it for a live PTY's.
fn read_dormant_output(terminal_id: &str) -> DormantOutput {
    let dir = get_sessions_dir();
    if let Some(snapshot) = super::screen::load_screen(&dir, terminal_id) {
        return DormantOutput { data: snapshot.data, seq: 0 };
    }
    DormantOutput { data: read_log_tail(&dir.join(format!("{}.log", terminal_id))), seq: 0 }
}

/// How much of a raw log is replayed or kept.
pub(crate) const LOG_TAIL_BYTES: usize = 256 * 1024;

/// The last `LOG_TAIL_BYTES` of `bytes`, starting on a UTF-8 character boundary.
pub(crate) fn log_tail(bytes: &[u8]) -> &[u8] {
    if bytes.len() <= LOG_TAIL_BYTES {
        return bytes;
    }
    let mut cut = bytes.len() - LOG_TAIL_BYTES;
    while cut < bytes.len() && (bytes[cut] & 0xC0) == 0x80 {
        cut += 1;
    }
    &bytes[cut..]
}

/// The tail of the raw log at `path` as text, with any invalid bytes replaced; empty when
/// there is no log.
pub(crate) fn read_log_tail(path: &Path) -> String {
    std::fs::read(path).map(|bytes| String::from_utf8_lossy(log_tail(&bytes)).into_owned()).unwrap_or_default()
}

/// Deletes a terminal's raw log and saved screen.
fn remove_saved_output(terminal_id: &str) {
    let dir = get_sessions_dir();
    let _ = std::fs::remove_file(dir.join(format!("{}.log", terminal_id)));
    let _ = std::fs::remove_file(super::screen::screen_path(&dir, terminal_id));
}

/// How `info` is saved in `sessions.json`, stamped `now`.
fn persisted_session(info: &TerminalInfo, now: u64) -> PersistedTerminalSession {
    PersistedTerminalSession {
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
        env_vars: info.env_vars.clone(),
        claude_session_id: info.claude_session_id.clone(),
        last_updated: now,
        created_at: info.created_at,
        link: info.link.clone(),
    }
}

/// The exited terminal a saved session comes back as, created at `created_at`.
fn restored_terminal(item: PersistedTerminalSession, created_at: u64) -> TerminalInfo {
    // A Pi session an older Quay saved as Ask comes back as Skip, since Pi never asks
    let permission_mode = item.run_kind.permission_mode(Some(item.permission_mode));
    TerminalInfo {
        id: item.id,
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
        env_vars: item.env_vars,
        command_text: item.command_text,
        claude_session_id: item.claude_session_id,
        created_at,
        plugin_hint: false,
        link: item.link,
    }
}

/// The flags a relaunch starts the terminal with: its own custom flags, then `--resume`
/// with its recorded Claude Code session, if it has one. Last, so the recorded session
/// wins over a `--resume` Session History put in the custom flags.
fn relaunch_flags(info: &TerminalInfo) -> Option<String> {
    let resume = info.claude_session_id.as_ref().map(|id| format!("--resume {}", id));
    match (info.custom_flags.clone(), resume) {
        (Some(flags), Some(resume)) => Some(format!("{} {}", flags, resume)),
        (flags, resume) => flags.or(resume),
    }
}

/// `env`, or `None` when there is no variable in it.
fn non_empty(env: Option<HashMap<String, String>>) -> Option<HashMap<String, String>> {
    env.filter(|env| !env.is_empty())
}

/// The environment variables a terminal is launched with, before Quay's: its own, and the
/// workspace's for the names it doesn't set itself. `None` when there are none.
fn launch_env(
    own: Option<&HashMap<String, String>>,
    workspace: Option<HashMap<String, String>>,
) -> Option<HashMap<String, String>> {
    let mut merged = own.cloned().unwrap_or_default();
    for (name, value) in workspace.unwrap_or_default() {
        if !merged.keys().any(|set| same_variable(set, &name)) {
            merged.insert(name, value);
        }
    }
    non_empty(Some(merged))
}

/// The spawn request that restarts a terminal from its stored info, with the workspace's
/// environment variables as they are now. It carries no launch prompt: that was the first turn
/// of the terminal's first run, and is never resent.
fn relaunch_request(
    info: &TerminalInfo,
    rows: Option<u16>,
    cols: Option<u16>,
    workspace_env: Option<HashMap<String, String>>,
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
        env_vars: launch_env(info.env_vars.as_ref(), workspace_env),
        custom_flags: relaunch_flags(info),
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

/// Shows a terminal a message reached as Working (see `TerminalInfo::shows_working_on_delivery`).
fn show_delivered(info: &mut TerminalInfo) {
    if info.shows_working_on_delivery() {
        info.claude_status = ClaudeStatus::Working;
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
    dormant_buffers: Arc<Mutex<HashMap<String, DormantOutput>>>,
    /// Each running terminal's current launch. Lock before `terminals_info` when taking both.
    plugin_watches: Arc<Mutex<HashMap<String, PluginWatch>>>,
    /// One lock per terminal, held from a prompt's text to its Enter, so two prompts never interleave.
    submit_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    /// One lock per terminal, held through a relaunch, so a second relaunch starts only once the
    /// first is done, and numbers on from the session it put in place. `kill` never takes it.
    relaunch_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    status_watcher: Arc<Mutex<Option<StatusWatcher>>>,
    /// Held while a status is read and sent (see `send_status`). Lock before any other lock here.
    status_sending: Arc<Mutex<()>>,
    server_watcher: Arc<Mutex<Option<ServerWatcher>>>,
    launch_watchers: Arc<Mutex<Vec<LaunchWatcher>>>,
    turn_watchers: Arc<Mutex<Vec<TurnWatcher>>>,
    input_watcher: Arc<Mutex<Option<InputWatcher>>>,
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
            relaunch_locks: Arc::new(Mutex::new(HashMap::new())),
            status_watcher: Arc::new(Mutex::new(None)),
            status_sending: Arc::new(Mutex::new(())),
            server_watcher: Arc::new(Mutex::new(None)),
            launch_watchers: Arc::new(Mutex::new(Vec::new())),
            turn_watchers: Arc::new(Mutex::new(Vec::new())),
            input_watcher: Arc::new(Mutex::new(None)),
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
            dormant_map.insert(item.id.clone(), read_dormant_output(&item.id));

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

            info_map.insert(item.id.clone(), restored_terminal(item, created_at));
        }
    }

    pub fn save_sessions_to_disk(&self) {
        let info_map = self.terminals_info.lock();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let mut list: Vec<PersistedTerminalSession> =
            info_map.values().map(|info| persisted_session(info, now)).collect();

        list.sort_by_key(|s| s.created_at);

        // Still under the terminals lock, so saves can't overtake each other
        if let Err(e) = write_session_list(&get_sessions_dir().join("sessions.json"), &list) {
            tracing::error!("Could not save terminals: {}", e);
        }
    }

    /// Opens a terminal from `request`, whose environment variables are the terminal's own, with
    /// the workspace's added to them (see `launch_env`). It fails, and leaves the terminal as it
    /// was, when `request` names the id of a terminal already listed or running.
    pub fn spawn(
        &self,
        request: SpawnTerminalRequest,
        workspace_env: Option<HashMap<String, String>>,
        bridge_port: u16,
        bridge_token: String,
        app_handle: AppHandle,
    ) -> Result<TerminalInfo, String> {
        let webview = WebviewEvents::to_app(app_handle);
        self.spawn_to(request, workspace_env, bridge_port, bridge_token, webview)
    }

    /// `spawn`, with the new session's events sent to `webview`.
    fn spawn_to(
        &self,
        mut request: SpawnTerminalRequest,
        workspace_env: Option<HashMap<String, String>>,
        bridge_port: u16,
        bridge_token: String,
        webview: WebviewEvents,
    ) -> Result<TerminalInfo, String> {
        let own_env = non_empty(request.env_vars.take());
        request.env_vars = launch_env(own_env.as_ref(), workspace_env);
        let terminal_id = request
            .id
            .clone()
            .unwrap_or_else(|| format!("term-{}", Uuid::new_v4().simple()));
        // Spawning over a terminal would replace its session without draining it; `relaunch`
        // restarts one
        if self.terminals_info.lock().contains_key(&terminal_id) || self.sessions.lock().contains_key(&terminal_id) {
            return Err(format!("Terminal {} is already open; relaunch it instead", terminal_id));
        }

        let start_seq = self.last_seq(&terminal_id);
        let opencode = opencode_launch_for(&request)?;
        let launch_ref = self.begin_launch(&terminal_id, request.run_kind);
        let on_first_output = self.first_output_hook(launch_ref.clone(), webview.clone());
        let on_osc7501 = self.osc7501_hook(request.run_kind, &launch_ref, webview.clone());
        let on_exit = self.exit_hook(launch_ref.clone());
        let mut session = PtySession::spawn(
            request.clone(),
            launch_ref.clone(),
            start_seq,
            bridge_port,
            bridge_token,
            opencode.clone(),
            webview,
            on_first_output,
            on_osc7501,
            on_exit,
        )?
        .of_launch(launch_ref.launch);
        let exit_report = session.take_exit_report();

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
            env_vars: own_env,
            command_text: request.command_text.clone(),
            claude_session_id: None,
            created_at,
            plugin_hint: false,
            link: None,
        };

        self.dormant_buffers.lock().remove(&terminal_id);
        self.sessions.lock().insert(terminal_id, session);
        let info = self.insert_launched(&launch_ref, info);
        self.save_sessions_to_disk();
        self.notify_server_watcher(launch_ref, opencode);

        Ok(self.end_without_process(exit_report, info))
    }

    pub fn relaunch(
        &self,
        terminal_id: &str,
        rows: Option<u16>,
        cols: Option<u16>,
        bridge_port: u16,
        bridge_token: String,
        workspace_env: Option<HashMap<String, String>>,
        app_handle: AppHandle,
    ) -> Result<TerminalInfo, String> {
        let webview = WebviewEvents::to_app(app_handle);
        self.relaunch_to(terminal_id, rows, cols, bridge_port, bridge_token, workspace_env, webview)
    }

    /// `relaunch`, with the new session's events sent to `webview`.
    fn relaunch_to(
        &self,
        terminal_id: &str,
        rows: Option<u16>,
        cols: Option<u16>,
        bridge_port: u16,
        bridge_token: String,
        workspace_env: Option<HashMap<String, String>>,
        webview: WebviewEvents,
    ) -> Result<TerminalInfo, String> {
        // Held to the end, so a second relaunch of this terminal finds this one's session in
        // place, ends it, and numbers on from the last chunk it sent. Without it, the second
        // would find no session while this one ends the old, and number from the dormant seq.
        let relaunch_lock = self.relaunch_locks.lock().entry(terminal_id.to_string()).or_default().clone();
        let _relaunching = relaunch_lock.lock();
        let info = {
            let info_map = self.terminals_info.lock();
            info_map.get(terminal_id).cloned().ok_or_else(|| {
                format!("Terminal {} not found to relaunch", terminal_id)
            })?
        };

        let request = relaunch_request(&info, rows, cols, workspace_env);
        let opencode = opencode_launch_for(&request)?;
        // Begin the new launch before the old session goes, so the old process's exit, which
        // dropping its session causes, finds its launch over and leaves the terminal alone
        let launch_ref = self.begin_launch(terminal_id, info.run_kind);

        // If an active session is running, terminate it before relaunching. Its screen is
        // saved first and it saves nothing after, so the new session starts from it. Its pane
        // stays mounted and sees every chunk it sends, the one its PTY writes as it closes
        // included, so the new session numbers on from the last of them (see `PtySession::end`).
        let old_session = self.sessions.lock().remove(terminal_id);
        let start_seq = match old_session {
            Some(old_session) => {
                old_session.save_screen();
                old_session.discard_screen();
                old_session.end()
            }
            None => self.last_seq(terminal_id),
        };

        let on_first_output = self.first_output_hook(launch_ref.clone(), webview.clone());
        let on_osc7501 = self.osc7501_hook(info.run_kind, &launch_ref, webview.clone());
        let on_exit = self.exit_hook(launch_ref.clone());
        let mut session = PtySession::spawn(
            request,
            launch_ref.clone(),
            start_seq,
            bridge_port,
            bridge_token,
            opencode.clone(),
            webview,
            on_first_output,
            on_osc7501,
            on_exit,
        )?
        .of_launch(launch_ref.launch);
        let exit_report = session.take_exit_report();

        let mut updated_info = info;
        updated_info.claude_status = if updated_info.run_kind.is_agent() {
            ClaudeStatus::Starting
        } else {
            ClaudeStatus::Unknown
        };
        updated_info.exit_code = None;
        updated_info.plugin_hint = false;

        let new_screen = session.screen_keeper();
        let close_new_output = session.output_closer();
        let sessions = self.sessions.clone();
        let id = terminal_id.to_string();
        let attach = move || {
            sessions.lock().insert(id, session);
        };
        let updated_info = match self.relist_launched(&launch_ref, updated_info, attach) {
            Ok(info) => info,
            Err(unattached) => {
                // Dropping the session ends its process. Its reader may have written a
                // new log, or saved a screen, after the close deleted the old ones; from here
                // it writes neither.
                new_screen.discard();
                close_new_output();
                drop(unattached);
                if self.get_info(terminal_id).is_none() {
                    remove_saved_output(terminal_id);
                }
                return Err(format!(
                    "Terminal {} was closed or relaunched again while it relaunched",
                    terminal_id
                ));
            }
        };
        self.dormant_buffers.lock().remove(terminal_id);
        self.save_sessions_to_disk();
        self.notify_server_watcher(launch_ref, opencode);

        Ok(self.end_without_process(exit_report, updated_info))
    }

    /// Runs `exit_report`, the end of a just-listed launch whose session runs no process (see
    /// `PtySession::take_exit_report`), and returns the terminal as listed after it, Exited, for
    /// the caller to answer with. Without a report, or with the terminal closed meanwhile, it
    /// returns `listed`.
    fn end_without_process(&self, exit_report: Option<ExitReport>, listed: TerminalInfo) -> TerminalInfo {
        let Some(report) = exit_report else {
            return listed;
        };
        report();
        self.get_info(&listed.id).unwrap_or(listed)
    }

    /// Writes `data`, which the operator typed into the terminal's pane. The input watcher hears it
    /// first.
    pub fn write_from_operator(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let watcher = self.input_watcher.lock().clone();
        if let Some(watcher) = watcher {
            watcher(terminal_id, data);
        }
        self.write(terminal_id, data)
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        self.write_for(terminal_id, None, data)
    }

    /// `write`, into the session `launch` started and no other when there is a `launch`: a relaunch
    /// in between fails it.
    fn write_for(&self, terminal_id: &str, launch: Option<&LaunchRef>, data: &str) -> Result<(), String> {
        #[cfg(test)]
        if let Some(input) = self.test_input.lock().get_mut(terminal_id) {
            if launch.is_some_and(|launch| !self.launch_current(launch)) {
                return Err(format!("Terminal {} was relaunched", terminal_id));
            }
            input.push(data.to_string());
            return Ok(());
        }
        let sessions = self.sessions.lock();
        match sessions.get(terminal_id) {
            None => Err(format!("Terminal {} not found or inactive", terminal_id)),
            Some(session) if launch.is_some_and(|launch| !session.is_of_launch(launch.launch)) => {
                Err(format!("Terminal {} was relaunched", terminal_id))
            }
            Some(session) => session.write(data),
        }
    }

    /// Types `prompt` into an agent terminal and presses Enter, as one unit: another prompt
    /// to the same terminal waits until this one's Enter is in. Returns a time, in Unix
    /// milliseconds, just before the Enter: the turn it starts begins no earlier. Agent TUIs read text and
    /// Enter that arrive in one chunk as a paste and leave it unsent, so Enter is a separate
    /// write `PROMPT_SUBMIT_DELAY` later, and the call blocks for that long. A Codex terminal
    /// also gets `END_KEY` straight after the prompt. It fails when any write fails.
    pub fn submit_prompt(&self, terminal_id: &str, prompt: &str) -> Result<i64, String> {
        self.submit(terminal_id, None, prompt)
    }

    /// `submit_prompt` into the session `launch` started. It fails when the terminal has another
    /// session by then, or none, so nothing of it reaches a later launch. An exit by itself doesn't
    /// fail it.
    pub fn submit_prompt_to(&self, launch: &LaunchRef, prompt: &str) -> Result<i64, String> {
        self.submit(&launch.terminal_id, Some(launch), prompt)
    }

    fn submit(&self, terminal_id: &str, launch: Option<&LaunchRef>, prompt: &str) -> Result<i64, String> {
        let unit = self
            .submit_locks
            .lock()
            .entry(terminal_id.to_string())
            .or_default()
            .clone();
        let _unit = unit.lock();
        self.write_for(terminal_id, launch, prompt)?;
        if self.get_info(terminal_id).is_some_and(|info| info.run_kind == RunKind::Codex) {
            self.write_for(terminal_id, launch, END_KEY)
                .map_err(|e| format!("Typed the prompt but couldn't press End: {}", e))?;
        }
        std::thread::sleep(PROMPT_SUBMIT_DELAY);
        let entering = now_ms();
        self.write_for(terminal_id, launch, "\r")
            .map(|()| entering)
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
    /// (0 when there is neither). A session started for a terminal with no session numbers its
    /// output above this; one that replaces a session numbers on from that session's
    /// `PtySession::end`, since a session can still send output as it ends.
    fn last_seq(&self, terminal_id: &str) -> u64 {
        if let Some(session) = self.sessions.lock().get(terminal_id) {
            return session.last_seq();
        }
        self.dormant_buffers
            .lock()
            .get(terminal_id)
            .map(|dormant| dormant.seq)
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

        // 2. Check the dormant buffer, then the disk
        let cached = self.dormant_buffers.lock().get(terminal_id).cloned();
        let dormant = match cached {
            Some(dormant) => dormant,
            None => {
                let dormant = read_dormant_output(terminal_id);
                if dormant.data.is_empty() {
                    return Err(format!("Terminal {} not found", terminal_id));
                }
                self.dormant_buffers.lock().insert(terminal_id.to_string(), dormant.clone());
                dormant
            }
        };
        Ok(TerminalOutputPayload {
            terminal_id: terminal_id.to_string(),
            data: dormant.data,
            last_seq: dormant.seq,
            rows: None,
            cols: None,
        })
    }

    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        // 1. End the current launch first, so a relaunch still starting sees the terminal
        //    closed and never lists it or its session again (see `relist_launched`)
        self.plugin_watches.lock().remove(terminal_id);
        self.submit_locks.lock().remove(terminal_id);
        self.relaunch_locks.lock().remove(terminal_id);

        // 2. Terminate running session process if active. It saves no screen and logs and sends
        //    no output from here on, so its reader finishing, which can take a chunk the PTY
        //    writes as it closes, can't bring back the files step 4 deletes. The close waits
        //    for no reader.
        let session = self.sessions.lock().remove(terminal_id);
        if let Some(session) = session {
            session.discard_screen();
            session.close_output();
        }

        // 3. Remove from terminals_info and dormant_buffers
        let removed = {
            let mut info_map = self.terminals_info.lock();
            info_map.remove(terminal_id).is_some()
        };
        self.dormant_buffers.lock().remove(terminal_id);
        self.notify_launch_watchers(LaunchEvent::Closed(terminal_id.to_string()));

        // 4. Clean up disk files
        remove_saved_output(terminal_id);
        self.save_sessions_to_disk();

        if removed {
            self.notify_status_watcher(terminal_id);
            Ok(())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    /// Saves the screen of every running terminal, for Quay shutting down with them open.
    pub fn save_all_screens(&self) {
        // Collected first, so writing the files never holds up the sessions lock
        let keepers: Vec<_> = self.sessions.lock().values().map(|session| session.screen_keeper()).collect();
        for keeper in keepers {
            keeper.save_now();
        }
    }

    /// Ends every OpenCode 2.x terminal's server, and waits for each to exit, for Quay's exit. A
    /// tied process tree would end with Quay on Windows anyway; elsewhere nothing else ends it,
    /// since Quay exits without dropping its sessions.
    pub fn end_sidecars(&self) {
        // Collected first, so the kills never hold up the sessions lock
        let enders: Vec<_> = self.sessions.lock().values().filter_map(|session| session.sidecar_ender()).collect();
        for ender in enders {
            ender.end();
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

    /// Runs `watcher` with each launch whose CLI serves its own events (OpenCode), and how it
    /// was launched, which says where it serves them, once the launch's terminal is listed. It
    /// runs on the thread that spawned the terminal, with no lock of this manager held.
    pub fn set_server_watcher(&self, watcher: impl Fn(LaunchRef, OpenCodeLaunch) + Send + Sync + 'static) {
        *self.server_watcher.lock() = Some(Arc::new(watcher));
    }

    fn notify_server_watcher(&self, launch: LaunchRef, opencode: Option<OpenCodeLaunch>) {
        let watcher = self.server_watcher.lock().clone();
        if let (Some(watcher), Some(opencode)) = (watcher, opencode) {
            watcher(launch, opencode);
        }
    }

    /// Runs `watcher` with what becomes of each terminal's launches, on the thread that did it and
    /// with no lock of this manager held, after the watchers added before it. So an event can come
    /// after a later one of its terminal: `launch_running` says what holds now.
    pub fn add_launch_watcher(&self, watcher: impl Fn(LaunchEvent) + Send + Sync + 'static) {
        self.launch_watchers.lock().push(Arc::new(watcher));
    }

    fn notify_launch_watchers(&self, event: LaunchEvent) {
        let watchers = self.launch_watchers.lock().clone();
        for watcher in watchers {
            watcher(event.clone());
        }
    }

    /// Whether `launch` is its terminal's current launch: the terminal is open and hasn't
    /// been relaunched since.
    pub fn launch_current(&self, launch: &LaunchRef) -> bool {
        launch.current_in(&mut self.plugin_watches.lock()).is_some()
    }

    /// Whether `launch` is its terminal's current launch and the terminal hasn't exited.
    pub fn launch_running(&self, launch: &LaunchRef) -> bool {
        self.with_running(launch, |_| ()).is_some()
    }

    /// Runs `change` on the terminal's info if `launch` is running (see `launch_running`), which it
    /// stays meanwhile.
    fn with_running<T>(&self, launch: &LaunchRef, change: impl FnOnce(&mut TerminalInfo) -> T) -> Option<T> {
        let mut watches = self.plugin_watches.lock();
        launch.current_in(&mut watches)?;
        let mut info_map = self.terminals_info.lock();
        let info = info_map.get_mut(&launch.terminal_id)?;
        (info.claude_status != ClaudeStatus::Exited).then(|| change(info))
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

    /// Runs `watcher` with a terminal's id and what its own output says about its turn, from its
    /// OSC 7501 sequences (see `apply_turn_report`). It runs on the PTY reader
    /// thread, with no lock of this manager held, after the watchers added before it.
    pub fn add_turn_watcher(&self, watcher: impl Fn(&str, TurnEvent) + Send + Sync + 'static) {
        self.turn_watchers.lock().push(Arc::new(watcher));
    }

    /// Runs `watcher` with a terminal's id and what the operator typed into it, before that is
    /// written to it (see `write_from_operator`) and with no lock of this manager held.
    pub fn set_input_watcher(&self, watcher: impl Fn(&str, &str) + Send + Sync + 'static) {
        *self.input_watcher.lock() = Some(Arc::new(watcher));
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        let mut list: Vec<TerminalInfo> = self.terminals_info.lock().values().cloned().collect();
        list.sort_by_key(|t| t.created_at);
        list
    }

    /// The terminals that may call Quay's MCP server: each listed one, and each whose launch has
    /// begun but which is not listed yet. An OpenCode 2.x terminal's server connects while its
    /// terminal is still starting, and OpenCode does not try again after a refusal. A closed
    /// terminal is neither, since closing ends its launch first.
    pub fn mcp_caller_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.terminals_info.lock().keys().cloned().collect();
        for id in self.plugin_watches.lock().keys() {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
        ids
    }

    /// The CLI of `terminal_id`: its listed one, or, while it is still starting, its launch's.
    pub fn run_kind_of(&self, terminal_id: &str) -> Option<RunKind> {
        let listed = self.terminals_info.lock().get(terminal_id).map(|info| info.run_kind);
        listed.or_else(|| self.plugin_watches.lock().get(terminal_id).map(PluginWatch::run_kind))
    }

    pub fn get_info(&self, terminal_id: &str) -> Option<TerminalInfo> {
        self.terminals_info.lock().get(terminal_id).cloned()
    }

    /// Puts `info` in the terminal list without opening a PTY. What is typed into it is kept
    /// for `test_input` until `close_test_input`.
    #[cfg(test)]
    pub fn insert_test_terminal(&self, info: TerminalInfo) {
        self.open_test_input(&info.id);
        self.terminals_info.lock().insert(info.id.clone(), info);
    }

    /// Has test terminal `terminal_id` take writes, none so far.
    #[cfg(test)]
    pub fn open_test_input(&self, terminal_id: &str) {
        self.test_input.lock().insert(terminal_id.to_string(), Vec::new());
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

    /// `update_status`, if `launch` is running.
    pub fn update_status_of(&self, launch: &LaunchRef, status: ClaudeStatus) {
        self.with_running(launch, |info| info.claude_status = status);
    }

    /// Starts a new launch of `terminal_id`: no plugin heard, no silence clock running, and
    /// the grace for its handshake running from now. The one before it, if there was one, is over.
    pub fn begin_launch(&self, terminal_id: &str, run_kind: RunKind) -> LaunchRef {
        let watch = PluginWatch::new(run_kind);
        let launch = LaunchRef {
            terminal_id: terminal_id.to_string(),
            launch: watch.launch(),
        };
        let before = self.plugin_watches.lock().insert(terminal_id.to_string(), watch);
        if let Some(before) = before {
            let over = LaunchRef { terminal_id: terminal_id.to_string(), launch: before.launch() };
            self.notify_launch_watchers(LaunchEvent::Over(over));
        }
        launch
    }

    /// What a launch's PTY reader runs on its first output: it moves a terminal that has no
    /// plugin out of Starting, and for a Claude terminal starts the plugin silence clock and,
    /// once that has run, sends `terminal-status` if the terminal went Unknown.
    fn first_output_hook(
        &self,
        launch: LaunchRef,
        webview: WebviewEvents,
    ) -> Box<dyn FnOnce() + Send> {
        let manager = self.clone();
        Box::new(move || {
            let starts_clock = manager.note_first_output(&launch, Instant::now());
            if let Some(status) = manager.apply_first_output_status(&launch) {
                webview.emit("terminal-status", status);
            }
            if !starts_clock {
                return;
            }
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(PLUGIN_SILENCE).await;
                if let Some(status) = manager.check_plugin_silence(&launch, Instant::now()) {
                    webview.emit("terminal-status", status);
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
        drop(watches);
        self.notify_launch_watchers(LaunchEvent::Listed(launch.clone()));
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
        let mut info_map = self.terminals_info.lock();
        // A link recorded while the terminal relaunched wins over the one read before it
        if let Some(listed) = info_map.get(&info.id) {
            info.link = listed.link.clone();
        }
        info_map.insert(info.id.clone(), info.clone());
        drop(info_map);
        drop(watches);
        self.notify_launch_watchers(LaunchEvent::Listed(launch.clone()));
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
    /// `apply_notification` instead. A `turn.completed` moves nothing in a launch whose own output
    /// reports its turns: it can come before that output shows the turn over, or once the next
    /// message is being typed in.
    pub fn apply_plugin_event(
        &self,
        terminal_id: &str,
        event_type: &str,
    ) -> Option<TerminalStatusPayload> {
        self.apply_plugin_status(terminal_id, |heard, own_turns| match event_type {
            "turn.completed" if own_turns => heard,
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
        self.apply_plugin_status(terminal_id, |heard, _| match notification_type {
            Some("idle_prompt") | Some("auth_success") => heard,
            _ => ClaudeStatus::Waiting,
        })
    }

    /// Marks the plugin heard for the terminal's launch, clears the plugin hint, and sets
    /// the status `status_for` gives from the heard status and whether the launch's own output
    /// reports its turns, unless the process has exited.
    fn apply_plugin_status(
        &self,
        terminal_id: &str,
        status_for: impl FnOnce(ClaudeStatus, bool) -> ClaudeStatus,
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
        info.claude_status = status_for(heard, watch.reports_own_turns());
        Some(status_payload(info))
    }

    /// What a launch's PTY reader runs with each OSC 7501 sequence, for a CLI whose sequences Quay
    /// reads (`TurnReader::for_launch`): it follows the launch's turns and applies each report,
    /// sending `terminal-status` when `apply_turn_report` has one to send. `None` for any other CLI.
    pub fn osc7501_hook(
        &self,
        run_kind: RunKind,
        launch: &LaunchRef,
        webview: WebviewEvents,
    ) -> Option<Osc7501Hook> {
        let mut turn = TurnReader::for_launch(run_kind)?;
        let manager = self.clone();
        let launch = launch.clone();
        Some(Box::new(move |seq| {
            let report = turn.read(&seq);
            if manager.apply_turn_report(&launch, &report).is_some() {
                manager.send_status(&launch.terminal_id, |status| webview.emit("terminal-status", status));
            }
        }))
    }

    /// Sends the status `terminal_id` has now, with `send`. Codex's output and its turn-end helper
    /// report a turn's end at nearly the same time, on two threads. Each reads and sends the status
    /// here, one at a time, so neither sends one that the other has overtaken.
    pub fn send_status(&self, terminal_id: &str, send: impl FnOnce(TerminalStatusPayload)) {
        let _one_at_a_time = self.status_sending.lock();
        let status = self.terminals_info.lock().get(terminal_id).map(status_payload);
        if let Some(status) = status {
            send(status);
        }
    }

    /// Applies what one of `launch`'s OSC 7501 sequences said (see `TurnReader::read`), while
    /// `launch` is still current. It sets the terminal's status, unless its process has exited or
    /// the report leaves a Working terminal as it is, then tells the turn watchers of a turn start,
    /// an answer, a turn end and a stopped turn, and last the status watcher, when the status
    /// moved: a terminal that went Idle lets its next held message in. Returns the terminal's
    /// status when it moved, or when a turn now runs in a terminal that was Working already.
    pub fn apply_turn_report(
        &self,
        launch: &LaunchRef,
        report: &TurnReport,
    ) -> Option<TerminalStatusPayload> {
        let mut prompted = false;
        let mut moved = false;
        let changed = {
            let mut watches = self.plugin_watches.lock();
            let watch = launch.current_in(&mut watches)?;
            let exited = watch.exited();
            let turn_runs = !exited && watch.report_turn(report, now_ms());
            // A sign-in or a folder's trust question, which it asks as it starts, is no prompt of the operator's
            if report.status == Some(ClaudeStatus::Working) {
                prompted = watch.works();
            }
            let mut info_map = self.terminals_info.lock();
            let info = info_map.get_mut(&launch.terminal_id)?;
            let keeps = exited || (report.leaves_working && info.claude_status == ClaudeStatus::Working);
            if let Some(status) = report.status.clone().filter(|_| !keeps) {
                moved = info.claude_status != status;
                info.claude_status = status;
            }
            (moved || turn_runs).then(|| status_payload(info))
        };
        if prompted {
            self.notify_launch_watchers(LaunchEvent::Prompted(launch.clone()));
        }
        let watchers = self.turn_watchers.lock().clone();
        for watcher in watchers {
            if report.starts_turn {
                watcher(&launch.terminal_id, TurnEvent::Started);
            }
            if let Some(answer) = &report.answer {
                watcher(&launch.terminal_id, TurnEvent::Answered(answer.clone()));
            }
            if report.ends_turn {
                watcher(&launch.terminal_id, TurnEvent::Ended);
            }
            if report.stops_turn {
                watcher(&launch.terminal_id, TurnEvent::Stopped);
            }
        }
        if moved {
            self.notify_status_watcher(&launch.terminal_id);
        }
        changed
    }

    /// Whether the own output of `terminal_id`'s current launch reports its turns, so that its
    /// status is theirs alone.
    pub fn reports_own_turns(&self, terminal_id: &str) -> bool {
        self.plugin_watches.lock().get(terminal_id).is_some_and(PluginWatch::reports_own_turns)
    }

    /// Whether the turn of `terminal_id` that began at `began` (Unix milliseconds) still runs, by
    /// its own output (see `PluginWatch::turn_running`).
    pub fn turn_running(&self, terminal_id: &str, began: Option<i64>) -> bool {
        self.plugin_watches.lock().get(terminal_id).is_some_and(|watch| watch.turn_running(began))
    }

    /// Whether `terminal_id`'s current launch began after `at` (Unix milliseconds).
    pub fn launch_began_after(&self, terminal_id: &str, at: i64) -> bool {
        self.plugin_watches.lock().get(terminal_id).is_some_and(|watch| watch.began_after(at))
    }

    /// Whether `terminal_id`'s CLI has shaken hands with Quay's MCP server since its current
    /// launch, whose process has not exited.
    pub fn handshake_seen(&self, terminal_id: &str) -> bool {
        self.plugin_watches.lock().get(terminal_id).is_some_and(PluginWatch::handshake_seen)
    }

    /// How `terminal_id`'s current launch stands with Quay's MCP server at `now`, or `None` when it
    /// has no launch or its process has exited.
    pub fn handshake(&self, terminal_id: &str, now: Instant) -> Option<Handshake> {
        self.plugin_watches.lock().get(terminal_id).and_then(|watch| watch.handshake(now))
    }

    /// Records that `launch`'s CLI has shaken hands with Quay's MCP server, while `launch` is still
    /// current and its process has not exited. The first time, it tells the launch watchers.
    pub fn record_handshake(&self, launch: &LaunchRef) {
        let first = {
            let mut watches = self.plugin_watches.lock();
            launch.current_in(&mut watches).is_some_and(PluginWatch::shake_hands)
        };
        if first {
            self.notify_launch_watchers(LaunchEvent::ShookHands(launch.clone()));
        }
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
        if let Some(info) = self.terminals_info.lock().get_mut(terminal_id) {
            show_delivered(info);
        }
    }

    /// `mark_a2a_delivered`, if `launch` is running. Returns the status before it, or `None` when
    /// `launch` isn't running.
    pub fn mark_a2a_delivered_to(&self, launch: &LaunchRef) -> Option<ClaudeStatus> {
        self.with_running(launch, |info| {
            let before = info.claude_status.clone();
            show_delivered(info);
            before
        })
    }

    pub fn increment_auto_approved(&self, terminal_id: &str) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.auto_approved_count += 1;
        }
    }

    /// Shows the terminal Exited with `exit_code` once `launch`'s process has ended, while
    /// `launch` is still current, clears its handshake with Quay's MCP server, and tells the launch
    /// watchers, and the status watcher, so held messages fail rather than wait. An earlier launch that
    /// a relaunch ended, or a closed terminal, changes nothing. Returns whether the terminal moved.
    pub fn exit_launch(&self, launch: &LaunchRef, exit_code: Option<i32>) -> bool {
        {
            let mut watches = self.plugin_watches.lock();
            let Some(watch) = launch.current_in(&mut watches) else {
                return false;
            };
            watch.exit();
            let mut info_map = self.terminals_info.lock();
            let Some(info) = info_map.get_mut(&launch.terminal_id) else {
                return false;
            };
            info.claude_status = ClaudeStatus::Exited;
            info.exit_code = exit_code;
        }
        self.notify_launch_watchers(LaunchEvent::Over(launch.clone()));
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

    /// Records `link` as the terminal's link and saves it with the terminal. Fails when the
    /// terminal is not listed or the link is malformed.
    pub fn set_link(&self, terminal_id: &str, link: TerminalLink) -> Result<(), String> {
        link.validate()?;
        let mut info_map = self.terminals_info.lock();
        let info = info_map
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Terminal {} not found", terminal_id))?;
        info.link = Some(link);
        drop(info_map);
        self.save_sessions_to_disk();
        Ok(())
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

    /// Records `session_id`, which the event-bridge plugin reported, as the Claude Code
    /// session a Claude terminal resumes on relaunch. The latest one wins, since `/clear`
    /// starts a new session. An id that is not a UUID is ignored, since it goes on the
    /// command line.
    pub fn record_claude_session(&self, terminal_id: &str, session_id: &str) {
        let Ok(session_id) = Uuid::parse_str(session_id) else {
            return;
        };
        let session_id = session_id.to_string();
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            if info.run_kind != RunKind::Claude
                || info.claude_session_id.as_deref() == Some(session_id.as_str())
            {
                return;
            }
            info.claude_session_id = Some(session_id);
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
    use crate::slices::pty::models::{
        test_terminal, LinkCandidates, LinkRef, LinkSlot, LinkSlotName, LinkSource, PermissionMode, RunKind, TerminalLink,
        ALL_RUN_KINDS,
    };
    use crate::test_support::TempDir;
    #[cfg(windows)]
    use std::sync::atomic::{AtomicBool, Ordering};

    fn temp_sessions_file() -> (TempDir, PathBuf) {
        let dir = TempDir::new("sessions");
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
            env_vars: None,
            claude_session_id: None,
            last_updated: 1,
            created_at: 1,
            link: None,
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
            .insert("term-dormant".to_string(), DormantOutput { data: "restored".to_string(), seq: 7 });

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
            env_vars: None,
            command_text: None,
            claude_session_id: None,
            created_at: 1000,
            plugin_hint: false,
            link: None,
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
            env_vars: None,
            command_text: None,
            claude_session_id: None,
            created_at: 1000,
            plugin_hint: false,
            link: None,
        };

        let request = relaunch_request(&info, Some(30), Some(100), None);

        assert_eq!(request.initial_prompt, None);
        assert_eq!(request.custom_flags.as_deref(), Some("--model gpt-5"));
        let launch = LaunchRef { terminal_id: info.id.clone(), launch: 7 };
        let cmd = crate::slices::pty::session::build_command(&request, &launch, 1234, "tok", None);
        let args: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(
            args[..4],
            ["codex.exe", "--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5"]
        );
        // Then Codex's bus overrides, ending with `notify`, and no prompt after them
        assert!(args.last().unwrap().starts_with("notify=["), "{:?}", args);
    }

    const SESSION_A: &str = "0b9f3c1e-6a2d-4c8e-9f1a-2d3e4f5a6b7c";
    const SESSION_B: &str = "7c6b5a4f-3e2d-4a1f-8e9c-1e3c9f0b2d4a";

    /// A bridge event as the event-bridge plugin posts it, from `session_id`.
    fn bridge_event(terminal_id: &str, session_id: &str) -> crate::slices::bridge::models::Envelope {
        serde_json::from_value(serde_json::json!({
            "v": 1, "boot": "boot-1", "seq": 1, "ts": 1, "sessionId": session_id,
            "tag": terminal_id, "type": "turn.started", "data": {},
        }))
        .unwrap()
    }

    #[test]
    fn a_claude_terminal_keeps_the_latest_session_its_bridge_events_report() {
        let manager = PtyManager::new();
        let id = unique_id("session");
        launched(&manager, &id, RunKind::Claude);

        manager.record_claude_session(&id, &bridge_event(&id, SESSION_A).session_id);
        assert_eq!(manager.get_info(&id).unwrap().claude_session_id.as_deref(), Some(SESSION_A));

        // `/clear` starts a new session
        manager.record_claude_session(&id, &bridge_event(&id, SESSION_B).session_id);
        assert_eq!(manager.get_info(&id).unwrap().claude_session_id.as_deref(), Some(SESSION_B));

        manager.record_claude_session(&id, "not a session id");
        assert_eq!(manager.get_info(&id).unwrap().claude_session_id.as_deref(), Some(SESSION_B));
    }

    #[test]
    fn only_a_claude_terminal_records_a_session() {
        let manager = PtyManager::new();
        for run_kind in ALL_RUN_KINDS.into_iter().filter(|kind| *kind != RunKind::Claude) {
            let id = unique_id("no-session");
            launched(&manager, &id, run_kind);
            manager.record_claude_session(&id, SESSION_A);
            assert_eq!(manager.get_info(&id).unwrap().claude_session_id, None, "{:?}", run_kind);
        }
    }

    #[test]
    fn a_recorded_session_survives_the_session_list_and_is_resumed_on_relaunch() {
        let (_dir, path) = temp_sessions_file();
        let mut info = test_terminal("term-resume", RunKind::Claude, ClaudeStatus::Idle);
        info.custom_flags = Some("--model opus".to_string());
        info.claude_session_id = Some(SESSION_A.to_string());

        write_session_list(&path, &[persisted_session(&info, 1)]).unwrap();
        let mut list = read_session_list(&path);
        let restored = restored_terminal(list.remove(0), 1);

        assert_eq!(restored.claude_session_id.as_deref(), Some(SESSION_A));
        assert_eq!(restored.custom_flags.as_deref(), Some("--model opus"));
        let request = relaunch_request(&restored, None, None, None);
        assert_eq!(
            request.custom_flags.as_deref(),
            Some(format!("--model opus --resume {}", SESSION_A).as_str())
        );
        let launch = LaunchRef { terminal_id: restored.id.clone(), launch: 7 };
        let cmd = crate::slices::pty::session::build_command(&request, &launch, 1234, "tok", None);
        let args: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(args[2..6], ["--model", "opus", "--resume", SESSION_A], "{:?}", args);
    }

    #[test]
    fn a_terminals_own_env_vars_survive_the_session_list_and_reach_its_relaunch() {
        let (_dir, path) = temp_sessions_file();
        let mut info = test_terminal("term-env-saved", RunKind::Claude, ClaudeStatus::Idle);
        info.env_vars = env(&[("API_KEY", "own"), ("REGION", "own")]);

        write_session_list(&path, &[persisted_session(&info, 1)]).unwrap();
        let mut list = read_session_list(&path);
        let restored = restored_terminal(list.remove(0), 1);

        let request = relaunch_request(&restored, None, None, env(&[("API_KEY", "workspace")]));
        assert_eq!(request.env_vars, env(&[("API_KEY", "own"), ("REGION", "own")]));
    }

    #[test]
    fn a_session_list_saved_before_env_vars_loads_and_relaunches_with_the_workspaces() {
        let (_dir, path) = temp_sessions_file();
        std::fs::write(
            &path,
            r#"[{"id":"term-old","name":"old","project_path":"E:\\Projects\\Test",
                "run_kind":"claude","permission_mode":"normal"}]"#,
        )
        .unwrap();
        let mut list = read_session_list(&path);
        let restored = restored_terminal(list.remove(0), 1);

        assert_eq!(restored.env_vars, None);
        let request = relaunch_request(&restored, None, None, env(&[("NODE_ENV", "dev")]));
        assert_eq!(request.env_vars, env(&[("NODE_ENV", "dev")]));
    }

    #[test]
    fn what_is_logged_of_an_unparseable_session_list_holds_nothing_from_it() {
        // The variables aren't a map, and serde_json's own message quotes what they are
        let content = br#"[{"id":"term-a","name":"a","project_path":"E:\\Projects\\Test",
            "run_kind":"claude","permission_mode":"normal",
            "env_vars":"sk-secret"}]"#;

        let why = parse_session_list(content).unwrap_err();

        assert!(!why.contains("sk-secret"), "{why}");
        assert!(why.contains("line 3"), "{why}");
    }

    fn pinned_pull_request_link() -> TerminalLink {
        TerminalLink {
            ticket: Some(LinkSlot {
                target: LinkRef { repo: None, number: 637 },
                source: LinkSource::Launch,
                pinned: false,
                at: 10,
                state: None,
                closes: None,
            }),
            pull_request: Some(LinkSlot {
                target: LinkRef { repo: Some("seanrobertwright/Quay-2".to_string()), number: 659 },
                source: LinkSource::Pin,
                pinned: true,
                at: 20,
                state: Some("OPEN".to_string()),
                closes: Some(vec![637]),
            }),
            candidates: vec![],
        }
    }

    #[test]
    fn a_terminal_link_survives_the_session_list_and_a_relaunch() {
        let (_dir, path) = temp_sessions_file();
        let mut info = test_terminal("term-linked", RunKind::Claude, ClaudeStatus::Idle);
        info.link = Some(pinned_pull_request_link());

        write_session_list(&path, &[persisted_session(&info, 1)]).unwrap();
        let mut list = read_session_list(&path);
        let restored = restored_terminal(list.remove(0), 1);
        assert_eq!(restored.link, Some(pinned_pull_request_link()));

        let manager = PtyManager::new();
        launched(&manager, "term-relaunched", RunKind::Codex);
        manager.set_link("term-relaunched", pinned_pull_request_link()).unwrap();
        let info = manager.get_info("term-relaunched").unwrap();
        let relaunch = manager.begin_launch("term-relaunched", RunKind::Codex);
        let listed = manager.relist_launched(&relaunch, info, || ()).ok().expect("relisted");
        assert_eq!(listed.link, Some(pinned_pull_request_link()));
    }

    #[test]
    fn a_session_list_saved_before_terminal_links_loads_with_none() {
        let (_dir, path) = temp_sessions_file();
        std::fs::write(
            &path,
            r#"[{"id":"term-old","name":"old","project_path":"E:\\Projects\\Test",
                "run_kind":"claude","permission_mode":"normal"}]"#,
        )
        .unwrap();
        let mut list = read_session_list(&path);
        assert_eq!(restored_terminal(list.remove(0), 1).link, None);
    }

    #[test]
    fn a_terminal_link_is_set_only_on_a_listed_terminal_and_goes_when_it_closes() {
        let manager = PtyManager::new();
        assert!(manager.set_link("term-missing", pinned_pull_request_link()).is_err());
        launched(&manager, "term-link-close", RunKind::Codex);
        manager.set_link("term-link-close", pinned_pull_request_link()).unwrap();
        assert_eq!(manager.get_info("term-link-close").unwrap().link, Some(pinned_pull_request_link()));
        manager.kill("term-link-close").unwrap();
        assert!(manager.get_info("term-link-close").is_none());
    }

    #[test]
    fn a_malformed_terminal_link_is_refused() {
        let manager = PtyManager::new();
        launched(&manager, "term-link-bad", RunKind::Codex);
        let mut zero = pinned_pull_request_link();
        zero.ticket.as_mut().unwrap().target.number = 0;
        assert!(manager.set_link("term-link-bad", zero).is_err());
        let mut repo = pinned_pull_request_link();
        repo.pull_request.as_mut().unwrap().target.repo = Some("not a repo".to_string());
        assert!(manager.set_link("term-link-bad", repo).is_err());
        let mut tie = pinned_pull_request_link();
        tie.candidates = vec![LinkCandidates { slot: LinkSlotName::PullRequest, source: LinkSource::Branch, options: vec![], at: 1 }];
        assert!(manager.set_link("term-link-bad", tie).is_err(), "a tie names at least two refs");
        assert_eq!(manager.get_info("term-link-bad").unwrap().link, None);
    }

    #[test]
    fn a_terminal_link_slot_names_its_ref_inline_as_the_frontend_sends_it() {
        let sent = serde_json::json!({
            "ticket": { "repo": null, "number": 637, "source": "launch", "pinned": false, "at": 10 },
            "pull_request": null,
        });
        let link: TerminalLink = serde_json::from_value(sent.clone()).unwrap();
        assert_eq!(link.ticket.as_ref().unwrap().target, LinkRef { repo: None, number: 637 });
        assert_eq!(serde_json::to_value(&link).unwrap()["ticket"], sent["ticket"]);
    }

    #[test]
    fn a_session_list_saved_before_session_ids_loads_and_relaunches_fresh() {
        let (_dir, path) = temp_sessions_file();
        std::fs::write(
            &path,
            r#"[{"id":"term-old","name":"old","project_path":"E:\\Projects\\Test",
                "run_kind":"claude","permission_mode":"normal","custom_flags":"--model opus"}]"#,
        )
        .unwrap();
        let mut list = read_session_list(&path);
        assert_eq!(list.len(), 1);
        let restored = restored_terminal(list.remove(0), 1);

        assert_eq!(restored.claude_session_id, None);
        assert_eq!(
            relaunch_request(&restored, None, None, None).custom_flags.as_deref(),
            Some("--model opus")
        );
    }

    #[test]
    fn a_claude_terminal_without_a_session_relaunches_with_its_own_flags_only() {
        let mut info = test_terminal("term-fresh", RunKind::Claude, ClaudeStatus::Exited);
        assert_eq!(relaunch_request(&info, None, None, None).custom_flags, None);

        info.custom_flags = Some("--model opus".to_string());
        assert_eq!(
            relaunch_request(&info, None, None, None).custom_flags.as_deref(),
            Some("--model opus")
        );

        info.claude_session_id = Some(SESSION_B.to_string());
        info.custom_flags = None;
        assert_eq!(
            relaunch_request(&info, None, None, None).custom_flags,
            Some(format!("--resume {}", SESSION_B))
        );
    }

    /// Environment variables as a request or a workspace holds them.
    fn env(vars: &[(&str, &str)]) -> Option<HashMap<String, String>> {
        Some(vars.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect())
    }

    #[test]
    fn a_relaunch_keeps_the_terminals_own_env_vars() {
        let mut info = test_terminal("term-own-env", RunKind::Codex, ClaudeStatus::Exited);
        info.env_vars = env(&[("API_KEY", "own")]);

        let request = relaunch_request(&info, None, None, None);

        assert_eq!(request.env_vars, env(&[("API_KEY", "own")]));
    }

    #[test]
    fn a_relaunch_merges_the_workspaces_env_vars_as_they_are_now_under_the_terminals_own() {
        let mut info = test_terminal("term-merged-env", RunKind::Codex, ClaudeStatus::Exited);
        info.env_vars = env(&[("API_KEY", "own"), ("REGION", "own")]);

        let first = relaunch_request(&info, None, None, env(&[("API_KEY", "workspace"), ("NODE_ENV", "old")]));
        assert_eq!(first.env_vars, env(&[("API_KEY", "own"), ("REGION", "own"), ("NODE_ENV", "old")]));

        // The workspace's settings were edited in between
        let second = relaunch_request(&info, None, None, env(&[("NODE_ENV", "new"), ("DEBUG", "1")]));
        assert_eq!(
            second.env_vars,
            env(&[("API_KEY", "own"), ("REGION", "own"), ("NODE_ENV", "new"), ("DEBUG", "1")])
        );
    }

    #[test]
    fn a_relaunch_without_env_vars_of_its_own_takes_the_workspaces() {
        let info = test_terminal("term-workspace-env", RunKind::Codex, ClaudeStatus::Exited);

        assert_eq!(relaunch_request(&info, None, None, env(&[("NODE_ENV", "dev")])).env_vars, env(&[("NODE_ENV", "dev")]));
        assert_eq!(relaunch_request(&info, None, None, None).env_vars, None);
        assert_eq!(relaunch_request(&info, None, None, env(&[])).env_vars, None);
    }

    #[test]
    fn a_spawn_launches_with_the_terminals_own_env_vars_over_the_workspaces() {
        let own = non_empty(env(&[("API_KEY", "own")]));
        assert_eq!(
            launch_env(own.as_ref(), env(&[("API_KEY", "workspace"), ("NODE_ENV", "dev")])),
            env(&[("API_KEY", "own"), ("NODE_ENV", "dev")])
        );

        let none = non_empty(env(&[]));
        assert_eq!(none, None, "a request with no variable in it has none of its own");
        assert_eq!(launch_env(none.as_ref(), env(&[("NODE_ENV", "dev")])), env(&[("NODE_ENV", "dev")]));
        assert_eq!(launch_env(None, env(&[])), None);
    }

    #[test]
    fn quays_variables_win_over_the_terminals_own_and_the_workspaces_on_relaunch() {
        let quays = ["QUAY_TERMINAL_ID", "QUAY_A2A_TOKEN", "CLAUDE_EVENTS_TOKEN", "CLAUDE_EVENTS_TAG"];
        let mut info = test_terminal("term-quay-env", RunKind::Claude, ClaudeStatus::Exited);
        info.env_vars = env(&[("QUAY_TERMINAL_ID", "own"), ("CLAUDE_EVENTS_TOKEN", "own"), ("API_KEY", "own")]);
        let workspace = env(&quays.map(|name| (name, "workspace")));

        let request = relaunch_request(&info, None, None, workspace);
        let launch = LaunchRef { terminal_id: info.id.clone(), launch: 7 };
        let cmd = crate::slices::pty::session::build_command(&request, &launch, 1234, "tok", None);

        let var = |name: &str| cmd.get_env(name).map(|value| value.to_string_lossy().to_string());
        assert_eq!(
            quays.map(|name| var(name).unwrap()),
            ["term-quay-env", "tok", "tok", "term-quay-env"]
        );
        assert_eq!(var("API_KEY").as_deref(), Some("own"));
    }

    #[test]
    fn a_terminals_env_vars_are_not_in_what_the_frontend_is_sent() {
        let mut info = test_terminal("term-env-sent", RunKind::Codex, ClaudeStatus::Idle);
        info.env_vars = env(&[("API_KEY", "sk-secret")]);

        let sent = serde_json::to_string(&info).unwrap();

        assert!(!sent.contains("env_vars"), "{sent}");
        assert!(!sent.contains("sk-secret"), "{sent}");
    }

    /// Windows reads a variable's name in any case, so only one of two spellings can reach the process.
    #[cfg(windows)]
    #[test]
    fn a_terminals_own_env_var_wins_over_the_workspaces_spelled_in_another_case() {
        let mut info = test_terminal("term-env-case", RunKind::Codex, ClaudeStatus::Exited);
        info.env_vars = env(&[("Path", "own")]);

        let request = relaunch_request(&info, None, None, env(&[("PATH", "workspace")]));

        assert_eq!(request.env_vars, env(&[("Path", "own")]));
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
            env_vars: None,
            command_text: None,
            claude_session_id: None,
            created_at: 1000,
            plugin_hint: false,
            link: None,
        };
        manager.terminals_info.lock().insert(id.to_string(), info);
        manager.begin_launch(id, run_kind)
    }

    fn status_of(manager: &PtyManager, id: &str) -> ClaudeStatus {
        manager.get_info(id).unwrap().claude_status
    }

    #[test]
    fn a_terminal_whose_launch_has_begun_may_call_quay_before_it_is_listed_and_not_once_closed() {
        // The manager also loads what other tests saved, so only these terminals are asked about
        let manager = PtyManager::new();
        let callers = |manager: &PtyManager| {
            let ids = manager.mcp_caller_ids();
            ["term-oc-early", "term-listed"].map(|id| ids.iter().any(|caller| caller == id))
        };
        manager.begin_launch("term-oc-early", RunKind::OpenCode);
        assert!(manager.get_info("term-oc-early").is_none());
        assert_eq!(callers(&manager), [true, false]);

        launched(&manager, "term-listed", RunKind::Claude);
        assert_eq!(callers(&manager), [true, true]);
        assert_eq!(manager.mcp_caller_ids().iter().filter(|id| *id == "term-listed").count(), 1, "listed once");

        let _ = manager.kill("term-oc-early");
        assert_eq!(callers(&manager), [false, true]);
    }

    #[test]
    fn a_terminal_still_starting_has_the_run_kind_of_its_launch() {
        let manager = PtyManager::new();
        manager.begin_launch("term-oc-starting", RunKind::OpenCode);
        assert_eq!(manager.run_kind_of("term-oc-starting"), Some(RunKind::OpenCode));
        launched(&manager, "term-listed-claude", RunKind::Claude);
        assert_eq!(manager.run_kind_of("term-listed-claude"), Some(RunKind::Claude));
        assert_eq!(manager.run_kind_of("term-none"), None);
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
    fn a_prompt_to_a_codex_terminal_presses_end_before_enter() {
        let manager = PtyManager::new();
        manager.insert_test_terminal(crate::slices::pty::models::test_terminal(
            "term-submit-codex",
            RunKind::Codex,
            ClaudeStatus::Idle,
        ));

        manager.submit_prompt("term-submit-codex", "review this").unwrap();

        assert_eq!(manager.test_input("term-submit-codex"), ["review this", "\x1b[F", "\r"]);
    }

    #[test]
    fn a_prompt_to_a_claude_terminal_is_its_text_then_enter() {
        let manager = PtyManager::new();
        manager.insert_test_terminal(crate::slices::pty::models::test_terminal(
            "term-submit-claude",
            RunKind::Claude,
            ClaudeStatus::Idle,
        ));

        manager.submit_prompt("term-submit-claude", "review this").unwrap();

        assert_eq!(manager.test_input("term-submit-claude"), ["review this", "\r"]);
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
        turn: &mut crate::slices::pty::osc7501::AntigravityTurn,
        body: &str,
    ) -> Option<TerminalStatusPayload> {
        let seq = crate::slices::pty::osc7501::Osc7501::parse(body).unwrap();
        manager.apply_turn_report(launch, &turn.read(&seq))
    }

    /// Logs what the turn watcher hears.
    fn turn_log(manager: &PtyManager) -> Arc<Mutex<Vec<TurnEvent>>> {
        let heard = Arc::new(Mutex::new(Vec::new()));
        let log = heard.clone();
        manager.add_turn_watcher(move |_, event| log.lock().push(event));
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
        let mut turn = Default::default();

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
                TurnEvent::Ended,
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

        let mut turn = Default::default();
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

        let mut turn = Default::default();
        assert!(agy_says(&manager, &launch, &mut turn, "state=done:msg=cG9uZw==").is_none());

        assert_eq!(status_of(&manager, "term-agy-exit"), ClaudeStatus::Exited);
        assert_eq!(
            *heard.lock(),
            [TurnEvent::Started, TurnEvent::Answered("pong".to_string()), TurnEvent::Ended]
        );
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
    fn a_launch_watcher_hears_each_launch_listed_and_over_and_the_close() {
        let manager = PtyManager::new();
        let first = launched(&manager, "term-launches", RunKind::Codex);
        let info = manager.get_info("term-launches").unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        manager.add_launch_watcher(move |event| log.lock().push(event));

        assert!(!manager.exit_launch(&LaunchRef { launch: 0, ..first.clone() }, None));
        let second = manager.begin_launch("term-launches", RunKind::Codex);
        assert!(manager.relist_launched(&second, info.clone(), || ()).is_ok());
        assert!(!manager.exit_launch(&first, Some(0)), "an old launch's exit is no news");
        assert!(manager.exit_launch(&second, Some(0)));
        assert_eq!(manager.insert_launched(&second, info).id, "term-launches");
        manager.kill("term-launches").unwrap();

        let closed = LaunchEvent::Closed("term-launches".to_string());
        let heard = [
            LaunchEvent::Over(first),
            LaunchEvent::Listed(second.clone()),
            LaunchEvent::Over(second.clone()),
            LaunchEvent::Listed(second),
            closed,
        ];
        assert_eq!(*seen.lock(), heard);
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
                env_vars: None,
                command_text: None,
                claude_session_id: None,
                created_at,
                plugin_hint: false,
                link: None,
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

    fn unique_id(tag: &str) -> String {
        format!("term-{}-{}", tag, Uuid::new_v4().simple())
    }

    #[test]
    fn a_dormant_terminal_shows_its_saved_screen_not_its_raw_log() {
        let id = unique_id("screen");
        let dir = get_sessions_dir();
        std::fs::write(dir.join(format!("{}.log", id)), "raw bytes that would garble").unwrap();
        let snapshot = super::super::screen::ScreenSnapshot { rows: 30, cols: 100, data: "the last screen".to_string() };
        super::super::screen::save_screen(&dir, &id, &snapshot).unwrap();

        let output = PtyManager::new().get_output(&id).unwrap();
        assert_eq!(output.data, "the last screen");
        // The pane would take a size for a live PTY's; the screen's text wraps at any width
        assert_eq!((output.rows, output.cols), (None, None));
    }

    #[test]
    fn a_dormant_terminal_an_older_quay_saved_falls_back_to_its_raw_log() {
        let id = unique_id("log");
        std::fs::write(get_sessions_dir().join(format!("{}.log", id)), "old raw output").unwrap();

        let output = PtyManager::new().get_output(&id).unwrap();
        assert_eq!(output.data, "old raw output");
        assert_eq!((output.rows, output.cols), (None, None));
    }

    #[test]
    fn closing_a_terminal_deletes_its_saved_screen_with_its_log() {
        let id = unique_id("close");
        let dir = get_sessions_dir();
        std::fs::write(dir.join(format!("{}.log", id)), "x").unwrap();
        let snapshot = super::super::screen::ScreenSnapshot { rows: 1, cols: 1, data: "x".to_string() };
        super::super::screen::save_screen(&dir, &id, &snapshot).unwrap();
        let manager = PtyManager::new();
        manager.insert_test_terminal(test_terminal(&id, RunKind::PowerShell, ClaudeStatus::Exited));

        manager.kill(&id).unwrap();
        assert!(!super::super::screen::screen_path(&dir, &id).exists());
        assert!(!dir.join(format!("{}.log", id)).exists());
    }

    /// A request to open a Command terminal under `id` that runs `command`.
    fn command_request(id: &str, command: &str) -> SpawnTerminalRequest {
        SpawnTerminalRequest {
            id: Some(id.to_string()),
            name: None,
            project_path: ".".to_string(),
            run_kind: RunKind::Command,
            permission_mode: None,
            command_text: Some(command.to_string()),
            rows: None,
            cols: None,
            env_vars: None,
            custom_flags: None,
            initial_prompt: None,
        }
    }

    #[test]
    fn a_spawn_under_a_listed_terminals_id_is_refused_and_leaves_it_as_it_was() {
        let id = unique_id("spawn-taken");
        let manager = PtyManager::new();
        let listed = test_terminal(&id, RunKind::Codex, ClaudeStatus::Idle);
        manager.insert_test_terminal(listed.clone());
        let launch = manager.begin_launch(&id, RunKind::Codex);

        let spawned = manager.spawn_to(command_request(&id, "exit"), None, 4321, "tok-1".to_string(), WebviewEvents::to(|_, _| ()));

        assert!(spawned.is_err(), "a terminal already listed under the id is restarted with relaunch");
        assert_eq!(format!("{:?}", manager.get_info(&id)), format!("{:?}", Some(listed)));
        assert!(manager.launch_current(&launch), "the listed terminal keeps its launch");
        assert!(!manager.sessions.lock().contains_key(&id));
        manager.kill(&id).unwrap();
    }

    #[cfg(windows)]
    /// The `pty-output` chunks among `sent`, in the order they were sent, as their seq and text.
    fn output_chunks(sent: &[(String, serde_json::Value)]) -> Vec<(u64, String)> {
        sent.iter()
            .filter(|(event, _)| event == "pty-output")
            .map(|(_, payload)| (payload["seq"].as_u64().unwrap(), payload["data"].as_str().unwrap().to_string()))
            .collect()
    }

    #[cfg(windows)]
    /// Waits up to 30 seconds for `done` to hold.
    fn wait_until(what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !done() {
            assert!(Instant::now() < deadline, "timed out waiting until {}", what);
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(windows)]
    /// Starts `id`, a Command terminal that runs `exit`, with its events recorded, answers the
    /// cursor query ConPTY opens it with, and waits for its process to exit, which leaves its PTY
    /// open, so closing the PTY sends a chunk of its own. Returns the manager, the recorder and
    /// what was sent. The recorder runs `delivering` with each event's name before it records it.
    fn exited_command_terminal(
        id: &str,
        delivering: impl Fn(&str) + Send + Sync + 'static,
    ) -> (PtyManager, WebviewEvents, Arc<Mutex<Vec<(String, serde_json::Value)>>>) {
        let mut info = test_terminal(id, RunKind::Command, ClaudeStatus::Exited);
        info.project_path = ".".to_string();
        info.command_text = Some("exit".to_string());
        let manager = PtyManager::new();
        manager.terminals_info.lock().insert(id.to_string(), info);
        let sent = Arc::new(Mutex::new(Vec::new()));
        let log = sent.clone();
        let webview = WebviewEvents::to(move |event, payload| {
            delivering(event);
            log.lock().push((event.to_string(), payload))
        });
        manager.relaunch_to(id, None, None, 4321, "tok-1".to_string(), None, webview.clone()).unwrap();
        wait_until("the session asks for the cursor", || {
            output_chunks(&sent.lock()).iter().any(|(_, text)| text.contains("\x1b[6n"))
        });
        manager.write(id, "\x1b[1;1R").unwrap();
        wait_until("the session exits", || {
            manager.get_info(id).is_some_and(|info| info.claude_status == ClaudeStatus::Exited)
        });
        (manager, webview, sent)
    }

    #[cfg(windows)]
    #[test]
    fn a_closed_terminal_leaves_no_saved_output_and_sends_nothing_after_its_close() {
        let id = unique_id("kill-teardown");
        // Once set, each event takes a while to be recorded, as though the reader were still
        // busy with it as the close runs
        let slow = Arc::new(AtomicBool::new(false));
        let slowed = slow.clone();
        let (manager, _webview, sent) = exited_command_terminal(&id, move |_| {
            if slowed.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(300));
            }
        });
        let dir = get_sessions_dir();
        assert!(dir.join(format!("{}.log", id)).exists(), "the session logs its output");

        slow.store(true, Ordering::SeqCst);
        let closing = Instant::now();
        manager.kill(&id).unwrap();
        // The 2 s a relaunch waits for the old PTY's last chunk
        assert!(closing.elapsed() < Duration::from_secs(2), "the close waits for no teardown output");
        let sent_by_close = output_chunks(&sent.lock()).len();

        // Long enough for the closed PTY's reader to take and drop its last chunk
        std::thread::sleep(Duration::from_secs(3));
        assert_eq!(output_chunks(&sent.lock()).len(), sent_by_close, "no output after the close");
        assert!(!dir.join(format!("{}.log", id)).exists(), "no log after the close");
        assert!(!super::super::screen::screen_path(&dir, &id).exists(), "no saved screen after the close");
    }

    #[cfg(windows)]
    #[test]
    fn two_relaunches_of_one_terminal_at_once_number_the_surviving_sessions_output_above_all_before_it() {
        let id = unique_id("relaunch-twice");
        // Once `hold` is set, the next chunk sent waits to be delivered until `release` is: the
        // first relaunch is then still ending the old session when the second one begins
        let hold = Arc::new(AtomicBool::new(false));
        let held = Arc::new(AtomicBool::new(false));
        let release = Arc::new(AtomicBool::new(false));
        let (holding, holder, released) = (hold.clone(), held.clone(), release.clone());
        let (manager, webview, sent) = exited_command_terminal(&id, move |event| {
            if event == "pty-output" && holding.swap(false, Ordering::SeqCst) {
                holder.store(true, Ordering::SeqCst);
                let deadline = Instant::now() + Duration::from_secs(30);
                while !released.load(Ordering::SeqCst) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        });
        let relaunching = |manager: &PtyManager, webview: &WebviewEvents| {
            let (manager, webview, id) = (manager.clone(), webview.clone(), id.clone());
            std::thread::spawn(move || manager.relaunch_to(&id, None, None, 4321, "tok-1".to_string(), None, webview))
        };

        hold.store(true, Ordering::SeqCst);
        let first = relaunching(&manager, &webview);
        wait_until("the old PTY's closing chunk is on its way", || held.load(Ordering::SeqCst));
        let second = relaunching(&manager, &webview);
        // As long as the second relaunch could take to start a session, were it not to wait
        std::thread::sleep(Duration::from_millis(500));
        release.store(true, Ordering::SeqCst);
        let relaunched = [first.join().unwrap(), second.join().unwrap()];
        assert!(relaunched.iter().any(Result::is_ok), "a relaunch finishes: {:?}", relaunched.map(|r| r.err()));
        // Long enough for every ended session's reader to send its last chunk
        std::thread::sleep(Duration::from_secs(3));

        let chunks = output_chunks(&sent.lock());
        // The pane keeps only a chunk numbered above every one it has seen
        assert!(
            chunks.windows(2).all(|pair| pair[1].0 > pair[0].0),
            "every chunk is numbered above every chunk sent before it: {:?}",
            chunks
        );
        manager.kill(&id).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_relaunched_terminal_numbers_its_output_above_everything_its_old_session_sent_as_it_closed() {
        // The `\e[6n` cursor query ConPTY opens every session with, which the pane must answer
        // before the process can start
        const CURSOR_QUERY: &str = "\x1b[6n";
        let id = unique_id("relaunch-seq");
        let mut info = test_terminal(&id, RunKind::Command, ClaudeStatus::Exited);
        info.project_path = ".".to_string();
        info.command_text = Some("exit".to_string());
        let manager = PtyManager::new();
        manager.terminals_info.lock().insert(id.clone(), info);
        let sent = Arc::new(Mutex::new(Vec::new()));
        let log = sent.clone();
        let webview = WebviewEvents::to(move |event, payload| log.lock().push((event.to_string(), payload)));
        let queries = |sent: &Mutex<Vec<(String, serde_json::Value)>>| {
            output_chunks(&sent.lock()).iter().filter(|(_, text)| text.contains(CURSOR_QUERY)).count()
        };

        manager.relaunch_to(&id, None, None, 4321, "tok-1".to_string(), None, webview.clone()).unwrap();
        wait_until("the first session asks for the cursor", || queries(&sent) == 1);
        manager.write(&id, "\x1b[1;1R").unwrap();
        // The operator typed `exit`: the process is over, and its PTY still open
        wait_until("the first session exits", || {
            manager.get_info(&id).is_some_and(|info| info.claude_status == ClaudeStatus::Exited)
        });
        let before_relaunch = output_chunks(&sent.lock()).len();

        manager.relaunch_to(&id, None, None, 4321, "tok-1".to_string(), None, webview).unwrap();
        wait_until("the relaunched session asks for the cursor", || queries(&sent) == 2);

        let chunks = output_chunks(&sent.lock());
        let new_query = chunks.iter().rposition(|(_, text)| text.contains(CURSOR_QUERY)).unwrap();
        assert!(
            new_query > before_relaunch,
            "ConPTY sends a chunk as the old PTY closes, before the new session's first: {:?}",
            chunks
        );
        // The pane keeps only a chunk numbered above every one it has seen, so it keeps them all,
        // the new session's cursor query included
        assert!(
            chunks.windows(2).all(|pair| pair[1].0 > pair[0].0),
            "every chunk is numbered above every chunk sent before it: {:?}",
            chunks
        );
        manager.kill(&id).unwrap();
    }
}
