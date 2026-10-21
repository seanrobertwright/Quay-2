//! Record mode: runs the real agent CLI in a PTY of its own inside Quay's terminal, passes
//! everything through both ways, and records what passes.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use portable_pty::{CommandBuilder, PtySize, native_pty_system};

use crate::console;
use crate::recording::Recorder;

pub fn run(cli: &str, own_exe: &Path, args: &[String], record_dir: &Path) -> Result<i32, String> {
    let real = find_real_cli(cli, own_exe)?;
    let (cols, rows) = console::size();
    let token = std::env::var("CLAUDE_EVENTS_TOKEN").ok();
    let recorder = Arc::new(Recorder::create(record_dir, cli, cols, rows, token)?);
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("cannot open a PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&real);
    cmd.args(args);
    // portable-pty seeds a command's environment from the registry on Windows; the CLI gets
    // exactly the environment Quay gave this process instead.
    cmd.env_clear();
    for (k, v) in std::env::vars_os() {
        cmd.env(k, v);
    }
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("cannot start {}: {e}", real.display()))?;
    drop(pair.slave);

    let raw = console::RawMode::enter();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let rec = recorder.clone();
    let output = std::thread::spawn(move || {
        let mut out = std::io::stdout();
        let mut buf = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            rec.output(&buf[..n]);
            let _ = out.write_all(&buf[..n]);
            let _ = out.flush();
        }
    });
    let rec = recorder.clone();
    std::thread::spawn(move || {
        let mut input = std::io::stdin();
        let mut buf = [0u8; 4096];
        while let Ok(n) = input.read(&mut buf) {
            if n == 0 {
                break;
            }
            rec.input(&buf[..n]);
            if writer.write_all(&buf[..n]).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });
    let master = pair.master;
    let rec = recorder.clone();
    std::thread::spawn(move || {
        let mut last = (cols, rows);
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let now = console::size();
            if now != last {
                last = now;
                rec.resize(now.0, now.1);
                let _ = master.resize(PtySize { rows: now.1, cols: now.0, pixel_width: 0, pixel_height: 0 });
            }
        }
    });

    let status = child.wait().map_err(|e| format!("waiting for {}: {e}", real.display()))?;
    // The PTY closes when the CLI exits; give the reader a moment to pass on its last output.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while !output.is_finished() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    drop(raw);
    let code = status.exit_code() as i32;
    recorder.exit(code);
    recorder.finish()?;
    Ok(code)
}

/// The real CLI `name` resolves to on PATH, skipping this tool wherever it appears.
fn find_real_cli(name: &str, own_exe: &Path) -> Result<PathBuf, String> {
    let own = std::fs::canonicalize(own_exe).unwrap_or_else(|_| own_exe.to_path_buf());
    let path = std::env::var_os("PATH").unwrap_or_default();
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if !candidate.is_file() {
                continue;
            }
            let canonical = std::fs::canonicalize(&candidate).unwrap_or_else(|_| candidate.clone());
            if canonical == own || canonical.parent() == own.parent() {
                continue;
            }
            return Ok(candidate);
        }
    }
    Err(format!("no real {name} on PATH after the recorder; put its folder after the recorder's in the fixture's PATH"))
}
