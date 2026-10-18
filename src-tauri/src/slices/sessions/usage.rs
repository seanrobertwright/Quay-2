//! Token usage from Claude Code transcripts (`<claude dir>/projects/**/*.jsonl`).
//!
//! Each assistant API response is logged once per content block, so the same response
//! appears on several lines; later copies carry the final output count. Responses are
//! deduplicated across all files by `message.id` + `requestId`, keeping the largest value
//! of each counter.
//!
//! Claude Code deletes old transcripts (30 days by default), so per-day totals are
//! persisted to a ledger. A day still present in the transcripts replaces its ledger row
//! once the transcripts hold at least as many responses for it; a day whose transcripts
//! were deleted keeps its ledger row.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::pricing::{TokenUsage, cache_savings_usd, cost_usd};
use crate::dates;

/// One deduplicated API response.
#[derive(Debug, Clone)]
struct ResponseRecord {
    model: String,
    session_id: String,
    day: i64,
    usage: TokenUsage,
}

impl ResponseRecord {
    /// Field-wise maximum, for merging duplicate log lines of the same response.
    fn absorb(&mut self, other: &ResponseRecord) {
        let (a, b) = (&mut self.usage, &other.usage);
        a.input = a.input.max(b.input);
        a.output = a.output.max(b.output);
        a.cache_read = a.cache_read.max(b.cache_read);
        a.cache_write_5m = a.cache_write_5m.max(b.cache_write_5m);
        a.cache_write_1h = a.cache_write_1h.max(b.cache_write_1h);
        a.fast |= b.fast;
    }
}

/// Parsed responses of one transcript file, valid while its length and mtime are unchanged.
struct FileEntry {
    len: u64,
    mtime_ms: u128,
    records: Vec<(String, ResponseRecord)>,
}

/// Aggregated usage for one model on one UTC day. Also the ledger row format.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct DayModelUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub messages: u64,
    pub cost_usd: f64,
    #[serde(default)]
    pub cache_savings_usd: f64,
}

impl DayModelUsage {
    fn add_response(&mut self, model: &str, u: &TokenUsage) {
        self.input_tokens += u.input;
        self.output_tokens += u.output;
        self.cache_read_tokens += u.cache_read;
        self.cache_write_tokens += u.cache_write_5m + u.cache_write_1h;
        self.messages += 1;
        self.cost_usd += cost_usd(model, u);
        self.cache_savings_usd += cache_savings_usd(model, u);
    }

    pub fn add(&mut self, other: &DayModelUsage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
        self.messages += other.messages;
        self.cost_usd += other.cost_usd;
        self.cache_savings_usd += other.cache_savings_usd;
    }
}

/// `day (YYYY-MM-DD) -> model -> usage`. BTreeMap keeps days in order on disk.
pub type DayTable = BTreeMap<String, BTreeMap<String, DayModelUsage>>;

#[derive(Debug, Default, Serialize, Deserialize)]
struct Ledger {
    version: u32,
    days: DayTable,
}

const LEDGER_VERSION: u32 = 1;

/// Result of a scan: the merged day table plus facts about the transcripts on disk.
pub struct UsageSnapshot {
    pub days: DayTable,
    pub transcript_files: usize,
    pub sessions_on_disk: usize,
}

#[derive(Default)]
struct ScanState {
    files: HashMap<PathBuf, FileEntry>,
}

/// Serializes scans and holds the per-file cache between calls.
fn scan_state() -> &'static Mutex<ScanState> {
    static STATE: OnceLock<Mutex<ScanState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(ScanState::default()))
}

fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => collect_jsonl(&path, out),
            Ok(ft) if ft.is_file() && path.extension().is_some_and(|e| e == "jsonl") => {
                out.push(path)
            }
            _ => {}
        }
    }
}

