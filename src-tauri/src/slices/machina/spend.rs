//! Agent spend per work order. Quay can price the work of two agents: Claude Code, from
//! its transcripts, and PiG, from its session files, which carry PiG's own cost figures.
//! Every other agent is reported as unmeasured rather than guessed. Each measure is a pure
//! read of those files, so it works after the terminal closes and after Quay restarts.

use std::fs;
use std::path::{Path, PathBuf};

use super::models::SpendSnapshot;
use crate::slices::sessions::commands::{get_claude_dir, get_home_dir};
use crate::slices::sessions::usage::transcript_dir_spend;

/// The directory name Claude Code gives a working directory under `projects/`:
/// every character other than an ASCII letter or digit becomes `-`.
pub fn claude_project_dir_name(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The directory name PiG gives a working directory under its sessions directory, copied
/// from `encodeCwdForSessionDir` in PiG v0.5.1: one leading `/` or `\` is dropped, every
/// `/`, `\` and `:` becomes `-`, and the result is wrapped in `--`.
pub fn pig_session_dir_name(cwd: &str) -> String {
    let path = cwd.strip_prefix(['/', '\\']).unwrap_or(cwd);
    let encoded: String = path
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c })
        .collect();
    format!("--{}--", encoded)
}

fn unmeasured(note: String) -> SpendSnapshot {
    SpendSnapshot {
        measured: false,
        usd: 0.0,
        responses: 0,
        note,
    }
}

/// Spend of the sessions `author_agent` ran in `worktree`.
pub fn measure(author_agent: &str, worktree: &str) -> SpendSnapshot {
    match author_agent {
        "claude" => measure_claude(worktree),
        "pig" => {
            let home = get_home_dir().ok();
            match pig_sessions(|name| std::env::var(name).ok(), home.as_deref(), Path::new(worktree)) {
                Some(sessions) => measure_pig(&sessions, worktree),
                None => unmeasured(
                    "Spend is not measured for PiG: Quay can't find the home folder PiG keeps its sessions in."
                        .to_string(),
                ),
            }
        }
        other => unmeasured(format!(
            "Spend is not measured for {}: only Claude Code transcripts and PiG sessions can be priced.",
            other
        )),
    }
}

/// Spend of the Claude Code sessions started in `worktree`.
fn measure_claude(worktree: &str) -> SpendSnapshot {
    let projects = match get_claude_dir() {
        Ok(dir) => dir.join("projects"),
        Err(e) => return unmeasured(e),
    };
    let want = claude_project_dir_name(worktree).to_lowercase();
    let found = fs::read_dir(&projects).ok().and_then(|entries| {
        entries
            .flatten()
            .find(|e| e.file_name().to_string_lossy().to_lowercase() == want)
            .map(|e| e.path())
    });
    match found {
        None => SpendSnapshot {
            measured: true,
            usd: 0.0,
            responses: 0,
            note: "No Claude Code transcripts for this worktree yet.".to_string(),
        },
        Some(dir) => {
            let s = transcript_dir_spend(&dir);
            SpendSnapshot {
                measured: true,
                usd: s.usd,
                responses: s.responses,
                note: format!(
                    "Priced from {} Claude Code transcript file(s) for this worktree.",
                    s.files
                ),
            }
        }
    }
}

/// Where PiG keeps its sessions.
#[derive(Debug, PartialEq)]
enum PigSessions {
    /// `PIG_CODING_AGENT_SESSION_DIR`: one folder for the sessions of every working directory.
    Shared(PathBuf),
    /// A sessions directory with one folder per working directory, named by
    /// `pig_session_dir_name`.
    PerDirectory(PathBuf),
}

/// `value` as PiG reads a directory variable: a leading `~` or `~/` expanded to `home`, as
/// PiG's `ExpandHome` does, and a relative path taken from `cwd`, the folder PiG runs in.
/// `None` when `home` is needed and unknown.
fn pig_dir(value: &str, home: Option<&Path>, cwd: &Path) -> Option<PathBuf> {
    let dir = if value == "~" {
        home?.to_path_buf()
    } else {
        match value.strip_prefix("~/") {
            Some(rest) => home?.join(rest),
            None => PathBuf::from(value),
        }
    };
    Some(cwd.join(dir))
}

