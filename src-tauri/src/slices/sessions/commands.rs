use super::models::{ClaudeSessionSummary, ClaudeTokenStats, ModelTokenUsage};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

fn get_claude_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not determine user home directory".to_string())?;
    Ok(Path::new(&home).join(".claude"))
}

#[tauri::command]
pub async fn list_claude_sessions(
    project_path: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    tokio::task::spawn_blocking(move || list_claude_sessions_sync(project_path, limit))
        .await
        .map_err(|e| format!("Session scan task panicked: {}", e))?
}

fn list_claude_sessions_sync(
    project_path: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let claude_dir = get_claude_dir()?;
    let history_file = claude_dir.join("history.jsonl");

    if !history_file.exists() {
        return Ok(Vec::new());
    }

    let file = File::open(&history_file).map_err(|e| format!("Failed to open history.jsonl: {}", e))?;
    let reader = BufReader::new(file);

    let norm_target = project_path.as_deref().map(normalize_path);
    let mut session_map: HashMap<String, ClaudeSessionSummary> = HashMap::new();

    for line in reader.lines() {
        let l = match line {
            Ok(v) => v,
            Err(_) => continue,
        };
        if l.trim().is_empty() {
            continue;
        }

        if let Ok(v) = serde_json::from_str::<Value>(&l) {
            let session_id = match v.get("sessionId").and_then(|s| s.as_str()) {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => continue,
            };
            let proj = v.get("project").and_then(|p| p.as_str()).unwrap_or("").to_string();
            let prompt = v.get("display").and_then(|d| d.as_str()).unwrap_or("").to_string();
            let timestamp_ms = v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);

            if let Some(target) = &norm_target {
                let norm_proj = normalize_path(&proj);
                if !norm_proj.contains(target) && !target.contains(&norm_proj) {
                    continue;
                }
            }

            let entry = session_map.entry(session_id.clone()).or_insert_with(|| {
                ClaudeSessionSummary {
                    session_id,
                    project_path: proj.clone(),
                    last_prompt: prompt.clone(),
                    timestamp_ms,
                    file_size_bytes: 0,
                    message_count: 0,
                }
            });

            entry.message_count += 1;
            if timestamp_ms >= entry.timestamp_ms {
                entry.timestamp_ms = timestamp_ms;
                if !prompt.trim().is_empty() && prompt != "/exit" {
                    entry.last_prompt = prompt;
                }
            }
        }
    }

    let max_items = limit.unwrap_or(50);
    let mut list: Vec<ClaudeSessionSummary> = session_map.into_values().collect();
    list.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
    list.truncate(max_items);

    Ok(list)
}

#[tauri::command]
pub async fn get_claude_stats() -> Result<ClaudeTokenStats, String> {
    tokio::task::spawn_blocking(get_claude_stats_sync)
        .await
        .map_err(|e| format!("Stats task panicked: {}", e))?
}

fn get_claude_stats_sync() -> Result<ClaudeTokenStats, String> {
    let claude_dir = get_claude_dir()?;
    let stats_file = claude_dir.join("stats-cache.json");

    if !stats_file.exists() {
        return Ok(ClaudeTokenStats {
            total_sessions: 0,
            total_messages: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_read_tokens: 0,
            total_cost_usd: 0.0,
            model_breakdown: Vec::new(),
        });
    }

    let content = std::fs::read_to_string(&stats_file)
        .map_err(|e| format!("Failed to read stats-cache.json: {}", e))?;
    let json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse stats-cache.json: {}", e))?;

    let total_sessions = json.get("totalSessions").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let total_messages = json.get("totalMessages").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;
    let mut total_cache_read: u64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut model_breakdown: Vec<ModelTokenUsage> = Vec::new();

    if let Some(usage_map) = json.get("modelUsage").and_then(|u| u.as_object()) {
        for (model_name, stats) in usage_map {
            let input_tokens = stats.get("inputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let output_tokens = stats.get("outputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_read = stats.get("cacheReadInputTokens").and_then(|v| v.as_u64()).unwrap_or(0);

            let cost = estimate_model_cost(model_name, input_tokens, output_tokens, cache_read);

            total_input += input_tokens;
            total_output += output_tokens;
            total_cache_read += cache_read;
            total_cost += cost;

            model_breakdown.push(ModelTokenUsage {
                model_name: model_name.clone(),
                input_tokens,
                output_tokens,
                cache_read_tokens: cache_read,
                estimated_cost_usd: cost,
            });
        }
    }

    // Sort models by cost descending
    model_breakdown.sort_by(|a, b| b.estimated_cost_usd.partial_cmp(&a.estimated_cost_usd).unwrap_or(std::cmp::Ordering::Equal));

    Ok(ClaudeTokenStats {
        total_sessions,
        total_messages,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cache_read_tokens: total_cache_read,
        total_cost_usd: (total_cost * 100.0).round() / 100.0,
        model_breakdown,
    })
}

fn estimate_model_cost(model: &str, input: u64, output: u64, cache_read: u64) -> f64 {
    let lower = model.to_lowercase();
    let (input_per_m, output_per_m, cache_per_m) = if lower.contains("opus") {
        (15.0, 75.0, 1.50)
    } else if lower.contains("haiku") {
        (0.80, 4.0, 0.08)
    } else if lower.contains("sonnet") {
        (3.0, 15.0, 0.30)
    } else if lower.contains("kimi") || lower.contains("qwen") {
        (0.50, 1.50, 0.05)
    } else {
        (3.0, 15.0, 0.30)
    };

    let cost_input = (input as f64 / 1_000_000.0) * input_per_m;
    let cost_output = (output as f64 / 1_000_000.0) * output_per_m;
    let cost_cache = (cache_read as f64 / 1_000_000.0) * cache_per_m;

    cost_input + cost_output + cost_cache
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}
