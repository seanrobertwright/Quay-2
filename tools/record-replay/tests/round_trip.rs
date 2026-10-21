//! The round trip: record a stub agent's run in a terminal, then replay the recording in a new
//! terminal, with no agent CLI on PATH, against a new bridge, and compare.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::*;

const WAIT: Duration = Duration::from_secs(30);
const PROMPT: &str = "add a health route";

/// A terminal's identity on the bridge, as Quay hands it to the CLI.
struct Identity {
    token: &'static str,
    tag: &'static str,
}

const RECORDED: Identity = Identity {
    token: "recorded-token-0123456789abcdef0123456789abcdef0123456789abcdef",
    tag: "term-11111111111111111111111111111111",
};
const LIVE: Identity = Identity {
    token: "live-token-fedcba9876543210fedcba9876543210fedcba9876543210fedcb",
    tag: "term-22222222222222222222222222222222",
};

fn bridge_env(bridge: &FakeBridge, who: &Identity) -> Vec<(&'static str, String)> {
    vec![
        ("CLAUDE_EVENTS_URL", bridge.url()),
        ("CLAUDE_EVENTS_TOKEN", who.token.into()),
        ("CLAUDE_EVENTS_TAG", who.tag.into()),
    ]
}

fn claude_args(bridge: &FakeBridge) -> Vec<String> {
    vec!["--dangerously-skip-permissions".into(), "--mcp-config".into(), bridge.mcp_config()]
}

/// One terminal's run as the bridge and the terminal saw it.
struct Run {
    calls: Vec<Received>,
    /// When the terminal opened, and when the prompt was typed into it.
    opened: Instant,
    prompted: Instant,
    /// What the terminal showed just before the prompt was typed, and at the end.
    text_before_prompt: String,
    text: String,
    exit_code: u32,
}

/// A terminal the tutorial opens: the CLI Quay launches, the prompt typed into it, and how
/// long after the CLI asks for it.
#[derive(Clone, Copy)]
struct Session<'a> {
    cli: &'a str,
    prompt: &'a str,
    pause: Duration,
}

const CLAUDE: Session = Session { cli: "claude", prompt: PROMPT, pause: Duration::ZERO };

/// Records the stub agent, standing in for `session.cli`, into `recordings`.
fn record(scratch: &Scratch, recordings: &Path, session: &Session) -> Run {
    let tool = scratch.install(TOOL, &format!("record-{}/tool", session.cli), session.cli);
    let real = scratch.install(STUB, &format!("record-{}/real-cli", session.cli), session.cli);
    let env = vec![
        ("PATH", fixture_path(&[&tool, &real])),
        ("QUAY_RECORD_DIR", recordings.display().to_string()),
    ];
    run_terminal(scratch, session, env, &RECORDED)
}

/// Replays the next recording for `session.cli` from `recordings`, with only the tool on PATH.
fn replay(scratch: &Scratch, recordings: &Path, state: &Path, session: &Session) -> Run {
    let tool = scratch.install(TOOL, &format!("replay-{}", session.cli), session.cli);
    let env = vec![
        ("PATH", fixture_path(&[&tool])),
        ("QUAY_REPLAY_DIR", recordings.display().to_string()),
        ("QUAY_REPLAY_STATE", state.display().to_string()),
    ];
    run_terminal(scratch, session, env, &LIVE)
}

/// Opens the terminal as Quay does, against a bridge of its own: a Claude terminal gets the
/// bridge's environment and MCP config, other CLIs get neither.
fn run_terminal(scratch: &Scratch, session: &Session, mut env: Vec<(&str, String)>, who: &Identity) -> Run {
    let bridge = FakeBridge::start();
    let mut args = Vec::new();
    if session.cli == "claude" {
        env.extend(bridge_env(&bridge, who));
        args = claude_args(&bridge);
    }
    let program = format!("{}.exe", session.cli);
    let mut terminal = Terminal::open(&program, &args, &env, &scratch.dir("project"), 100, 30);
    terminal.wait_for_text("stub-agent: waiting for a prompt", WAIT);
    std::thread::sleep(session.pause);
    let text_before_prompt = terminal.text();
    let prompted = Instant::now();
    terminal.type_text(&format!("{}\r", session.prompt));
    let exit_code = terminal.wait_exit(WAIT);
    Run { calls: bridge.received(), opened: terminal.started, prompted, text_before_prompt, text: terminal.text(), exit_code }
}