/// Where PiG keeps its sessions when it runs in `cwd`, from the variables `var` reads and
/// the home folder, in PiG v0.5.1's order: `PIG_CODING_AGENT_SESSION_DIR`; else `sessions`
/// in the agent directory, which is `PIG_CODING_AGENT_DIR`, else `agent` in the config
/// root, which is `PIG_HOME`, else `pig` in `XDG_CONFIG_HOME`, else `~/.pig`. An empty
/// variable counts as unset. A `--session-dir` flag, PiG's `sessionDir` setting and
/// Pi-sharing mode (`PIG_USE_PI_DIRS=1`) are not followed, so their sessions read as no
/// sessions.
fn pig_sessions(var: impl Fn(&str) -> Option<String>, home: Option<&Path>, cwd: &Path) -> Option<PigSessions> {
    let set = |name: &str| var(name).filter(|value| !value.is_empty());
    if let Some(dir) = set("PIG_CODING_AGENT_SESSION_DIR") {
        return pig_dir(&dir, home, cwd).map(PigSessions::Shared);
    }
    let agent = match set("PIG_CODING_AGENT_DIR") {
        Some(dir) => pig_dir(&dir, home, cwd)?,
        None => {
            let root = match (set("PIG_HOME"), set("XDG_CONFIG_HOME")) {
                (Some(pig_home), _) => pig_dir(&pig_home, home, cwd)?,
                (None, Some(xdg)) => pig_dir(&xdg, home, cwd)?.join("pig"),
                (None, None) => home?.join(".pig"),
            };
            root.join("agent")
        }
    };
    Some(PigSessions::PerDirectory(agent.join("sessions")))
}

/// The `*.jsonl` files directly in `dir`.
fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    files.sort();
    files
}

/// The `cwd` a PiG session file's header line names, read from that line alone.
fn pig_session_cwd(file: &Path) -> Option<String> {
    use std::io::BufRead;
    let mut first = String::new();
    std::io::BufReader::new(fs::File::open(file).ok()?).read_line(&mut first).ok()?;
    let header: serde_json::Value = serde_json::from_str(&first).ok()?;
    (header["type"] == "session").then(|| header["cwd"].as_str().map(str::to_string))?
}

/// `path` in one spelling for comparing: lowercase, with `\` separators and no trailing one.
fn comparable_path(path: &str) -> String {
    let path = path.replace('/', "\\").to_lowercase();
    match path.trim_end_matches('\\') {
        // A drive root such as `e:\` keeps its separator
        trimmed if trimmed.ends_with(':') => format!("{}\\", trimmed),
        trimmed => trimmed.to_string(),
    }
}

/// The session files PiG wrote for `worktree`. Folder names and working directories are
/// compared case-insensitively, as for Claude Code.
fn pig_session_files(sessions: &PigSessions, worktree: &str) -> Vec<PathBuf> {
    match sessions {
        PigSessions::PerDirectory(dir) => {
            let want = pig_session_dir_name(worktree).to_lowercase();
            fs::read_dir(dir)
                .ok()
                .and_then(|entries| {
                    entries
                        .flatten()
                        .find(|e| e.file_name().to_string_lossy().to_lowercase() == want)
                        .map(|e| jsonl_files(&e.path()))
                })
                .unwrap_or_default()
        }
        // The folder holds every working directory's sessions, and each names its own
        PigSessions::Shared(dir) => {
            let want = comparable_path(worktree);
            jsonl_files(dir)
                .into_iter()
                .filter(|file| pig_session_cwd(file).is_some_and(|cwd| comparable_path(&cwd) == want))
                .collect()
        }
    }
}

/// The dollars and responses in PiG session `files`: the sum of `usage.cost.total` over
/// assistant messages, and how many assistant messages carry `usage`. An entry that a forked
/// session copied from its parent, with the same id and time, counts once. A line that
/// isn't JSON is skipped.
fn pig_files_spend(files: &[PathBuf]) -> (f64, u64) {
    let mut seen = std::collections::HashSet::new();
    let mut usd = 0.0;
    let mut responses = 0;
    for file in files {
        let Ok(text) = fs::read_to_string(file) else {
            continue;
        };
        for line in text.lines() {
            let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            let message = &entry["message"];
            if entry["type"] != "message" || message["role"] != "assistant" || !message["usage"].is_object() {
                continue;
            }
            let key = (entry["id"].to_string(), entry["timestamp"].to_string());
            if entry["id"].is_string() && !seen.insert(key) {
                continue;
            }
            responses += 1;
            usd += message["usage"]["cost"]["total"].as_f64().unwrap_or(0.0);
        }
    }
    (usd, responses)
}

