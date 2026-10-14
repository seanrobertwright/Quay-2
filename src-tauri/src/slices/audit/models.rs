use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditViolation {
    pub severity: String, // "blocker", "warning", "info"
    pub category: String, // "leak_user_path", "leak_secret", "untracked_artifact", "file_size"
    pub file_path: String,
    pub line_number: Option<usize>,
    pub message: String,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    pub passed: bool,
    pub blocker_count: usize,
    pub warning_count: usize,
    pub info_count: usize,
    pub files_scanned: usize,
    pub violations: Vec<AuditViolation>,
    pub generated_at: String,
}