fn recordings_dir(scratch: &Scratch) -> (PathBuf, PathBuf) {
    (scratch.dir("tools/record-replay/recordings/demo"), scratch.dir("replay-state"))
}

#[test]
fn a_replay_shows_what_the_recorded_cli_showed_without_the_cli() {
    let scratch = Scratch::new("round-trip-output");
    let (recordings, state) = recordings_dir(&scratch);
    let recorded = record(&scratch, &recordings, &CLAUDE);

    let replayed = replay(&scratch, &recordings, &state, &CLAUDE);

    assert_eq!(replayed.exit_code, recorded.exit_code);
    for line in [
        "stub-agent: hello from the real CLI",
        "stub-agent: size 100x30",
        "stub-agent: waiting for a prompt",
        "stub-agent: answered add a health route",
    ] {
        assert!(recorded.text.contains(line), "the recording run showed {line:?}: {}", recorded.text);
        assert!(replayed.text.contains(line), "the replay shows {line:?}: {}", replayed.text);
    }
}

/// The stub's bridge calls, in order, as `Received::what` names them.
const STUB_CALLS: [&str; 7] = [
    "session.started",
    "initialize",
    "tools/call quay_list_agents",
    "turn.started",
    "tool.started",
    "tool.finished",
    "turn.completed",
];

fn whats(calls: &[Received]) -> Vec<String> {
    calls.iter().map(Received::what).collect()
}

/// A call's body with the terminal's id and event times taken out, which a replay changes.
fn comparable(call: &Received, tag: &str) -> serde_json::Value {
    let mut body: serde_json::Value = serde_json::from_str(&call.body.replace(tag, "<tag>")).unwrap();
    for event in body["events"].as_array_mut().into_iter().flatten() {
        event.as_object_mut().unwrap().remove("ts");
    }
    body
}

fn seconds_between(from: Instant, to: Instant) -> f64 {
    to.saturating_duration_since(from).as_secs_f64()
}

#[test]
fn a_replay_reissues_the_recorded_bridge_calls_as_the_live_terminal() {
    let scratch = Scratch::new("round-trip-bridge");
    let (recordings, state) = recordings_dir(&scratch);
    let recorded = record(&scratch, &recordings, &CLAUDE);

    let replayed = replay(&scratch, &recordings, &state, &CLAUDE);

    assert_eq!(whats(&recorded.calls), STUB_CALLS);
    assert_eq!(whats(&replayed.calls), STUB_CALLS, "the same calls, in the same order");
    for (was, now) in recorded.calls.iter().zip(&replayed.calls) {
        assert_eq!(now.path, was.path);
        assert_eq!(now.header("authorization"), Some(format!("Bearer {}", LIVE.token).as_str()), "the live token: {now:?}");
        assert_eq!(comparable(now, LIVE.tag), comparable(was, RECORDED.tag), "the recorded body");
        for event in now.json()["events"].as_array().into_iter().flatten() {
            assert_eq!(event["tag"], LIVE.tag, "every envelope carries the live terminal's id");
        }
    }
    // Each call goes out as far into the run as it was recorded.
    for (was, now) in recorded.calls.iter().zip(&replayed.calls) {
        let recorded_at = seconds_between(recorded.opened, was.at);
        let replayed_at = seconds_between(replayed.opened, now.at);
        assert!((recorded_at - replayed_at).abs() < 0.5, "{} at {recorded_at:.3}s, replayed at {replayed_at:.3}s", was.what());
    }
}

