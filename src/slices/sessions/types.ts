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
  cache_write_tokens: number;
  /** API responses for this model. */
  messages: number;
  estimated_cost_usd: number;
}

export type UsageWindowKey = "today" | "7d" | "30d" | "all";

export interface UsageWindow {
  key: UsageWindowKey;
  label: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  messages: number;
  /** What cache reads saved against the full input rate. */
  cache_savings_usd: number;
  /** Sorted by cost, highest first. */
  model_breakdown: ModelTokenUsage[];
}

export interface DailySpend {
  /** YYYY-MM-DD, UTC. */
  date: string;
  cost_usd: number;
  output_tokens: number;
}

export interface ClaudeTokenStats {
  total_sessions: number;
  total_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  total_cost_usd: number;
  model_breakdown: ModelTokenUsage[];
  /** today, 7d, 30d, all, in that order. */
  windows: UsageWindow[];
  /** The last 30 UTC days, oldest first. */
  daily: DailySpend[];
  /** First UTC day with transcript-derived usage. */
  tracked_since?: string | null;
  /** Last day covered by Claude Code's legacy stats-cache.json, when included. */
  legacy_through?: string | null;
  transcript_files: number;
  computed_at_ms: number;
}
