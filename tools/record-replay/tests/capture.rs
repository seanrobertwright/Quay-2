//! What a capture script controls in a replay, through files in `QUAY_REPLAY_STATE`: the step
//! markers each replay has reached, the marker every replay holds at, and the replay speed.

// The tool stands in for Windows agent CLIs under ConPTY, so these tests run on Windows.
#![cfg(windows)]

mod common;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::*;

const WAIT: Duration = Duration::from_secs(30);

/// Writes recording `name` into `dir` with the given cast events and no bridge calls.
fn write_recording(dir: &Path, name: &str, events: &[(f64, &str, &str)]) {
    let gzip = |file: &str, text: &str| {
        let out = std::fs::File::create(dir.join(file)).unwrap();
        let mut gz = flate2::write::GzEncoder::new(out, flate2::Compression::default());
        gz.write_all(text.as_bytes()).unwrap();
        gz.finish().unwrap();
    };
    let mut cast = String::from("{\"version\":2,\"width\":100,\"height\":30}\n");
    for (t, code, data) in events {
        cast.push_str(&serde_json::json!([t, code, data]).to_string());
        cast.push('\n');
    }
    gzip(&format!("{name}.cast.gz"), &cast);
    gzip(&format!("{name}.http.jsonl.gz"), "");
}

struct Capture {
    scratch: Scratch,
    recordings: PathBuf,
    state: PathBuf,
}

impl Capture {
    fn new(name: &str) -> Self {
        let scratch = Scratch::new(name);
        let recordings = scratch.dir("tools/record-replay/recordings/demo");
        let state = scratch.dir("replay-state");
        Capture { scratch, recordings, state }
    }

    /// Writes one of the files the capture script shares with every replay.
    fn set(&self, file: &str, value: &str) {
        std::fs::write(self.state.join(file), value).unwrap();
    }

    fn replay(&self) -> Terminal {
        let tool = self.scratch.install(TOOL, "fake-cli", "claude");
        let env = [
            ("PATH", fixture_path(&[&tool])),
            ("QUAY_REPLAY_DIR", self.recordings.display().to_string()),
            ("QUAY_REPLAY_STATE", self.state.display().to_string()),
        ];
        Terminal::open("claude.exe", &[], &env, &self.scratch.dir("project"), 100, 30)
    }

    fn reached(&self) -> String {
        std::fs::read_to_string(self.state.join("claude-1.markers")).unwrap_or_default()
    }
}

#[test]
fn a_replay_lists_each_step_marker_it_reaches() {
    let capture = Capture::new("capture-reached");
    write_recording(
        &capture.recordings,
        "claude-1",
        &[(0.1, "o", "one\r\n"), (0.2, "m", "01-first"), (0.3, "o", "two\r\n"), (0.4, "m", "02-second"), (0.5, "x", "0")],
    );

    let mut terminal = capture.replay();

    assert_eq!(terminal.wait_exit(WAIT), 0);
    assert_eq!(capture.reached(), "01-first\n02-second\n");
}

#[test]
fn a_replay_holds_at_the_run_to_marker_until_it_names_a_later_step() {
    let capture = Capture::new("capture-hold");
    write_recording(
        &capture.recordings,
        "claude-1",
        &[
            (0.1, "o", "before\r\n"),
            (0.2, "m", "01-first"),
            (0.3, "o", "middle\r\n"),
            (0.4, "m", "02-second"),
            (2.4, "o", "after\r\n"),
            (2.5, "x", "0"),
        ],
    );
    capture.set("run-to", "02-second");

    let mut terminal = capture.replay();
    terminal.wait_for_text("middle", WAIT);
    std::thread::sleep(Duration::from_secs(3));

    assert!(!terminal.text().contains("after"), "it holds at 02-second: {}", terminal.text());
    assert_eq!(terminal.exited(), None);
    assert_eq!(capture.reached(), "01-first\n02-second\n", "it passed 01-first and reached 02-second");

    let released = Instant::now();
    capture.set("run-to", "03-next");
    terminal.wait_for_text("after", WAIT);
    let after = released.elapsed();
    assert_eq!(terminal.wait_exit(WAIT), 0);
    // What follows the marker keeps its recorded pace from the release, not from the start.
    assert!(after > Duration::from_millis(1500), "\"after\" came {after:?} after the release, recorded 2 s after the marker");
}

#[test]
fn a_replay_with_no_run_to_file_holds_nowhere() {
    let capture = Capture::new("capture-no-hold");
    write_recording(&capture.recordings, "claude-1", &[(0.1, "m", "01-first"), (0.2, "o", "done\r\n"), (0.3, "x", "0")]);

    let mut terminal = capture.replay();

    assert_eq!(terminal.wait_exit(WAIT), 0);
    assert!(terminal.text().contains("done"), "{}", terminal.text());
}

#[test]
fn a_replay_follows_the_speed_the_capture_sets_while_it_plays() {
    let capture = Capture::new("capture-speed");
    write_recording(&capture.recordings, "claude-1", &[(0.1, "o", "start\r\n"), (20.0, "o", "end\r\n"), (20.1, "x", "0")]);

    let mut terminal = capture.replay();
    terminal.wait_for_text("start", WAIT);
    // With no speed file it plays in real time; then the capture speeds it up mid-run.
    std::thread::sleep(Duration::from_millis(500));
    let sped_up = Instant::now();
    capture.set("speed", "40");

    assert_eq!(terminal.wait_exit(WAIT), 0);
    assert!(sped_up.elapsed() < Duration::from_secs(3), "20 s at 40x took {:?}", sped_up.elapsed());
    assert!(terminal.text().contains("end"), "{}", terminal.text());
}
