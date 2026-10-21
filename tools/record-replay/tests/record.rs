//! Record mode, driven the way Quay drives an agent CLI: the tool is first on the fixture's
//! PATH as `claude.exe`, and the real CLI (here the stub agent) is further along it.

// The tool stands in for Windows agent CLIs under ConPTY, so these tests run on Windows.
#![cfg(windows)]

mod common;

use std::time::Duration;

use common::*;

const WAIT: Duration = Duration::from_secs(20);

#[test]
fn the_real_cli_runs_as_it_would_without_the_recorder() {
    let scratch = Scratch::new("transparent");
    let tool = scratch.install(TOOL, "tool", "claude");
    let real = scratch.install(STUB, "real-cli", "claude");
    let recordings = scratch.dir("recordings/demo");
    let project = scratch.dir("project");

    let mut terminal = Terminal::open(
        "claude.exe",
        &[],
        &[
            ("PATH", fixture_path(&[&tool, &real])),
            ("QUAY_RECORD_DIR", recordings.display().to_string()),
        ],
        &project,
        100,
        30,
    );
    terminal.wait_for_text("stub-agent: waiting for a prompt", WAIT);
    terminal.type_text("add a health route\r");

    assert_eq!(terminal.wait_exit(WAIT), 7, "the CLI's exit code passes through");
    let text = terminal.text();
    assert!(text.contains("stub-agent: hello from the real CLI"), "{text}");
    assert!(text.contains("stub-agent: size 100x30"), "the CLI sees the terminal's size: {text}");
    assert!(text.contains("stub-agent: answered add a health route"), "typed input reaches the CLI: {text}");
}

#[test]
fn the_terminal_is_recorded_as_a_gzipped_asciicast_with_its_size() {
    let scratch = Scratch::new("asciicast");
    let tool = scratch.install(TOOL, "tool", "claude");
    let real = scratch.install(STUB, "real-cli", "claude");
    let recordings = scratch.dir("recordings/demo");
    let project = scratch.dir("project");

    let mut terminal = Terminal::open(
        "claude.exe",
        &[],
        &[
            ("PATH", fixture_path(&[&tool, &real])),
            ("QUAY_RECORD_DIR", recordings.display().to_string()),
        ],
        &project,
        120,
        40,
    );
    terminal.wait_for_text("stub-agent: waiting for a prompt", WAIT);
    terminal.type_text("add a health route\r");
    terminal.wait_exit(WAIT);

    let cast = gunzip(&recordings.join("claude-1.cast.gz"));
    let mut lines = cast.lines();
    let header: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    assert_eq!(header["version"], 2);
    assert_eq!(header["width"], 120);
    assert_eq!(header["height"], 40);

    let events: Vec<serde_json::Value> = lines.map(|l| serde_json::from_str(l).unwrap()).collect();
    let mut last = 0.0;
    for event in &events {
        let t = event[0].as_f64().unwrap();
        assert!(t >= last, "event times never go back: {event}");
        last = t;
    }
    let stream = |code: &str| -> String {
        events.iter().filter(|e| e[1] == code).map(|e| e[2].as_str().unwrap().to_string()).collect()
    };
    let output = strip_ansi(&stream("o"));
    assert!(output.contains("stub-agent: hello from the real CLI"), "{output}");
    assert!(output.contains("stub-agent: answered add a health route"), "{output}");
    assert!(stream("i").contains("add a health route\r"), "keystrokes are recorded as input: {:?}", stream("i"));
}

const TOKEN: &str = "live-token-0123456789abcdef0123456789abcdef0123456789abcdef01234";
const TAG: &str = "term-0123456789abcdef0123456789abcdef";

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

