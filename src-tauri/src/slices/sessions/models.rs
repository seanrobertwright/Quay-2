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
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeTokenStats {
    pub total_sessions: usize,
    pub total_messages: usize,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_cost_usd: f64,
    pub model_breakdown: Vec<ModelTokenUsage>,
}
