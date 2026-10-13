use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::AppHandle;
use uuid::Uuid;

use super::models::{ClaudeStatus, RunKind, SpawnTerminalRequest, TerminalInfo};
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
}
