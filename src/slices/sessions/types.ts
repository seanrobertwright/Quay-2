export interface ClaudeSessionSummary {
  session_id: string;
  project_path: string;
  last_prompt: string;
  timestamp_ms: number;
  file_size_bytes: number;
  message_count: number;
}

export interface ModelTokenUsage {
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  estimated_cost_usd: number;
}

export interface ClaudeTokenStats {
  total_sessions: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  model_breakdown: ModelTokenUsage[];
}
