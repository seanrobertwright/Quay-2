use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSessionSummary {
    pub session_id: String,
    pub project_path: String,
    pub last_prompt: String,
    pub timestamp_ms: u64,
    pub file_size_bytes: u64,
    pub message_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTokenUsage {
    pub model_name: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    /// API responses for this model.
    #[serde(default)]
    pub messages: u64,
    pub estimated_cost_usd: f64,
}

/// Usage totals over one time window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    /// `today`, `7d`, `30d` or `all`.
    pub key: String,
    pub label: String,
    pub cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub messages: u64,
    /// What cache reads saved against the full input rate.
    pub cache_savings_usd: f64,
    /// Sorted by cost, highest first.
    pub model_breakdown: Vec<ModelTokenUsage>,
}

/// Spend on one UTC day.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySpend {
    /// `YYYY-MM-DD` (UTC).
    pub date: String,
    pub cost_usd: f64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeTokenStats {
    pub total_sessions: usize,
    pub total_messages: usize,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    #[serde(default)]
    pub total_cache_write_tokens: u64,
    pub total_cost_usd: f64,
    /// All-time breakdown, sorted by cost, highest first.
    pub model_breakdown: Vec<ModelTokenUsage>,
    /// `today`, `7d`, `30d`, `all`, in that order.
    #[serde(default)]
    pub windows: Vec<UsageWindow>,
    /// The last 30 UTC days, oldest first, including days with no spend.
    #[serde(default)]
    pub daily: Vec<DailySpend>,
    /// First UTC day with transcript-derived usage in the ledger.
    #[serde(default)]
    pub tracked_since: Option<String>,
    /// Last day covered by Claude Code's legacy `stats-cache.json`, when it was included.
    #[serde(default)]
    pub legacy_through: Option<String>,
    #[serde(default)]
    pub transcript_files: usize,
    #[serde(default)]
    pub computed_at_ms: i64,
}
