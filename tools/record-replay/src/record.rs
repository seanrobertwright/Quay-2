//! Record mode: runs the real agent CLI in a PTY of its own inside Quay's terminal, passes
//! everything through both ways, and records what passes. The CLI's events URL and MCP config
//! point at a proxy on loopback that forwards every request to the live bridge unchanged.

use std::io::{BufReader, IsTerminal, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{CommandBuilder, PtySize, native_pty_system};

use crate::console;
use crate::http;
use crate::recording::{self, Header, Recorder};

pub fn run(cli: &str, own_exe: &Path, args: &[String], record_dir: &Path) -> Result<i32, String> {
    let real = find_real_cli(cli, own_exe)?;
    // Only a terminal is recorded. A run with its input or output piped, such as a shell command
    // an agent runs through `pwsh.exe`, gets the real CLI as it is: it takes no recording's
    // number, and its caller reads the CLI's own output, not a terminal's.
    if !(std::io::stdin().is_terminal() && std::io::stdout().is_terminal()) {
        return pass_through(&real, args);
    }
    let (cols, rows) = console::size();
    let live = http::Live::from_env()?;
    // Asked before the clock starts, so the run starts when the recording does.
    let cli_version = cli_version(&real);
    let header = Header {
        cols,
        rows,
        timestamp: SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()),
        cli_version,
    };
    let recorder = Arc::new(Recorder::create(record_dir, cli, header, &live.token, &live.tag)?);
    let proxy = live.bridge.as_ref().map(|host| start_proxy(host, recorder.clone())).transpose()?;
    watch_markers(record_dir.join(recording::MARKERS), recorder.clone());
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("cannot open a PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&real);
    // portable-pty seeds a command's environment from the registry on Windows; the CLI gets
    // exactly the environment Quay gave this process instead, with the bridge swapped for
    // the proxy.
    cmd.env_clear();
    for (k, v) in std::env::vars_os() {
        cmd.env(k, v);
    }
    match (&live.bridge, &proxy) {
        (Some(bridge), Some(proxy)) => {
            let (from, to) = (format!("http://{bridge}"), format!("http://{proxy}"));
            cmd.env("CLAUDE_EVENTS_URL", &to);
            cmd.args(args.iter().map(|a| a.replace(&from, &to)));
        }
        _ => cmd.args(args),
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

/// Runs the real CLI with this process's input, output and environment, and returns its exit code.
fn pass_through(real: &Path, args: &[String]) -> Result<i32, String> {
    let status = Command::new(real).args(args).status().map_err(|e| format!("cannot start {}: {e}", real.display()))?;
    Ok(status.code().unwrap_or(1))
}

/// The first line the real CLI prints for `--version`, so a capture can say which version made
/// the recording. None when it fails, prints nothing, or takes longer than ten seconds in all;
/// a process the CLI left holding its output is not waited for.
fn cli_version(real: &Path) -> Option<String> {
    let mut child = Command::new(real)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (sent, output) = mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        let _ = sent.send(text);
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let text = output.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
    text.lines().map(str::trim).find(|line| !line.is_empty()).map(str::to_string)
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

/// Listens on a loopback port of its own and forwards every request to `bridge`, logging each
/// one. Returns the proxy's `host:port`.
fn start_proxy(bridge: &str, recorder: Arc<Recorder>) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("cannot open the recording proxy: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?.to_string();
    let bridge = bridge.to_string();
    std::thread::spawn(move || {
        for client in listener.incoming().flatten() {
            let (bridge, recorder) = (bridge.clone(), recorder.clone());
            std::thread::spawn(move || {
                let Ok(mut out) = client.try_clone() else { return };
                let mut reader = BufReader::new(client);
                while let Ok(Some(request)) = http::read_request(&mut reader) {
                    let t = recorder.now();
                    let answer = http::send(&bridge, &request);
                    recorder.http(t, recorder.now() - t, &request, &answer);
                    let close = request.header("connection").is_some_and(|c| c.eq_ignore_ascii_case("close"));
                    let response = answer.unwrap_or_else(|error| http::Response {
                        status: 502,
                        reason: "Bad Gateway".into(),
                        headers: vec![("content-type".into(), "text/plain".into())],
                        body: error.into_bytes(),
                    });
                    if http::write_response(&mut out, &response, close).is_err() || close {
                        break;
                    }
                }
            });
        }
    });
    Ok(addr)
}

/// Marks the latest step marker already made, then each new one as `mark` appends it.
fn watch_markers(path: PathBuf, recorder: Arc<Recorder>) {
    let read = |path: &Path| std::fs::read_to_string(path).unwrap_or_default();
    let existing = read(&path);
    if let Some(latest) = existing.lines().rev().map(str::trim).find(|l| recording::is_marker_name(l)) {
        recorder.marker(latest);
    }
    let mut seen = existing.rfind('\n').map_or(0, |at| at + 1);
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let text = read(&path);
            let Some(end) = text.rfind('\n').map(|at| at + 1).filter(|&end| end > seen) else { continue };
            for line in text.get(seen..end).unwrap_or("").lines().map(str::trim) {
                if recording::is_marker_name(line) {
                    recorder.marker(line);
                }
            }
            seen = end;
        }
    });
}