fn u64_at(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Parses one transcript line into `(dedupe key, record)`, or `None` if it is not an
/// assistant response with usage.
fn parse_line(line: &str) -> Option<(String, ResponseRecord)> {
    // Cheap pre-filter: most lines are tool results and user turns.
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let model = msg.get("model").and_then(Value::as_str)?.to_string();
    let msg_id = msg.get("id").and_then(Value::as_str)?;
    let request_id = v.get("requestId").and_then(Value::as_str).unwrap_or("");
    let ts = v.get("timestamp").and_then(Value::as_str)?;
    let day = dates::utc_day(dates::parse_timestamp_ms(ts)?);

    let total_write = u64_at(usage, "cache_creation_input_tokens");
    let (write_5m, write_1h) = match usage.get("cache_creation") {
        Some(cc) => (
            u64_at(cc, "ephemeral_5m_input_tokens"),
            u64_at(cc, "ephemeral_1h_input_tokens"),
        ),
        // Older transcripts only report the total; price it at the 5-minute rate.
        None => (total_write, 0),
    };
    let record = ResponseRecord {
        model,
        session_id: v
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        day,
        usage: TokenUsage {
            input: u64_at(usage, "input_tokens"),
            output: u64_at(usage, "output_tokens"),
            cache_read: u64_at(usage, "cache_read_input_tokens"),
            cache_write_5m: write_5m,
            cache_write_1h: write_1h,
            fast: usage.get("speed").and_then(Value::as_str) == Some("fast"),
        },
    };
    // Placeholder entries such as `<synthetic>` carry no tokens.
    if record.usage == TokenUsage::default() {
        return None;
    }
    Some((format!("{}:{}", msg_id, request_id), record))
}

fn parse_file(path: &Path) -> Vec<(String, ResponseRecord)> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|l| parse_line(&l))
        .collect()
}

fn file_fingerprint(path: &Path) -> Option<(u64, u128)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some((meta.len(), mtime))
}

/// Rebuilds the per-day table from the transcripts under `projects_dir`, re-parsing only
/// files whose length or mtime changed since the previous call. Responses on or before
/// `exclude_through_day` are dropped (that range is covered by the legacy stats cache).
fn scan_transcripts(
    state: &mut ScanState,
    projects_dir: &Path,
    exclude_through_day: Option<i64>,
) -> UsageSnapshot {
    let mut paths = Vec::new();
    collect_jsonl(projects_dir, &mut paths);

    let live: HashSet<&PathBuf> = paths.iter().collect();
    state.files.retain(|p, _| live.contains(p));

    for path in &paths {
        let Some((len, mtime_ms)) = file_fingerprint(path) else {
            continue;
        };
        let fresh = state
            .files
            .get(path)
            .is_some_and(|e| e.len == len && e.mtime_ms == mtime_ms);
        if !fresh {
            let records = parse_file(path);
            state.files.insert(
                path.clone(),
                FileEntry {
                    len,
                    mtime_ms,
                    records,
                },
            );
        }
    }

    let mut unique: HashMap<&str, ResponseRecord> = HashMap::new();
    for entry in state.files.values() {
        for (key, rec) in &entry.records {
            match unique.get_mut(key.as_str()) {
                Some(existing) => existing.absorb(rec),
                None => {
                    unique.insert(key.as_str(), rec.clone());
                }
            }
        }
    }

    let mut days: DayTable = BTreeMap::new();
    let mut sessions: HashSet<&str> = HashSet::new();
    for rec in unique.values() {
        if exclude_through_day.is_some_and(|d| rec.day <= d) {
            continue;
        }
        if !rec.session_id.is_empty() {
            sessions.insert(rec.session_id.as_str());
        }
        days.entry(dates::day_to_string(rec.day))
            .or_default()
            .entry(rec.model.clone())
            .or_default()
            .add_response(&rec.model, &rec.usage);
    }

    UsageSnapshot {
        days,
        transcript_files: paths.len(),
        sessions_on_disk: sessions.len(),
    }
}

