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
