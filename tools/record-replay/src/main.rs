//! The record and replay tool for tutorial screenshots. README.md beside this crate says how a
//! capture uses it.
//!
//! Copied onto a fixture's PATH under an agent CLI's name (`claude.exe`, `codex.exe`, ...), it
//! impersonates that CLI in whichever mode the environment selects:
//!
//! - `QUAY_RECORD_DIR=<folder>`: record. Runs the real CLI of the same name, found further
//!   along PATH, and records its terminal and its bridge calls into the folder.
//! - `QUAY_REPLAY_DIR=<folder>`: replay. Plays a recording from the folder back into the
//!   terminal and re-issues its bridge calls against the live bridge.
//!
//! Under its own name it takes subcommands; `quay-record-replay help` lists them.

mod console;
mod http;
mod record;
mod recording;
mod replay;

use std::path::PathBuf;

const OWN_NAME: &str = "quay-record-replay";

fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(message) => {
            eprintln!("{OWN_NAME}: {message}");
            2
        }
    };
    std::process::exit(code);
}

fn run() -> Result<i32, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot find its own exe: {e}"))?;
    let name = exe
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("its own exe has no file name")?
        .to_ascii_lowercase();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if name == OWN_NAME {
        return command(&args);
    }

    match (non_empty_env("QUAY_RECORD_DIR"), non_empty_env("QUAY_REPLAY_DIR")) {
        (Some(dir), None) => record::run(&name, &exe, &args, &PathBuf::from(dir)),
        (None, Some(dir)) => {
            let state = non_empty_env("QUAY_REPLAY_STATE")
                .ok_or("QUAY_REPLAY_STATE must name a folder, empty at the start of a capture, where replays claim their recordings")?;
            replay::run(&name, &PathBuf::from(dir), &PathBuf::from(state))
        }
        (Some(_), Some(_)) => Err("set QUAY_RECORD_DIR or QUAY_REPLAY_DIR, not both".into()),
        (None, None) => Err(format!(
            "this is the record and replay tool standing in for {name}; set QUAY_RECORD_DIR to record or QUAY_REPLAY_DIR to replay"
        )),
    }
}

const USAGE: &str = "usage:
  quay-record-replay mark <recordings folder> <NN-what>   mark a step in the recordings in progress
  quay-record-replay finish <recordings folder>          gzip runs Quay closed before their CLI exited";

/// The tool's own subcommands, for a capture script.
fn command(args: &[String]) -> Result<i32, String> {
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["mark", dir, name] => recording::mark(&PathBuf::from(dir), name).map(|_| 0),
        ["finish", dir] => {
            let finished = recording::finish(&PathBuf::from(dir))?;
            println!("finished {finished} file(s) in {dir}");
            Ok(0)
        }
        ["help"] | ["--help"] | [] => {
            println!("{USAGE}");
            Ok(0)
        }
        _ => Err(format!("unknown command {:?}\n{USAGE}", args.join(" "))),
    }
}

/// An environment variable's value, or None when it is unset or empty.
fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}
