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
mod record;

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
        return Err(format!("unknown command {:?}", args.first().map(String::as_str).unwrap_or("")));
    }

    let record_dir = non_empty_env("QUAY_RECORD_DIR");
    match record_dir {
        Some(dir) => record::run(&name, &exe, &args, &PathBuf::from(dir)),
        None => Err(format!("{name}: set QUAY_RECORD_DIR to record")),
    }
}

/// An environment variable's value, or None when it is unset or empty.
fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}
