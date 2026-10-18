use super::models::{
    ClaudeSessionSummary, ClaudeTokenStats, DailySpend, ModelTokenUsage, UsageWindow,
};
use super::pricing::{aggregate_cost_usd, TokenUsage};
use super::usage::{refresh_usage, DayModelUsage, UsageSnapshot};
use crate::dates;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

fn get_home_dir() -> Result<PathBuf, String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .map_err(|_| "Could not determine user home directory".to_string())
}

/// Claude Code's config directory: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
fn get_claude_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR")
        && !dir.trim().is_empty()
    {
        return Ok(PathBuf::from(dir));
    }
    Ok(get_home_dir()?.join(".claude"))
}

/// Where Quay keeps its token ledger: `%LOCALAPPDATA%/Quay2` on Windows, else `~/.quay2`.
fn get_ledger_path() -> Result<PathBuf, String> {
    let base = match std::env::var("LOCALAPPDATA") {
        Ok(local) if !local.trim().is_empty() => PathBuf::from(local).join("Quay2"),
        _ => get_home_dir()?.join(".quay2"),
    };
    Ok(base.join("token-ledger.json"))
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

/// Usage recorded in Claude Code's `stats-cache.json`, which Claude Code stopped
/// updating; it covers history up to `last_day` that transcripts may no longer hold.
struct LegacyStats {
    last_day: i64,
    total_sessions: usize,
    models: Vec<ModelTokenUsage>,
}

fn load_legacy_stats(claude_dir: &Path) -> Option<LegacyStats> {
    let content = std::fs::read_to_string(claude_dir.join("stats-cache.json")).ok()?;
    let json: Value = serde_json::from_str(&content).ok()?;
    let last_day = dates::parse_day(json.get("lastComputedDate")?.as_str()?)?;
    let total_sessions = json.get("totalSessions").and_then(Value::as_u64).unwrap_or(0) as usize;

    let mut models = Vec::new();
    for (model_name, stats) in json.get("modelUsage")?.as_object()? {
        let n = |k: &str| stats.get(k).and_then(Value::as_u64).unwrap_or(0);
        let usage = TokenUsage {
            input: n("inputTokens"),
            output: n("outputTokens"),
            cache_read: n("cacheReadInputTokens"),
            // The cache does not split writes by TTL; price them at the 5-minute rate.
            cache_write_5m: n("cacheCreationInputTokens"),
            cache_write_1h: 0,
            fast: false,
        };
        let row = DayModelUsage {
            input_tokens: usage.input,
            output_tokens: usage.output,
            cache_read_tokens: usage.cache_read,
            cache_write_tokens: usage.cache_write_5m,
            messages: 0,
            cost_usd: aggregate_cost_usd(model_name, &usage),
            cache_savings_usd: 0.0,
        };
        models.push(model_row(model_name, &row));
    }
    Some(LegacyStats {
        last_day,
        total_sessions,
        models,
    })
}

fn model_row(model_name: &str, u: &DayModelUsage) -> ModelTokenUsage {
    ModelTokenUsage {
        model_name: model_name.to_string(),
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_tokens: u.cache_read_tokens,
        cache_write_tokens: u.cache_write_tokens,
        messages: u.messages,
        estimated_cost_usd: round_cents(u.cost_usd),
    }
}

fn round_cents(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Totals over the UTC days `from_day..=today` (all days when `from_day` is `None`),
/// plus the legacy totals when `legacy` is given.
fn build_window(
    key: &str,
    label: &str,
    snapshot: &UsageSnapshot,
    from_day: Option<i64>,
    legacy: Option<&LegacyStats>,
) -> UsageWindow {
    let mut per_model: BTreeMap<String, DayModelUsage> = BTreeMap::new();
    for (day, models) in &snapshot.days {
        let Some(n) = dates::parse_day(day) else {
            continue;
        };
        if from_day.is_some_and(|f| n < f) {
            continue;
        }
        for (model, usage) in models {
            per_model.entry(model.clone()).or_default().add(usage);
        }
    }
    if let Some(legacy) = legacy {
        for m in &legacy.models {
            let row = DayModelUsage {
                input_tokens: m.input_tokens,
                output_tokens: m.output_tokens,
                cache_read_tokens: m.cache_read_tokens,
                cache_write_tokens: m.cache_write_tokens,
                messages: 0,
                cost_usd: m.estimated_cost_usd,
                cache_savings_usd: 0.0,
            };
            per_model.entry(m.model_name.clone()).or_default().add(&row);
        }
    }

    let mut total = DayModelUsage::default();
    let mut breakdown: Vec<ModelTokenUsage> = per_model
        .iter()
        .map(|(model, u)| {
            total.add(u);
            model_row(model, u)
        })
        .collect();
    breakdown.sort_by(|a, b| {
        b.estimated_cost_usd
            .partial_cmp(&a.estimated_cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.output_tokens.cmp(&a.output_tokens))
    });

    UsageWindow {
        key: key.to_string(),
        label: label.to_string(),
        cost_usd: round_cents(total.cost_usd),
        input_tokens: total.input_tokens,
        output_tokens: total.output_tokens,
        cache_read_tokens: total.cache_read_tokens,
        cache_write_tokens: total.cache_write_tokens,
        messages: total.messages,
        cache_savings_usd: round_cents(total.cache_savings_usd),
        model_breakdown: breakdown,
    }
}

fn get_claude_stats_sync() -> Result<ClaudeTokenStats, String> {
    compute_stats(&get_claude_dir()?, &get_ledger_path()?)
}

fn compute_stats(claude_dir: &Path, ledger_path: &Path) -> Result<ClaudeTokenStats, String> {
    let legacy = load_legacy_stats(claude_dir);
    let snapshot = refresh_usage(
        &claude_dir.join("projects"),
        ledger_path,
        legacy.as_ref().map(|l| l.last_day),
    );

    let today = dates::utc_day(dates::now_ms());
    let windows = vec![
        build_window("today", "Today (UTC)", &snapshot, Some(today), None),
        build_window("7d", "Last 7 days", &snapshot, Some(today - 6), None),
        build_window("30d", "Last 30 days", &snapshot, Some(today - 29), None),
        build_window("all", "All time", &snapshot, None, legacy.as_ref()),
    ];

    let daily: Vec<DailySpend> = (today - 29..=today)
        .map(|day| {
            let key = dates::day_to_string(day);
            let (cost, output) = snapshot
                .days
                .get(&key)
                .map(|models| {
                    models.values().fold((0.0, 0u64), |(c, o), u| {
                        (c + u.cost_usd, o + u.output_tokens)
                    })
                })
                .unwrap_or((0.0, 0));
            DailySpend {
                date: key,
                cost_usd: round_cents(cost),
                output_tokens: output,
            }
        })
        .collect();

    let all = windows.last().cloned().expect("windows is non-empty");
    Ok(ClaudeTokenStats {
        total_sessions: snapshot.sessions_on_disk
            + legacy.as_ref().map(|l| l.total_sessions).unwrap_or(0),
        total_messages: all.messages as usize,
        total_input_tokens: all.input_tokens,
        total_output_tokens: all.output_tokens,
        total_cache_read_tokens: all.cache_read_tokens,
        total_cache_write_tokens: all.cache_write_tokens,
        total_cost_usd: all.cost_usd,
        model_breakdown: all.model_breakdown.clone(),
        windows,
        daily,
        tracked_since: snapshot.days.keys().next().cloned(),
        legacy_through: legacy.as_ref().map(|l| dates::day_to_string(l.last_day)),
        transcript_files: snapshot.transcript_files,
        computed_at_ms: dates::now_ms(),
    })
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live check against this machine's transcripts with a throwaway ledger:
    /// `cargo test --lib live_claude_stats -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_claude_stats() {
        let ledger = std::env::temp_dir()
            .join(format!("quay-live-ledger-{}", uuid::Uuid::new_v4().simple()))
            .join("token-ledger.json");
        let started = std::time::Instant::now();
        let stats = compute_stats(&get_claude_dir().unwrap(), &ledger).unwrap();
        let first = started.elapsed();
        let again = std::time::Instant::now();
        compute_stats(&get_claude_dir().unwrap(), &ledger).unwrap();
        println!("scan {:?}, cached rescan {:?}, files {}", first, again.elapsed(), stats.transcript_files);
        if let Ok(dir) = std::env::var("QUAY_DUMP_DIR") {
            let json = serde_json::to_string_pretty(&stats).unwrap();
            std::fs::write(std::path::Path::new(&dir).join("get_claude_stats.json"), json).unwrap();
        }
        println!("legacy through {:?}, tracked since {:?}", stats.legacy_through, stats.tracked_since);
        for w in &stats.windows {
            println!("{:<12} ${:>10.2}  responses {:>6}  out {:>11}  cache savings ${:.2}", w.label, w.cost_usd, w.messages, w.output_tokens, w.cache_savings_usd);
            for m in w.model_breakdown.iter().take(6) {
                println!("    {:<34} ${:>10.2}  out {:>11}", m.model_name, m.estimated_cost_usd, m.output_tokens);
            }
        }
        let _ = std::fs::remove_dir_all(ledger.parent().unwrap());
    }
}
