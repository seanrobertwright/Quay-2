//! Record mode: runs the real agent CLI in a PTY of its own inside Quay's terminal, passes
//! everything through both ways, and records what passes. The CLI's events URL and MCP config
//! point at a proxy on loopback that forwards every request to the live bridge unchanged.

use std::io::{BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use portable_pty::{CommandBuilder, PtySize, native_pty_system};

use crate::console;
use crate::http;
use crate::recording::Recorder;

pub fn run(cli: &str, own_exe: &Path, args: &[String], record_dir: &Path) -> Result<i32, String> {
    let real = find_real_cli(cli, own_exe)?;
    let (cols, rows) = console::size();
    let bridge = std::env::var("CLAUDE_EVENTS_URL").ok().filter(|u| !u.is_empty()).map(|u| bridge_host(&u)).transpose()?;
    let token = std::env::var("CLAUDE_EVENTS_TOKEN").ok();
    let tag = std::env::var("CLAUDE_EVENTS_TAG").ok();
    let recorder = Arc::new(Recorder::create(record_dir, cli, cols, rows, token, tag)?);
    let proxy = bridge.as_ref().map(|host| start_proxy(host, recorder.clone())).transpose()?;
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
    match (&bridge, &proxy) {
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

/// The `host:port` of the bridge `CLAUDE_EVENTS_URL` names, which Quay always gives as
/// `http://127.0.0.1:<port>`.
fn bridge_host(url: &str) -> Result<String, String> {
    let bad = || format!("CLAUDE_EVENTS_URL {url:?} is not http://<host>:<port>");
    let rest = url.strip_prefix("http://").ok_or_else(bad)?.trim_end_matches('/');
    let (host, port) = rest.rsplit_once(':').ok_or_else(bad)?;
    let port: u16 = port.parse().map_err(|_| bad())?;
    if host.is_empty() || host.contains('/') || port == 0 {
        return Err(bad());
    }
    Ok(rest.to_string())
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
