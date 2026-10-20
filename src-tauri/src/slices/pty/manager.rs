use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::models::{
    ClaudeStatus, PermissionMode, PersistedTerminalSession, RunKind, SpawnTerminalRequest,
    TerminalInfo, TerminalOutputPayload, TerminalStatusPayload,
};
use super::plugin_watch::{PluginWatch, PLUGIN_SILENCE};
use super::session::PtySession;

/// Pause between typing a prompt and pressing Enter, so the two arrive as separate reads
const PROMPT_SUBMIT_DELAY: Duration = Duration::from_millis(250);

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
}

impl PtyManager {
    pub fn new() -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            terminals_info: Arc::new(Mutex::new(HashMap::new())),
            dormant_buffers: Arc::new(Mutex::new(HashMap::new())),
            plugin_watches: Arc::new(Mutex::new(HashMap::new())),
        };
        manager.load_persisted_sessions();
        manager
    }

    pub fn load_persisted_sessions(&self) {
        let meta_path = get_sessions_dir().join("sessions.json");
        if let Ok(content) = std::fs::read_to_string(&meta_path) {
            if let Ok(list) = serde_json::from_str::<Vec<PersistedTerminalSession>>(&content) {
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

                    let info = TerminalInfo {
                        id: item.id.clone(),
                        name: item.name,
                        project_path: item.project_path,
                        run_kind: item.run_kind,
                        permission_mode: item.permission_mode,
                        live_mode: item.permission_mode,
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

        let meta_path = get_sessions_dir().join("sessions.json");
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(meta_path, json);
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
        let launch = self.begin_launch(&terminal_id, request.run_kind);
        let on_first_output = self.first_output_hook(&terminal_id, launch, app_handle.clone());
        let session = PtySession::spawn(
            request.clone(),
            terminal_id.clone(),
            start_seq,
            bridge_port,
            bridge_token,
            app_handle,
            on_first_output,
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
        self.sessions.lock().insert(terminal_id.clone(), session);
        self.terminals_info.lock().insert(terminal_id, info.clone());
        self.save_sessions_to_disk();

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

        // If an active session is running, terminate it before relaunching
        {
            let mut sessions = self.sessions.lock();
            sessions.remove(terminal_id);
        }

        let request = relaunch_request(&info, rows, cols, env_vars);

        let launch = self.begin_launch(terminal_id, info.run_kind);
        let on_first_output = self.first_output_hook(terminal_id, launch, app_handle.clone());
        let session = PtySession::spawn(
            request,
            terminal_id.to_string(),
            start_seq,
            bridge_port,
            bridge_token,
            app_handle,
            on_first_output,
        )?;

        let mut updated_info = info;
        updated_info.claude_status = if updated_info.run_kind.is_agent() {
            ClaudeStatus::Starting
        } else {
            ClaudeStatus::Unknown
        };
        updated_info.exit_code = None;
        updated_info.plugin_hint = false;

        self.dormant_buffers.lock().remove(terminal_id);
        self.sessions.lock().insert(terminal_id.to_string(), session);
        self.terminals_info.lock().insert(terminal_id.to_string(), updated_info.clone());
        self.save_sessions_to_disk();

        Ok(updated_info)
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(terminal_id) {
            session.write(data)
        } else {
            Err(format!("Terminal {} not found or inactive", terminal_id))
        }
    }

    /// Types `prompt` into an agent terminal, then presses Enter in a separate write.
    /// Agent TUIs read text and Enter that arrive in one chunk as a paste and leave it
    /// unsent, so Enter follows after `PROMPT_SUBMIT_DELAY` on a background thread.
    pub fn submit_prompt(&self, terminal_id: &str, prompt: &str) -> Result<(), String> {
        self.write(terminal_id, prompt)?;
        let sessions = self.sessions.clone();
        let terminal_id = terminal_id.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(PROMPT_SUBMIT_DELAY);
            let sessions = sessions.lock();
            match sessions.get(&terminal_id) {
                Some(session) => {
                    if let Err(e) = session.write("\r") {
                        tracing::warn!("Failed to submit prompt in PTY {}: {}", terminal_id, e);
                    }
                }
                None => tracing::warn!("PTY {} closed before its prompt was submitted", terminal_id),
            }
        });
        Ok(())
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
            });
        }

        Err(format!("Terminal {} not found", terminal_id))
    }

    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        // 1. Terminate running session process if active
        {
            let mut sessions = self.sessions.lock();
            sessions.remove(terminal_id);
        }

        self.plugin_watches.lock().remove(terminal_id);

        // 2. Remove from terminals_info and dormant_buffers
        let removed = {
            let mut info_map = self.terminals_info.lock();
            info_map.remove(terminal_id).is_some()
        };
        self.dormant_buffers.lock().remove(terminal_id);

        // 3. Clean up disk files
        let log_path = get_sessions_dir().join(format!("{}.log", terminal_id));
        let _ = std::fs::remove_file(log_path);
        self.save_sessions_to_disk();

        if removed {
            Ok(())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        let mut list: Vec<TerminalInfo> = self.terminals_info.lock().values().cloned().collect();
        list.sort_by_key(|t| t.created_at);
        list
    }

    pub fn get_info(&self, terminal_id: &str) -> Option<TerminalInfo> {
        self.terminals_info.lock().get(terminal_id).cloned()
    }

    pub fn update_status(&self, terminal_id: &str, status: ClaudeStatus) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.claude_status = status;
        }
    }

    /// Starts a new launch of `terminal_id`: no plugin heard and no clock running.
    /// Returns the launch's number.
    pub fn begin_launch(&self, terminal_id: &str, run_kind: RunKind) -> u64 {
        let watch = PluginWatch::new(run_kind);
        let launch = watch.launch();
        self.plugin_watches.lock().insert(terminal_id.to_string(), watch);
        launch
    }

    /// What a launch's PTY reader runs on its first output: it starts the plugin silence
    /// clock and, once that has run, sends `terminal-status` if the terminal went Unknown.
    fn first_output_hook(
        &self,
        terminal_id: &str,
        launch: u64,
        app_handle: AppHandle,
    ) -> Box<dyn FnOnce() + Send> {
        let manager = self.clone();
        let terminal_id = terminal_id.to_string();
        Box::new(move || {
            if !manager.note_first_output(&terminal_id, launch, Instant::now()) {
                return;
            }
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(PLUGIN_SILENCE).await;
                if let Some(status) = manager.check_plugin_silence(&terminal_id, launch, Instant::now()) {
                    let _ = app_handle.emit("terminal-status", status);
                }
            });
        })
    }

    /// Records the first output of launch `launch` at `now`. Returns true when that starts
    /// the plugin silence clock; the caller then calls `check_plugin_silence` once it has run.
    pub fn note_first_output(&self, terminal_id: &str, launch: u64, now: Instant) -> bool {
        self.plugin_watches
            .lock()
            .get_mut(terminal_id)
            .filter(|watch| watch.launch() == launch)
            .is_some_and(|watch| watch.first_output(now))
    }

    /// Shows the terminal as Unknown, with the plugin hint, when launch `launch` is still
    /// current and its silence clock has run out at `now` with nothing heard. Returns the
    /// new status when it moved.
    pub fn check_plugin_silence(
        &self,
        terminal_id: &str,
        launch: u64,
        now: Instant,
    ) -> Option<TerminalStatusPayload> {
        let watches = self.plugin_watches.lock();
        let watch = watches.get(terminal_id).filter(|watch| watch.launch() == launch)?;
        if !watch.silence_due(now) {
            return None;
        }
        let mut info_map = self.terminals_info.lock();
        let info = info_map.get_mut(terminal_id)?;
        if info.claude_status == ClaudeStatus::Exited {
            return None;
        }
        info.claude_status = ClaudeStatus::Unknown;
        info.plugin_hint = true;
        Some(status_payload(info))
    }

    /// Applies an authenticated event from the event-bridge plugin to the terminal's status,
    /// and returns the status it leaves. The event marks the plugin heard for this launch
    /// and clears the plugin hint.
    pub fn apply_plugin_event(
        &self,
        terminal_id: &str,
        event_type: &str,
    ) -> Option<TerminalStatusPayload> {
        let mut watches = self.plugin_watches.lock();
        let mut info_map = self.terminals_info.lock();
        let watch = watches.get_mut(terminal_id)?;
        let info = info_map.get_mut(terminal_id)?;
        info.plugin_hint = false;
        let heard = watch.hear(&info.claude_status);
        info.claude_status = match event_type {
            "turn.started" | "tool.started" => ClaudeStatus::Working,
            "turn.completed" | "session.started" => ClaudeStatus::Idle,
            "attention.notification" => ClaudeStatus::Waiting,
            "session.ended" => ClaudeStatus::Exited,
            _ => heard,
        };
        Some(status_payload(info))
    }

    /// Shows the terminal Working after an A2A message reached it. A terminal shown as
    /// Unknown stays Unknown: without the plugin Quay cannot see the turn end.
    pub fn mark_a2a_delivered(&self, terminal_id: &str) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            if info.claude_status != ClaudeStatus::Unknown {
                info.claude_status = ClaudeStatus::Working;
            }
        }
    }

    pub fn increment_auto_approved(&self, terminal_id: &str) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.auto_approved_count += 1;
        }
    }

    pub fn set_exit_code(&self, terminal_id: &str, exit_code: Option<i32>) {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.claude_status = ClaudeStatus::Exited;
            info.exit_code = exit_code;
            drop(info_map);
            self.save_sessions_to_disk();
        }
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

    pub fn set_live_mode(&self, terminal_id: &str, mode: PermissionMode) -> Result<(), String> {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.live_mode = mode;
            Ok(())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::pty::models::{PermissionMode, RunKind};

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
        let cmd = crate::slices::pty::session::build_command(&request, &info.id, 1234, "tok");
        let args: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(
            args,
            ["codex.exe", "--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5"]
        );
    }

    /// Puts a running terminal of `run_kind` under `id` and starts its first launch,
    /// as `spawn` does, without opening a PTY.
    fn launched(manager: &PtyManager, id: &str, run_kind: RunKind) -> u64 {
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
        manager.note_first_output("term-plugin-silent", launch, first_output);

        manager.check_plugin_silence(
            "term-plugin-silent",
            launch,
            first_output + Duration::from_secs(29),
        );
        let before = manager.get_info("term-plugin-silent").unwrap();
        assert_eq!(before.claude_status, ClaudeStatus::Starting);
        assert!(!before.plugin_hint);

        manager.check_plugin_silence(
            "term-plugin-silent",
            launch,
            first_output + Duration::from_secs(30),
        );
        let after = manager.get_info("term-plugin-silent").unwrap();
        assert_eq!(after.claude_status, ClaudeStatus::Unknown);
        assert!(after.plugin_hint);
    }

    /// Starts the launch's clock at `first_output` and checks it once 30 seconds have passed.
    fn silent_for_thirty_seconds(manager: &PtyManager, id: &str, launch: u64, first_output: Instant) {
        manager.note_first_output(id, launch, first_output);
        manager.check_plugin_silence(id, launch, first_output + Duration::from_secs(30));
    }

    #[test]
    fn any_plugin_event_clears_the_hint_and_moves_unknown_to_idle() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-reloaded", RunKind::Claude);
        silent_for_thirty_seconds(&manager, "term-plugin-reloaded", launch, Instant::now());

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
        manager.note_first_output("term-plugin-heard", launch, first_output);
        manager.apply_plugin_event("term-plugin-heard", "session.started");

        manager.check_plugin_silence(
            "term-plugin-heard",
            launch,
            first_output + Duration::from_secs(300),
        );

        let info = manager.get_info("term-plugin-heard").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Idle);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn the_clock_does_not_run_before_the_first_output() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-quiet", RunKind::Claude);

        manager.check_plugin_silence(
            "term-plugin-quiet",
            launch,
            Instant::now() + Duration::from_secs(300),
        );

        assert_eq!(status_of(&manager, "term-plugin-quiet"), ClaudeStatus::Starting);
    }

    #[test]
    fn only_the_first_output_of_a_launch_starts_the_clock() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-chatty", RunKind::Claude);
        let first_output = Instant::now();

        assert!(manager.note_first_output("term-plugin-chatty", launch, first_output));
        assert!(!manager.note_first_output(
            "term-plugin-chatty",
            launch,
            first_output + Duration::from_secs(20),
        ));
        manager.check_plugin_silence(
            "term-plugin-chatty",
            launch,
            first_output + Duration::from_secs(30),
        );

        assert_eq!(status_of(&manager, "term-plugin-chatty"), ClaudeStatus::Unknown);
    }

    #[test]
    fn relaunch_starts_over_with_a_new_clock_and_no_mark() {
        let manager = PtyManager::new();
        let first = launched(&manager, "term-plugin-relaunch", RunKind::Claude);
        let first_output = Instant::now();
        manager.note_first_output("term-plugin-relaunch", first, first_output);
        manager.apply_plugin_event("term-plugin-relaunch", "boot.started");

        manager.update_status("term-plugin-relaunch", ClaudeStatus::Starting);
        let second = manager.begin_launch("term-plugin-relaunch", RunKind::Claude);

        // The first launch's clock no longer counts
        manager.check_plugin_silence(
            "term-plugin-relaunch",
            first,
            first_output + Duration::from_secs(30),
        );
        assert_eq!(status_of(&manager, "term-plugin-relaunch"), ClaudeStatus::Starting);

        // The second launch has not heard the plugin, so its own silence counts
        let second_output = first_output + Duration::from_secs(40);
        silent_for_thirty_seconds(&manager, "term-plugin-relaunch", second, second_output);
        let info = manager.get_info("term-plugin-relaunch").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Unknown);
        assert!(info.plugin_hint);
    }

    #[test]
    fn silence_after_the_process_exits_leaves_it_exited() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-exited", RunKind::Claude);
        let first_output = Instant::now();
        manager.note_first_output("term-plugin-exited", launch, first_output);
        manager.update_status("term-plugin-exited", ClaudeStatus::Exited);

        manager.check_plugin_silence(
            "term-plugin-exited",
            launch,
            first_output + Duration::from_secs(30),
        );

        let info = manager.get_info("term-plugin-exited").unwrap();
        assert_eq!(info.claude_status, ClaudeStatus::Exited);
        assert!(!info.plugin_hint);
    }

    #[test]
    fn other_agent_kinds_run_no_plugin_clock() {
        let manager = PtyManager::new();
        let launch = launched(&manager, "term-plugin-codex", RunKind::Codex);
        let first_output = Instant::now();

        assert!(!manager.note_first_output("term-plugin-codex", launch, first_output));
        manager.check_plugin_silence(
            "term-plugin-codex",
            launch,
            first_output + Duration::from_secs(30),
        );

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
        silent_for_thirty_seconds(&manager, "term-a2a-unknown", launch, Instant::now());

        manager.mark_a2a_delivered("term-a2a-heard");
        manager.mark_a2a_delivered("term-a2a-unknown");

        assert_eq!(status_of(&manager, "term-a2a-heard"), ClaudeStatus::Working);
        assert_eq!(status_of(&manager, "term-a2a-unknown"), ClaudeStatus::Unknown);
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