#[test]
fn bridge_calls_pass_through_and_are_logged_without_the_token() {
    let scratch = Scratch::new("bridge");
    let tool = scratch.install(TOOL, "tool", "claude");
    let real = scratch.install(STUB, "real-cli", "claude");
    let recordings = scratch.dir("recordings/demo");
    let project = scratch.dir("project");
    let bridge = FakeBridge::start();

    let mut terminal = Terminal::open(
        "claude.exe",
        &["--dangerously-skip-permissions".into(), "--mcp-config".into(), bridge.mcp_config()],
        &[
            ("PATH", fixture_path(&[&tool, &real])),
            ("QUAY_RECORD_DIR", recordings.display().to_string()),
            ("CLAUDE_EVENTS_URL", bridge.url()),
            ("CLAUDE_EVENTS_TOKEN", TOKEN.into()),
            ("CLAUDE_EVENTS_TAG", TAG.into()),
        ],
        &project,
        100,
        30,
    );
    terminal.wait_for_text("stub-agent: waiting for a prompt", WAIT);
    terminal.type_text("add a health route\r");
    terminal.wait_exit(WAIT);

    // The live bridge saw the CLI's calls as the CLI made them.
    let received = bridge.received();
    assert_eq!(received.iter().map(Received::what).collect::<Vec<_>>(), STUB_CALLS);
    for call in &received {
        assert_eq!(call.header("authorization"), Some(format!("Bearer {TOKEN}").as_str()), "{call:?}");
    }
    for event in received.iter().filter(|r| r.path == "/v1/events") {
        assert_eq!(event.json()["events"][0]["tag"], TAG);
    }
    // ...and the CLI saw the bridge's answers.
    let unwrapped = terminal.text().replace(['\r', '\n'], "");
    let answer = format!("quay_list_agents -> 200 {{\"id\":2,\"jsonrpc\":\"2.0\",\"result\":{{\"caller\":\"Bearer {TOKEN}\"}}}}");
    assert!(unwrapped.contains(&answer), "{unwrapped}");

    assert_eq!(file_names(&recordings), ["claude-1.cast.gz", "claude-1.http.jsonl.gz"]);
    let log = gunzip(&recordings.join("claude-1.http.jsonl.gz"));
    let entries: Vec<serde_json::Value> = log.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(entries.len(), STUB_CALLS.len());
    let mut last = 0.0;
    for (entry, call) in entries.iter().zip(&received) {
        assert_eq!(entry["method"], "POST");
        assert_eq!(entry["path"], call.path);
        assert_eq!(entry["status"], 200);
        let t = entry["t"].as_f64().unwrap();
        assert!(t >= last && t < 20.0, "offsets are seconds into the run, in order: {entry}");
        last = t;
    }
    assert_eq!(entries[0]["body"]["events"][0]["type"], "session.started");
    for file in ["claude-1.cast.gz", "claude-1.http.jsonl.gz"] {
        let text = gunzip(&recordings.join(file));
        assert!(!text.contains(TOKEN), "{file} holds the token");
        assert!(!text.to_ascii_lowercase().contains("authorization"), "{file} holds an auth header");
        assert!(!text.contains(TAG), "{file} holds the recorded terminal's id");
    }
}

fn mark(recordings: &std::path::Path, name: &str) -> std::process::Output {
    std::process::Command::new(TOOL).arg("mark").arg(recordings).arg(name).output().unwrap()
}

#[test]
fn step_markers_land_in_every_recording_at_the_moment_they_are_made() {
    let scratch = Scratch::new("markers");
    let tool = scratch.install(TOOL, "tool", "claude");
    let real = scratch.install(STUB, "real-cli", "claude");
    let recordings = scratch.dir("recordings/demo");
    let project = scratch.dir("project");

    // A marker made before the terminal starts is the step the terminal starts in.
    assert!(mark(&recordings, "01-open-project").status.success());
    let mut terminal = Terminal::open(
        "claude.exe",
        &[],
        &[
            ("PATH", fixture_path(&[&tool, &real])),
            ("QUAY_RECORD_DIR", recordings.display().to_string()),
        ],
        &project,
        100,
        30,
    );
    terminal.wait_for_text("stub-agent: waiting for a prompt", WAIT);
    std::thread::sleep(Duration::from_millis(300));
    assert!(mark(&recordings, "02-send-prompt").status.success());
    std::thread::sleep(Duration::from_millis(500));
    terminal.type_text("add a health route\r");
    terminal.wait_exit(WAIT);

    let cast = gunzip(&recordings.join("claude-1.cast.gz"));
    let events: Vec<serde_json::Value> = cast.lines().skip(1).map(|l| serde_json::from_str(l).unwrap()).collect();
    let markers: Vec<(f64, &str)> =
        events.iter().filter(|e| e[1] == "m").map(|e| (e[0].as_f64().unwrap(), e[2].as_str().unwrap())).collect();
    assert_eq!(markers.iter().map(|m| m.1).collect::<Vec<_>>(), ["01-open-project", "02-send-prompt"]);
    assert!(markers[0].0 < 0.5, "the step the terminal started in is marked at its start: {markers:?}");
    let typed = events.iter().find(|e| e[1] == "i" && e[2].as_str().unwrap().contains("add")).unwrap();
    assert!(markers[1].0 > 0.3 && markers[1].0 < typed[0].as_f64().unwrap(), "{markers:?} then {typed}");
}

#[test]
fn a_step_marker_must_be_named_nn_what() {
    let scratch = Scratch::new("bad-marker");
    let recordings = scratch.dir("recordings/demo");
    for bad in ["2-send", "02_send", "02-Send", "02-", "send"] {
        let out = mark(&recordings, bad);
        assert_eq!(out.status.code(), Some(2), "{bad} was accepted");
        assert!(String::from_utf8_lossy(&out.stderr).contains("NN-<what>"), "{bad}: {out:?}");
    }
    assert!(mark(&recordings, "10-reply-quoted").status.success());
}
