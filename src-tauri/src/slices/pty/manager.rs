use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::AppHandle;
use uuid::Uuid;

use super::models::{
    ClaudeStatus, PermissionMode, RunKind, SpawnTerminalRequest, TerminalInfo,
    TerminalOutputPayload,
};
use super::session::PtySession;

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    terminals_info: Arc<Mutex<HashMap<String, TerminalInfo>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            terminals_info: Arc::new(Mutex::new(HashMap::new())),
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

        let info = TerminalInfo {
            id: terminal_id.clone(),
            name: session.name.clone(),
            project_path: session.project_path.clone(),
            run_kind: session.run_kind,
            permission_mode: session.permission_mode,
            live_mode: session.permission_mode,
            claude_status: match session.run_kind {
                RunKind::Claude => ClaudeStatus::Starting,
                _ => ClaudeStatus::Unknown,
            },
            auto_approved_count: 0,
            exit_code: None,
            task_title: None,
            current_tool: None,
            custom_name: request.name.is_some(),
        };

        self.sessions.lock().insert(terminal_id.clone(), session);
        self.terminals_info.lock().insert(terminal_id, info.clone());

        Ok(info)
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(terminal_id) {
            session.write(data)
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub fn resize(&self, terminal_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(terminal_id) {
            session.resize(rows, cols)
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub fn get_output(&self, terminal_id: &str) -> Result<TerminalOutputPayload, String> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(terminal_id) {
            Ok(session.get_output())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        if sessions.remove(terminal_id).is_some() {
            let mut info_map = self.terminals_info.lock();
            if let Some(info) = info_map.get_mut(terminal_id) {
                info.claude_status = ClaudeStatus::Exited;
                info.exit_code = Some(0);
            }
            Ok(())
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        self.terminals_info.lock().values().cloned().collect()
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
        }
    }

    pub fn rename(&self, terminal_id: &str, new_name: &str) -> Result<(), String> {
        let mut info_map = self.terminals_info.lock();
        if let Some(info) = info_map.get_mut(terminal_id) {
            info.name = new_name.to_string();
            info.custom_name = true;
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
}