fn find<'a>(run: &'a Run, what: &str) -> &'a Received {
    run.calls.iter().find(|c| c.what() == what).unwrap_or_else(|| panic!("no {what} in {:?}", whats(&run.calls)))
}

#[test]
fn a_replayed_turn_starts_only_after_its_prompt_arrives() {
    let scratch = Scratch::new("round-trip-prompt");
    let (recordings, state) = recordings_dir(&scratch);
    let recorded = record(&scratch, &recordings, &CLAUDE);

    // Quay types the prompt two seconds later than it did when the run was recorded.
    let replayed = replay(&scratch, &recordings, &state, &Session { pause: Duration::from_secs(2), ..CLAUDE });

    assert!(!replayed.text_before_prompt.contains("stub-agent: answered"), "{}", replayed.text_before_prompt);
    assert!(replayed.text.contains("stub-agent: answered add a health route"), "{}", replayed.text);
    let started = find(&replayed, "turn.started");
    let completed = find(&replayed, "turn.completed");
    assert!(started.at > replayed.prompted, "turn.started went out before the prompt arrived");
    assert!(completed.at > started.at, "turn.completed went out before turn.started");
    // What followed the prompt keeps its recorded pace from the prompt.
    let after_prompt = ["turn.started", "tool.started", "tool.finished", "turn.completed"];
    for what in after_prompt {
        let recorded_at = seconds_between(recorded.prompted, find(&recorded, what).at);
        let replayed_at = seconds_between(replayed.prompted, find(&replayed, what).at);
        assert!((recorded_at - replayed_at).abs() < 0.5, "{what} {recorded_at:.3}s after the prompt, replayed {replayed_at:.3}s after");
    }
}

#[test]
fn a_replay_stands_in_for_the_cli_it_is_named_after_in_recorded_order() {
    let scratch = Scratch::new("round-trip-names");
    let (recordings, state) = recordings_dir(&scratch);
    let first = Session { prompt: "first claude", ..CLAUDE };
    let second = Session { prompt: "second claude", ..CLAUDE };
    let codex = Session { cli: "codex", prompt: "the codex one", ..CLAUDE };
    for session in [&first, &second, &codex] {
        record(&scratch, &recordings, session);
    }
    assert_eq!(
        file_names(&recordings),
        [
            "claude-1.cast.gz",
            "claude-1.http.jsonl.gz",
            "claude-2.cast.gz",
            "claude-2.http.jsonl.gz",
            "codex-1.cast.gz",
            "codex-1.http.jsonl.gz",
        ]
    );
    assert_eq!(gunzip(&recordings.join("codex-1.http.jsonl.gz")), "", "Quay gives Codex no bridge");

    // Copied as codex.exe it replays the Codex recording; as claude.exe, the Claude ones in order.
    let replayed = replay(&scratch, &recordings, &state, &codex);
    assert!(replayed.text.contains("hello from the real CLI (codex)"), "{}", replayed.text);
    assert!(replayed.text.contains("answered the codex one"), "{}", replayed.text);
    assert!(replayed.calls.is_empty());
    for session in [&first, &second] {
        let replayed = replay(&scratch, &recordings, &state, session);
        assert!(replayed.text.contains("hello from the real CLI (claude)"), "{}", replayed.text);
        assert!(replayed.text.contains(&format!("answered {}", session.prompt)), "{}", replayed.text);
        assert_eq!(whats(&replayed.calls), STUB_CALLS);
    }

    // A terminal with no recording left says so.
    let tool = scratch.install(TOOL, "replay-claude", "claude");
    let env = [
        ("PATH", fixture_path(&[&tool])),
        ("QUAY_REPLAY_DIR", recordings.display().to_string()),
        ("QUAY_REPLAY_STATE", state.display().to_string()),
    ];
    let mut terminal = Terminal::open("claude.exe", &[], &env, &scratch.dir("project"), 100, 30);
    assert_eq!(terminal.wait_exit(WAIT), 2);
    assert!(terminal.text().contains("no recording of claude left to replay"), "{}", terminal.text());
}