/// Spend of the PiG sessions run in `worktree`, from PiG's own cost figures.
fn measure_pig(sessions: &PigSessions, worktree: &str) -> SpendSnapshot {
    let files = pig_session_files(sessions, worktree);
    if files.is_empty() {
        return SpendSnapshot {
            measured: true,
            usd: 0.0,
            responses: 0,
            note: "No PiG sessions for this worktree yet.".to_string(),
        };
    }
    let (usd, responses) = pig_files_spend(&files);
    SpendSnapshot {
        measured: true,
        usd,
        responses,
        note: format!(
            "Priced from {} PiG session file(s) for this worktree, using PiG's own cost figures.",
            files.len()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_claude_code() {
        assert_eq!(claude_project_dir_name(r"E:\Projects\Quay2"), "E--Projects-Quay2");
        assert_eq!(
            claude_project_dir_name(r"E:\Projects\Quay2\.machina\worktrees\WO-1"),
            "E--Projects-Quay2--machina-worktrees-WO-1"
        );
    }

    #[test]
    fn other_agents_are_unmeasured() {
        let s = measure("codex", r"E:\x");
        assert!(!s.measured);
        assert_eq!(s.usd, 0.0);
    }

    #[test]
    fn encodes_like_pig() {
        assert_eq!(pig_session_dir_name(r"C:\repos\Quay-2"), "--C--repos-Quay-2--");
        assert_eq!(pig_session_dir_name(r"E:\"), "--E----");
        assert_eq!(
            pig_session_dir_name(r"E:\Projects\Quay2\.machina\worktrees\WO-1"),
            "--E--Projects-Quay2-.machina-worktrees-WO-1--"
        );
        assert_eq!(pig_session_dir_name("/tmp/foo"), "--tmp-foo--");
        assert_eq!(pig_session_dir_name("//srv/share"), "---srv-share--");
        assert_eq!(pig_session_dir_name(""), "----");
    }

    /// The folder PiG runs in, for the tests that don't care.
    const CWD: &str = r"E:\work";

    fn vars<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| value.to_string())
    }

    #[test]
    fn pig_sessions_follow_pigs_own_precedence() {
        let home = Path::new(r"C:\Users\someone");
        let per_dir = |dir: &str| Some(PigSessions::PerDirectory(PathBuf::from(dir)));
        assert_eq!(pig_sessions(vars(&[]), Some(home), Path::new(CWD)), per_dir(r"C:\Users\someone\.pig\agent\sessions"));
        assert_eq!(
            pig_sessions(vars(&[("XDG_CONFIG_HOME", r"D:\xdg")]), Some(home), Path::new(CWD)),
            per_dir(r"D:\xdg\pig\agent\sessions")
        );
        assert_eq!(
            pig_sessions(vars(&[("XDG_CONFIG_HOME", r"D:\xdg"), ("PIG_HOME", r"D:\pig")]), Some(home), Path::new(CWD)),
            per_dir(r"D:\pig\agent\sessions")
        );
        assert_eq!(
            pig_sessions(vars(&[("PIG_HOME", r"D:\pig"), ("PIG_CODING_AGENT_DIR", r"D:\agent")]), Some(home), Path::new(CWD)),
            per_dir(r"D:\agent\sessions")
        );
        assert_eq!(
            pig_sessions(
                vars(&[("PIG_CODING_AGENT_DIR", r"D:\agent"), ("PIG_CODING_AGENT_SESSION_DIR", "~/s")]),
                Some(home),
                Path::new(CWD)
            ),
            Some(PigSessions::Shared(home.join("s")))
        );
    }

    #[test]
    fn an_empty_pig_variable_counts_as_unset_and_a_missing_home_is_reported() {
        let home = Path::new(r"C:\Users\someone");
        assert_eq!(
            pig_sessions(vars(&[("PIG_CODING_AGENT_SESSION_DIR", ""), ("PIG_HOME", "")]), Some(home), Path::new(CWD)),
            Some(PigSessions::PerDirectory(home.join(".pig").join("agent").join("sessions")))
        );
        assert_eq!(pig_sessions(vars(&[]), None, Path::new(CWD)), None);
        assert_eq!(pig_sessions(vars(&[("PIG_HOME", "~")]), None, Path::new(CWD)), None);
        assert_eq!(
            pig_sessions(vars(&[("PIG_HOME", r"D:\pig")]), None, Path::new(CWD)),
            Some(PigSessions::PerDirectory(PathBuf::from(r"D:\pig\agent\sessions")))
        );
    }

    #[test]
    fn a_relative_pig_folder_is_taken_from_the_folder_pig_runs_in() {
        let home = Path::new(r"C:\Users\someone");
        assert_eq!(
            pig_sessions(vars(&[("PIG_CODING_AGENT_SESSION_DIR", ".sessions")]), Some(home), Path::new(CWD)),
            Some(PigSessions::Shared(Path::new(CWD).join(".sessions")))
        );
        assert_eq!(
            pig_sessions(vars(&[("PIG_HOME", "pig-home")]), Some(home), Path::new(CWD)),
            Some(PigSessions::PerDirectory(Path::new(CWD).join("pig-home").join("agent").join("sessions")))
        );
    }

    #[test]
    fn paths_compare_in_any_case_and_with_either_separator() {
        assert_eq!(comparable_path(r"E:\Work\WO-7\"), comparable_path("e:/work/wo-7"));
        assert_eq!(comparable_path(r"E:\"), r"e:\");
        assert_ne!(comparable_path(r"E:\a-b"), comparable_path(r"E:\a\b"));
    }

    /// A fresh temp folder named for `tag`, removed when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("quay-pig-spend-{}-{}", tag, std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const WORKTREE: &str = r"E:\Projects\Quay2\.machina\worktrees\WO-7";

    /// A PiG session file's lines: the header for `cwd`, then an assistant message costing
    /// each of `costs`, with a user message and a message without usage between them. Each
    /// assistant message has an id and time of its own, as PiG's do.
    fn session(cwd: &str, costs: &[f64]) -> String {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let mut lines = vec![
            serde_json::json!({"type": "session", "version": 3, "id": "s", "cwd": cwd}).to_string(),
            r#"{"type":"model_change","id":"a","provider":"anthropic","modelId":"claude-sonnet-5-5"}"#.to_string(),
        ];
        for cost in costs {
            lines.push(r#"{"type":"message","id":"u","message":{"role":"user","content":"hi"}}"#.to_string());
            lines.push(
                serde_json::json!({"type": "message",
                    "id": format!("m{}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)),
                    "timestamp": "2026-10-21T22:55:49Z", "message": {"role": "assistant",
                    "usage": {"input": 2, "output": 4, "totalTokens": 6,
                        "cost": {"input": 0.0, "output": 0.0, "cacheRead": 0.0, "cacheWrite": 0.0, "total": cost}}}})
                .to_string(),
            );
        }
        lines.push(r#"{"type":"message","id":"n","message":{"role":"assistant","content":[]}}"#.to_string());
        lines.join("\n") + "\n"
    }

    #[test]
    fn pig_spend_sums_its_own_costs_over_every_session_of_the_worktree() {
        let tmp = TempDir::new("sums");
        let sessions = tmp.0.join("sessions");
        // PiG's folder name, in another case than Quay's spelling of the worktree
        let mine = sessions.join(pig_session_dir_name(WORKTREE).to_uppercase());
        let other = sessions.join(pig_session_dir_name(r"E:\Projects\Elsewhere"));
        fs::create_dir_all(&mine).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(mine.join("1.jsonl"), session(WORKTREE, &[0.25, 0.5])).unwrap();
        fs::write(mine.join("2.jsonl"), session(WORKTREE, &[1.0])).unwrap();
        fs::write(mine.join("notes.txt"), session(WORKTREE, &[9.0])).unwrap();
        fs::write(other.join("1.jsonl"), session(r"E:\Projects\Elsewhere", &[9.0])).unwrap();

        let s = measure_pig(&PigSessions::PerDirectory(sessions), WORKTREE);
        assert!(s.measured);
        assert!((s.usd - 1.75).abs() < 1e-9, "{}", s.usd);
        assert_eq!(s.responses, 3);
        assert_eq!(
            s.note,
            "Priced from 2 PiG session file(s) for this worktree, using PiG's own cost figures."
        );
    }

    #[test]
    fn a_shared_pig_session_folder_is_read_by_each_sessions_cwd() {
        let tmp = TempDir::new("shared");
        fs::write(tmp.0.join("1.jsonl"), session(&WORKTREE.to_lowercase(), &[0.5])).unwrap();
        fs::write(tmp.0.join("2.jsonl"), session(r"E:\Projects\Elsewhere", &[9.0])).unwrap();
        fs::write(tmp.0.join("3.jsonl"), "not a header\n").unwrap();
        // Encodes to the same folder name as the worktree, but is another folder
        fs::write(tmp.0.join("4.jsonl"), session(&WORKTREE.replace(r"\WO-7", "-WO-7"), &[9.0])).unwrap();

        let s = measure_pig(&PigSessions::Shared(tmp.0.clone()), WORKTREE);
        assert!((s.usd - 0.5).abs() < 1e-9, "{}", s.usd);
        assert_eq!(s.responses, 1);
        assert!(s.note.starts_with("Priced from 1 PiG session file(s)"), "{}", s.note);
    }

    #[test]
    fn without_pig_sessions_for_the_worktree_spend_is_measured_as_none_yet() {
        let tmp = TempDir::new("missing");
        for sessions in [
            PigSessions::PerDirectory(tmp.0.join("sessions")),
            PigSessions::PerDirectory(tmp.0.join("no-such-folder")),
            PigSessions::Shared(tmp.0.join("no-such-folder")),
        ] {
            let s = measure_pig(&sessions, WORKTREE);
            assert!(s.measured, "{:?}", sessions);
            assert_eq!(s.usd, 0.0);
            assert_eq!(s.responses, 0);
            assert_eq!(s.note, "No PiG sessions for this worktree yet.");
        }
    }

    #[test]
    fn a_response_a_forked_session_copied_counts_once() {
        let tmp = TempDir::new("fork");
        let dir = tmp.0.join(pig_session_dir_name(WORKTREE));
        fs::create_dir_all(&dir).unwrap();
        let parent = session(WORKTREE, &[0.5]);
        fs::write(dir.join("1.jsonl"), &parent).unwrap();
        let fork = parent.clone() + &session(WORKTREE, &[0.25]);
        fs::write(dir.join("2.jsonl"), fork).unwrap();

        let (usd, responses) = pig_files_spend(&jsonl_files(&dir));
        assert!((usd - 0.75).abs() < 1e-9, "{}", usd);
        assert_eq!(responses, 2);
    }

    #[test]
    fn a_malformed_pig_session_line_is_skipped() {
        let tmp = TempDir::new("malformed");
        let dir = tmp.0.join(pig_session_dir_name(WORKTREE));
        fs::create_dir_all(&dir).unwrap();
        let text = session(WORKTREE, &[0.5]) + "{\"type\":\"message\",\"message\":{\"role\":\"assist\n" + &session(WORKTREE, &[0.25]);
        fs::write(dir.join("1.jsonl"), text).unwrap();

        let s = measure_pig(&PigSessions::PerDirectory(tmp.0.clone()), WORKTREE);
        assert!((s.usd - 0.75).abs() < 1e-9, "{}", s.usd);
        assert_eq!(s.responses, 2);
    }

    /// The agents the work-order composer lists in `SPEND_MEASURED_AGENTS`, read from
    /// `format.ts`.
    fn composer_measured_agents() -> Vec<String> {
        let source_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/slices/machina/format.ts");
        let source = fs::read_to_string(&source_path).unwrap();
        source
            .lines()
            .find_map(|line| line.trim().strip_prefix("export const SPEND_MEASURED_AGENTS: RunKind[] = ["))
            .expect("format.ts declares SPEND_MEASURED_AGENTS on one line")
            .split(']')
            .next()
            .unwrap()
            .split(',')
            .map(|item| item.trim().trim_matches('"').to_string())
            .filter(|item| !item.is_empty())
            .collect()
    }

    #[test]
    fn the_composer_warns_for_exactly_the_agents_spend_cannot_price() {
        let tmp = TempDir::new("composer");
        let cwd = tmp.0.to_string_lossy().to_string();
        let measured: Vec<String> = crate::slices::pty::models::ALL_RUN_KINDS
            .iter()
            .map(|kind| kind.as_str().to_string())
            .filter(|kind| measure(kind, &cwd).measured)
            .collect();
        assert_eq!(measured, ["claude", "pig"]);
        assert_eq!(composer_measured_agents(), measured);
    }

    /// Runs the real PiG once in a fresh folder, with PiG's own session settings, and prices
    /// the session it saved, which the test then removes. Needs PiG installed and signed in
    /// with `pig login`. Run with `cargo test live_pig_spend -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_pig_spend() {
        let tmp = TempDir::new("live");
        let cwd = tmp.0.to_string_lossy().to_string();
        let out = std::process::Command::new("pig")
            .args(["-p", "Reply with OK"])
            .current_dir(&tmp.0)
            .output()
            .expect("run pig");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

        let s = measure("pig", &cwd);
        println!("{:?}", s);
        let home = get_home_dir().ok();
        if let Some(PigSessions::PerDirectory(sessions)) =
            pig_sessions(|name| std::env::var(name).ok(), home.as_deref(), &tmp.0)
        {
            let _ = fs::remove_dir_all(sessions.join(pig_session_dir_name(&cwd)));
        }
        assert!(s.measured);
        assert_eq!(s.responses, 1);
        assert!(s.usd > 0.0, "PiG filled in no cost: {:?}", s);
        assert!(s.note.starts_with("Priced from 1 PiG session file(s)"), "{}", s.note);
    }
}
