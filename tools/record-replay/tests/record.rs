//! Record mode, driven the way Quay drives an agent CLI: the tool is first on the fixture's
//! PATH as `claude.exe`, and the real CLI (here the stub agent) is further along it.

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
