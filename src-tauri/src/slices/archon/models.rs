use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonServiceStatus {
    pub running: bool,
    pub port: u16,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonPlanNode {
    pub id: String,
    #[serde(default)]
    pub depends_on: Option<Vec<String>>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub script: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonPlan {
    #[serde(default)]
    pub nodes: Vec<ArchonPlanNode>,
    #[serde(default)]
    pub layers: Option<Vec<Vec<ArchonPlanNode>>>,
    #[serde(default)]
    pub sinks: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonWorkflow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub plan: Option<ArchonPlan>,
    #[serde(default)]
    pub inputs: Option<serde_json::Value>,
    #[serde(default)]
    pub returns: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonRun {
    pub id: String,
    pub workflow_name: String,
    #[serde(default)]
    pub user_message: Option<String>,
    pub status: String,
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub working_path: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub total_cost_usd: Option<f64>,
    #[serde(default)]
    pub codebase_name: Option<String>,
    #[serde(default)]
    pub current_step_name: Option<String>,
    #[serde(default)]
    pub active_nodes: Option<Vec<String>>,
    #[serde(default)]
    pub nodes_completed: Option<u32>,
    #[serde(default)]
    pub nodes_total: Option<u32>,
    /// `started_at` as epoch milliseconds (UTC).
    #[serde(default)]
    pub started_ms: Option<i64>,
    /// `completed_at` as epoch milliseconds (UTC).
    #[serde(default)]
    pub completed_ms: Option<i64>,
    /// Conversation whose messages are the run's chat (`/api/conversations/{id}/messages`).
    #[serde(default)]
    pub conversation_platform_id: Option<String>,
}

/// Where one workflow node stands in a run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchonNodeState {
    /// Node id as the workflow plan names it; loop children use `group.child`.
    pub node_id: String,
    /// `running`, `completed`, `failed`, `skipped` or `cancelled`.
    pub state: String,
    pub started_ms: Option<i64>,
    pub duration_ms: Option<u64>,
    pub cost_usd: Option<f64>,
    /// Resolved model for agent nodes, e.g. `claude-opus-5-5`.
    pub model: Option<String>,
    /// Failure message, or the skip reason for skipped nodes.
    pub detail: Option<String>,
}

/// One line of the run log, condensed from an Archon workflow event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonLogEntry {
    pub id: String,
    pub ts_ms: Option<i64>,
    /// `node`, `tool`, `task`, `loop`, `approval`, `system`, `warning`, `error`, `hook` or `text`.
    pub kind: String,
    pub node_id: Option<String>,
    pub label: String,
    pub detail: Option<String>,
    /// `running`, `ok`, `failed` or `skipped` where the event has an outcome.
    pub status: Option<String>,
    pub duration_ms: Option<u64>,
}

/// A message in the run's conversation (the Archon web UI's chat pane).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub ts_ms: Option<i64>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonPendingApproval {
    pub prompt: String,
    pub node_id: Option<String>,
    pub requested_ms: Option<i64>,
}

/// Everything the run monitor shows for one run, condensed on the Rust side so that the
/// multi-megabyte event payload never crosses IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchonRunDetail {
    pub run: ArchonRun,
    pub last_activity_ms: Option<i64>,
    pub error: Option<String>,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub nodes: Vec<ArchonNodeState>,
    pub active_nodes: Vec<String>,
    /// Oldest first; at most the most recent `MAX_LOG_ENTRIES`.
    pub logs: Vec<ArchonLogEntry>,
    pub total_events: usize,
    /// Hook events left out of `logs` because hooks were not requested.
    pub hidden_hook_events: usize,
    pub logs_truncated: bool,
    /// Oldest first.
    pub messages: Vec<ArchonChatMessage>,
    pub pending_approval: Option<ArchonPendingApproval>,
    pub fetched_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecTask {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub line_number: usize,
    pub section: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdrItem {
    pub id: String,
    pub number: String,
    pub title: String,
    pub status: String,
    pub file_path: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSpecSummary {
    pub project_path: String,
    pub tasks: Vec<SpecTask>,
    pub adrs: Vec<AdrItem>,
    pub spec_files_found: Vec<String>,
}
