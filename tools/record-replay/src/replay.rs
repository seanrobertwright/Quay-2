//! Replay mode: the fake CLI. Plays a recording into Quay's terminal at its recorded offsets.

use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::console;
use crate::recording::{self, CastEvent};

pub fn run(cli: &str, replay_dir: &Path, state_dir: &Path) -> Result<i32, String> {
    let recording = recording::claim_for_replay(replay_dir, state_dir, cli)?;
    let _raw = console::RawMode::enter();
    let start = Instant::now();
    let mut out = std::io::stdout();
    let mut exit_code = None;

    for CastEvent { t, code, data } in &recording.events {
        sleep_until(start + Duration::from_secs_f64(*t));
        match code.as_str() {
            "o" => {
                let _ = out.write_all(data.as_bytes());
                let _ = out.flush();
            }
            "x" => exit_code = data.trim().parse().ok(),
            _ => {}
        }
    }

    match exit_code {
        Some(code) => Ok(code),
        // The recorded CLI was still running when the run was cut, so the replay stays on its
        // last screen until Quay closes the terminal.
        None => loop {
            std::thread::sleep(Duration::from_secs(3600));
        },
    }
}

fn sleep_until(when: Instant) {
    let now = Instant::now();
    if when > now {
        std::thread::sleep(when - now);
    }
}
