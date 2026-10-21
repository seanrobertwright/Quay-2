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
