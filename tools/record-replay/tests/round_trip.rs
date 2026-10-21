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
    text: String,
    exit_code: u32,
}

/// Records the stub agent, impersonating `cli`, into `recordings`: Quay opens the terminal,
/// and after `pause` types the prompt into it.
fn record(scratch: &Scratch, recordings: &Path, cli: &str, pause: Duration) -> Run {
    let tool = scratch.install(TOOL, &format!("record-{cli}/tool"), cli);
    let real = scratch.install(STUB, &format!("record-{cli}/real-cli"), cli);
    let bridge = FakeBridge::start();
    let mut env = vec![
        ("PATH", fixture_path(&[&tool, &real])),
        ("QUAY_RECORD_DIR", recordings.display().to_string()),
    ];
    env.extend(bridge_env(&bridge, &RECORDED));
    run_terminal(&format!("{cli}.exe"), &claude_args(&bridge), &env, &scratch.dir("project"), &bridge, pause)
}

/// Replays the next recording for `cli` from `recordings`, with only the tool on PATH.
fn replay(scratch: &Scratch, recordings: &Path, state: &Path, cli: &str, pause: Duration) -> Run {
    let tool = scratch.install(TOOL, &format!("replay-{cli}"), cli);
    let bridge = FakeBridge::start();
    let mut env = vec![
        ("PATH", fixture_path(&[&tool])),
        ("QUAY_REPLAY_DIR", recordings.display().to_string()),
        ("QUAY_REPLAY_STATE", state.display().to_string()),
    ];
    env.extend(bridge_env(&bridge, &LIVE));
    run_terminal(&format!("{cli}.exe"), &claude_args(&bridge), &env, &scratch.dir("project"), &bridge, pause)
}

fn run_terminal(
    program: &str,
    args: &[String],
    env: &[(&str, String)],
    cwd: &Path,
    bridge: &FakeBridge,
    pause: Duration,
) -> Run {
    let mut terminal = Terminal::open(program, args, env, cwd, 100, 30);
    terminal.wait_for_text("stub-agent: waiting for a prompt", WAIT);
    std::thread::sleep(pause);
    let prompted = Instant::now();
    terminal.type_text(&format!("{PROMPT}\r"));
    let exit_code = terminal.wait_exit(WAIT);
    Run { calls: bridge.received(), opened: terminal.started, prompted, text: terminal.text(), exit_code }
}

fn recordings_dir(scratch: &Scratch) -> (PathBuf, PathBuf) {
    (scratch.dir("tools/record-replay/recordings/demo"), scratch.dir("replay-state"))
}

#[test]
fn a_replay_shows_what_the_recorded_cli_showed_without_the_cli() {
    let scratch = Scratch::new("round-trip-output");
    let (recordings, state) = recordings_dir(&scratch);
    let recorded = record(&scratch, &recordings, "claude", Duration::ZERO);

    let replayed = replay(&scratch, &recordings, &state, "claude", Duration::ZERO);

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
    let recorded = record(&scratch, &recordings, "claude", Duration::ZERO);

    let replayed = replay(&scratch, &recordings, &state, "claude", Duration::ZERO);

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