/// Merges freshly scanned days into the ledger. A scanned (day, model) row replaces the
/// ledger row when it covers at least as many responses; otherwise transcripts for that
/// day were partly deleted and the ledger row is kept.
pub fn merge_into_ledger(ledger: &mut DayTable, scanned: &DayTable) {
    for (day, models) in scanned {
        let ledger_day = ledger.entry(day.clone()).or_default();
        for (model, usage) in models {
            match ledger_day.get(model) {
                Some(existing) if existing.messages > usage.messages => {}
                _ => {
                    ledger_day.insert(model.clone(), usage.clone());
                }
            }
        }
    }
}

fn load_ledger(path: &Path) -> DayTable {
    let Ok(content) = std::fs::read_to_string(path) else {
        return DayTable::new();
    };
    match serde_json::from_str::<Ledger>(&content) {
        Ok(l) if l.version == LEDGER_VERSION => l.days,
        Ok(l) => {
            tracing::warn!(
                "token ledger version {} not understood; starting fresh",
                l.version
            );
            DayTable::new()
        }
        Err(e) => {
            tracing::warn!(
                "token ledger at {} is unreadable ({}); starting fresh",
                path.display(),
                e
            );
            DayTable::new()
        }
    }
}

/// Writes the ledger through a uniquely named temp file and a rename, so a crash mid-write
/// never leaves a truncated ledger.
fn save_ledger(path: &Path, days: &DayTable) -> Result<(), String> {
    let ledger = Ledger {
        version: LEDGER_VERSION,
        days: days.clone(),
    };
    let json = serde_json::to_string_pretty(&ledger).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Scans transcripts, folds them into the ledger at `ledger_path`, persists it, and
/// returns the merged table.
pub fn refresh_usage(
    projects_dir: &Path,
    ledger_path: &Path,
    exclude_through_day: Option<i64>,
) -> UsageSnapshot {
    let mut state = scan_state().lock().unwrap_or_else(|p| p.into_inner());
    let scanned = scan_transcripts(&mut state, projects_dir, exclude_through_day);

    let mut ledger = load_ledger(ledger_path);
    merge_into_ledger(&mut ledger, &scanned.days);
    if let Err(e) = save_ledger(ledger_path, &ledger) {
        tracing::warn!("could not save token ledger: {}", e);
    }
    // The ledger keeps every day it has seen; days the legacy cache covers are left out
    // of the result so they are not counted twice.
    if let Some(d) = exclude_through_day {
        ledger.retain(|day, _| dates::parse_day(day).is_some_and(|n| n > d));
    }

    UsageSnapshot {
        days: ledger,
        transcript_files: scanned.transcript_files,
        sessions_on_disk: scanned.sessions_on_disk,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, req: &str, ts: &str, model: &str, out: u64, extra: &str) -> String {
        format!(
            r#"{{"type":"assistant","requestId":"{req}","sessionId":"s1","timestamp":"{ts}","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":2,"output_tokens":{out},"cache_read_input_tokens":1000,"cache_creation_input_tokens":500{extra}}}}}}}"#
        )
    }

    #[test]
    fn parse_line_reads_usage_and_cache_split() {
        let l = line(
            "m1",
            "r1",
            "2026-10-18T14:06:11.829Z",
            "claude-opus-5-5",
            300,
            r#","cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":500},"speed":"fast""#,
        );
        let (key, rec) = parse_line(&l).unwrap();
        assert_eq!(key, "m1:r1");
        assert_eq!(dates::day_to_string(rec.day), "2026-10-18");
        assert_eq!(rec.usage.output, 300);
        assert_eq!(rec.usage.cache_write_1h, 500);
        assert_eq!(rec.usage.cache_write_5m, 0);
        assert!(rec.usage.fast);
    }

    #[test]
    fn parse_line_skips_non_assistant_lines() {
        assert!(parse_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(parse_line(r#"{"type":"user","usage":"word in a prompt"}"#).is_none());
        assert!(parse_line("not json \"usage\"").is_none());
    }

    #[test]
    fn duplicates_across_files_count_once_with_final_output() {
        let dir =
            std::env::temp_dir().join(format!("quay-usage-test-{}", uuid::Uuid::new_v4().simple()));
        let sub = dir.join("proj").join("session").join("subagents");
        std::fs::create_dir_all(&sub).unwrap();
        let a = [
            line("m1", "r1", "2026-10-18T10:00:00Z", "claude-opus-5-5", 8, ""),
            line(
                "m1",
                "r1",
                "2026-10-18T10:00:00Z",
                "claude-opus-5-5",
                8611,
                "",
            ),
            line(
                "m2",
                "r2",
                "2026-10-17T10:00:00Z",
                "claude-haiku-5-5",
                10,
                "",
            ),
        ]
        .join("\n");
        std::fs::write(dir.join("proj").join("a.jsonl"), a).unwrap();
        // The same response copied into a second file (a resumed session).
        std::fs::write(
            sub.join("b.jsonl"),
            line("m1", "r1", "2026-10-18T10:00:00Z", "claude-opus-5-5", 8, ""),
        )
        .unwrap();

        let mut state = ScanState::default();
        let snap = scan_transcripts(&mut state, &dir, None);
        let opus = &snap.days["2026-10-18"]["claude-opus-5-5"];
        assert_eq!(opus.messages, 1);
        assert_eq!(opus.output_tokens, 8611);
        assert_eq!(snap.days["2026-10-17"]["claude-haiku-5-5"].messages, 1);
        assert_eq!(snap.transcript_files, 2);
        assert_eq!(snap.sessions_on_disk, 1);

        // Days covered by the legacy cache are excluded.
        let cutoff = dates::parse_day("2026-10-17");
        let snap2 = scan_transcripts(&mut state, &dir, cutoff);
        assert!(!snap2.days.contains_key("2026-10-17"));
        assert!(snap2.days.contains_key("2026-10-18"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ledger_keeps_days_whose_transcripts_were_deleted() {
        let row = |messages: u64, cost: f64| DayModelUsage {
            messages,
            cost_usd: cost,
            ..Default::default()
        };
        let mut ledger = DayTable::new();
        ledger
            .entry("2026-09-01".into())
            .or_default()
            .insert("claude-opus-5-5".into(), row(50, 10.0));
        ledger
            .entry("2026-10-18".into())
            .or_default()
            .insert("claude-opus-5-5".into(), row(5, 1.0));

        let mut scanned = DayTable::new();
        // Today grew; 2026-09-01 lost some transcripts (only 20 of 50 responses remain).
        scanned
            .entry("2026-10-18".into())
            .or_default()
            .insert("claude-opus-5-5".into(), row(9, 2.0));
        scanned
            .entry("2026-09-01".into())
            .or_default()
            .insert("claude-opus-5-5".into(), row(20, 4.0));

        merge_into_ledger(&mut ledger, &scanned);
        assert_eq!(ledger["2026-10-18"]["claude-opus-5-5"], row(9, 2.0));
        assert_eq!(ledger["2026-09-01"]["claude-opus-5-5"], row(50, 10.0));
    }

    #[test]
    fn ledger_round_trips_through_disk() {
        let path = std::env::temp_dir()
            .join(format!(
                "quay-ledger-test-{}",
                uuid::Uuid::new_v4().simple()
            ))
            .join("token-ledger.json");
        let mut days = DayTable::new();
        days.entry("2026-10-18".into()).or_default().insert(
            "claude-opus-5-5".into(),
            DayModelUsage {
                messages: 3,
                cost_usd: 1.5,
                ..Default::default()
            },
        );
        save_ledger(&path, &days).unwrap();
        assert_eq!(load_ledger(&path), days);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
