use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use parking_lot::Mutex;
use tauri::AppHandle;
use uuid::Uuid;

use super::models::{
    ClaudeStatus, PermissionMode, PersistedTerminalSession, SpawnTerminalRequest, TerminalInfo,
    TerminalOutputPayload,
};
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

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    terminals_info: Arc<Mutex<HashMap<String, TerminalInfo>>>,
    dormant_buffers: Arc<Mutex<HashMap<String, (String, u64)>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            terminals_info: Arc::new(Mutex::new(HashMap::new())),
            dormant_buffers: Arc::new(Mutex::new(HashMap::new())),
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

        let session = PtySession::spawn(
            request.clone(),
            terminal_id.clone(),
            bridge_port,
            bridge_token,
            app_handle,
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

        // If an active session is running, terminate it before relaunching
        {
            let mut sessions = self.sessions.lock();
            sessions.remove(terminal_id);
        }

        let request = SpawnTerminalRequest {
            id: Some(terminal_id.to_string()),
            name: Some(info.name.clone()),
            project_path: info.project_path.clone(),
            run_kind: info.run_kind,
            permission_mode: Some(info.permission_mode),
            command_text: info.command_text.clone(),
            rows,
            cols,
            env_vars,
            custom_flags: info.custom_flags.clone(),
        };

        let session = PtySession::spawn(
            request,
            terminal_id.to_string(),
            bridge_port,
            bridge_token,
            app_handle,
        )?;

        let mut updated_info = info;
        updated_info.claude_status = if updated_info.run_kind.is_agent() {
            ClaudeStatus::Starting
        } else {
            ClaudeStatus::Unknown
        };
        updated_info.exit_code = None;

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
