use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::models::{
    LaunchPromptForm, PermissionMode, RunKind, SpawnTerminalRequest, TerminalOutputPayload,
};

#[derive(Clone, Serialize)]
pub struct PtyOutputPayload {
    pub terminal_id: String,
    pub data: String,
    pub seq: u64,
}

#[derive(Clone, Serialize)]
pub struct PtyExitPayload {
    pub terminal_id: String,
    pub exit_code: Option<i32>,
}

pub struct PtySession {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub run_kind: RunKind,
    pub permission_mode: PermissionMode,
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    output_buffer: Arc<Mutex<(String, u64)>>,
    current_size: Arc<Mutex<(u16, u16)>>,
    is_alive: Arc<AtomicBool>,
}

/// Decodes a byte chunk into UTF-8 while preserving incomplete multi-byte UTF-8 sequences
/// (1..3 trailing bytes) across `read()` calls so split box-drawing or emoji characters
/// are never corrupted into U+FFFD replacement characters.
fn decode_utf8_streaming(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    let mut out = String::with_capacity(pending.len());
    let mut pos = 0;
    while pos < pending.len() {
        match std::str::from_utf8(&pending[pos..]) {
            Ok(valid) => {
                out.push_str(valid);
                pos = pending.len();
                break;
            }
            Err(err) => {
                let valid_len = err.valid_up_to();
                if valid_len > 0 {
                    if let Ok(valid) = std::str::from_utf8(&pending[pos..pos + valid_len]) {
                        out.push_str(valid);
                    }
                    pos += valid_len;
                }
                match err.error_len() {
                    Some(invalid_len) => {
                        out.push('\u{FFFD}');
                        pos += invalid_len;
                    }
                    None => {
                        // Incomplete multi-byte sequence at end of buffer; wait for next read()
                        break;
                    }
                }
            }
        }
    }
    pending.drain(..pos);
    out
}

/// Caps the scrollback buffer at `max_len` bytes on a valid UTF-8 boundary and avoids
/// slicing through the middle of an ANSI escape sequence.
fn trim_output_buffer(buf: &mut String, max_len: usize) {
    if buf.len() <= max_len {
        return;
    }
    let excess = buf.len() - max_len;
    let mut cut = excess;
    while cut < buf.len() && !buf.is_char_boundary(cut) {
        cut += 1;
    }
    let lookahead_end = (cut + 64).min(buf.len());
    let window = &buf.as_bytes()[cut..lookahead_end];
    if let Some(esc_pos) = window.iter().position(|&b| b == 0x1b || b == b'\n') {
        if esc_pos > 0
            && window[..esc_pos].iter().all(|&b| {
                b.is_ascii_digit() || b == b';' || b == b'?' || (0x40..=0x7e).contains(&b)
            })
        {
            let next_cut = cut + esc_pos;
            if buf.is_char_boundary(next_cut) {
                cut = next_cut;
            }
        }
    }
    buf.drain(..cut);
}

/// The request's launch prompt, when it has one and its CLI takes one.
fn launch_prompt(request: &SpawnTerminalRequest) -> Option<&str> {
    request
        .initial_prompt
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .filter(|_| request.run_kind.launch_prompt_form().is_some())
}

/// Env var that carries the launch prompt into pwsh for CLIs that start through `cmd.exe /c`.
const LAUNCH_PROMPT_ENV: &str = "QUAY_LAUNCH_PROMPT";

/// Quotes `text` as a PowerShell single-quoted literal, which expands nothing.
fn pwsh_literal(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('\'');
    for ch in text.chars() {
        // PowerShell also closes a single-quoted string on the typographic single quotes
        if matches!(ch, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            quoted.push(ch);
        }
        quoted.push(ch);
    }
    quoted.push('\'');
    quoted
}

/// Whether `cmd` starts its CLI as `cmd.exe /c <cli>`, as the npm-shim CLIs do.
fn starts_through_cmd(cmd: &CommandBuilder) -> bool {
    let argv = cmd.get_argv();
    argv.len() >= 2 && argv[0] == "cmd.exe" && argv[1] == "/c"
}

/// Turns a `cmd.exe /c <cli> <args>` command into a pwsh one that reads the launch prompt
/// from an env var. cmd.exe ends a command line at its first newline and an npm `.cmd`
/// shim re-parses its arguments, so a multi-line prompt can't survive that route; pwsh
/// runs the CLI's `.ps1` shim, which hands each argument on intact.
fn start_through_pwsh(cmd: &mut CommandBuilder, form: Option<LaunchPromptForm>, prompt: &str) {
    let mut script = String::from("&");
    for arg in cmd.get_argv().iter().skip(2) {
        script.push(' ');
        script.push_str(&pwsh_literal(&arg.to_string_lossy()));
    }
    if let Some(LaunchPromptForm::Flag(flag)) = form {
        script.push(' ');
        script.push_str(&pwsh_literal(flag));
    }
    script.push_str(" $env:");
    script.push_str(LAUNCH_PROMPT_ENV);

    #[cfg(windows)]
    let program = "pwsh.exe";
    #[cfg(not(windows))]
    let program = "pwsh";
    *cmd.get_argv_mut() = [program, "-NoProfile", "-NoLogo", "-Command", script.as_str()]
        .iter()
        .map(|arg| arg.into())
        .collect();
    cmd.env(LAUNCH_PROMPT_ENV, prompt);
}

/// A shell terminal: pwsh on Windows, sh elsewhere, running `command_text` and staying
/// open when there is one.
fn shell_command(command_text: Option<&str>) -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut c = CommandBuilder::new("pwsh.exe");
        c.arg("-NoProfile");
        c.arg("-NoLogo");
        if let Some(text) = command_text {
            c.arg("-NoExit");
            c.arg("-Command");
            c.arg(text);
        }
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = CommandBuilder::new("sh");
        if let Some(text) = command_text {
            c.arg("-c");
            c.arg(text);
        }
        c
    }
}

/// Builds the command line for a terminal: the CLI, its permission flags, custom flags,
/// the launch prompt and, last, Quay's MCP config.
pub(crate) fn build_command(
    request: &SpawnTerminalRequest,
    terminal_id: &str,
    bridge_port: u16,
    bridge_token: &str,
) -> CommandBuilder {
    let perm = request.permission_mode.unwrap_or(PermissionMode::Skip);

    let mut cmd = match request.run_kind {
        // On Unix a PowerShell terminal opens a bare shell and ignores its command text
        RunKind::PowerShell => {
            shell_command(request.command_text.as_deref().filter(|_| cfg!(windows)))
        }
        RunKind::Command | RunKind::Archon => shell_command(request.command_text.as_deref()),
        RunKind::Claude => {
            let mut c = CommandBuilder::new("claude.exe");
            // Inject event-bridge environment variables
            c.env("CLAUDE_EVENTS_URL", format!("http://127.0.0.1:{}", bridge_port));
            c.env("CLAUDE_EVENTS_TOKEN", &bridge_token);
            c.env("CLAUDE_EVENTS_TAG", &terminal_id);
            c.env("CLAUDE_EVENTS_TOOLS", "full");

            if perm == PermissionMode::Skip {
                c.arg("--dangerously-skip-permissions");
                // Per ADR 0006: host permissions off for skip mode so Claude doesn't block on tool checks
                c.env("CLAUDE_EVENTS_PERMISSIONS", "off");
            } else {
                c.env("CLAUDE_EVENTS_PERMISSIONS", "host");
            }

            c
        }
        RunKind::Antigravity => {
            let mut c = CommandBuilder::new("agy.exe");
            if perm == PermissionMode::Skip {
                c.arg("--dangerously-skip-permissions");
            }
            c
        }
        RunKind::Codex => {
            let mut c = CommandBuilder::new("codex.exe");
            if perm == PermissionMode::Skip {
                c.arg("--dangerously-bypass-approvals-and-sandbox");
            }
            c
        }
        RunKind::Pi => {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/c");
            c.arg("pi");
            if perm == PermissionMode::Skip {
                c.arg("--approve");
            }
            c
        }
        RunKind::Gemini => {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/c");
            c.arg("gemini");
            c
        }
        RunKind::Grok => {
            // Check if user has ~/.grok/bin/agent.exe installed
            let grok_path = std::env::var("USERPROFILE")
                .ok()
                .map(|home| std::path::PathBuf::from(home).join(".grok").join("bin").join("agent.exe"))
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "agent.exe".to_string());
            CommandBuilder::new(grok_path)
        }
        RunKind::Aider => {
            let mut c = CommandBuilder::new("aider.exe");
            if perm == PermissionMode::Skip {
                c.arg("--yes-always");
            }
            c
        }
        RunKind::Kiro => {
            let kiro_path = std::env::var("LOCALAPPDATA")
                .ok()
                .map(|local| std::path::PathBuf::from(local).join("Kiro-Cli").join("kiro-cli.exe"))
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "kiro-cli.exe".to_string());
            let mut c = CommandBuilder::new(kiro_path);
            c.arg("chat");
            if perm == PermissionMode::Skip {
                c.arg("--trust-all-tools");
            }
            c
        }
        RunKind::Copilot => {
            let copilot_local = std::env::var("LOCALAPPDATA")
                .ok()
                .map(|local| std::path::PathBuf::from(local).join("GitHub CLI").join("copilot").join("copilot.exe"))
                .filter(|p| p.exists());

            if let Some(path) = copilot_local {
                let mut c = CommandBuilder::new(path.to_string_lossy().to_string());
                if perm == PermissionMode::Skip {
                    c.arg("--allow-all-tools");
                }
                c
            } else {
                let gh_path = std::path::PathBuf::from("C:\\Program Files\\GitHub CLI\\gh.exe");
                let program = if gh_path.exists() {
                    gh_path.to_string_lossy().to_string()
                } else {
                    "gh.exe".to_string()
                };
                let mut c = CommandBuilder::new(program);
                c.arg("copilot");
                c
            }
        }
        RunKind::OpenCode => {
            let opencode_path = std::env::var("USERPROFILE")
                .ok()
                .map(|home| std::path::PathBuf::from(home).join(".bun").join("bin").join("opencode.exe"))
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "opencode.exe".to_string());
            let mut c = CommandBuilder::new(opencode_path);
            if perm == PermissionMode::Skip {
                c.arg("--auto");
            }
            c
        }
    };

    // Inject workspace / custom environment variables
    if let Some(ref envs) = request.env_vars {
        for (k, v) in envs {
            cmd.env(k, v);
        }
    }

    // Inject custom CLI launch flags (for any supported agent)
    if request.run_kind.is_agent() {
        if let Some(ref flags) = request.custom_flags {
            for flag in flags.split_whitespace() {
                cmd.arg(flag);
            }
        }
    }

    // The launch prompt is one argument, never split, so multi-line prompts survive
    if let Some(prompt) = launch_prompt(request) {
        let form = request.run_kind.launch_prompt_form();
        if starts_through_cmd(&cmd) {
            start_through_pwsh(&mut cmd, form, prompt);
        } else {
            match form {
                Some(LaunchPromptForm::Positional) => cmd.arg(prompt),
                Some(LaunchPromptForm::Flag(flag)) => {
                    cmd.arg(flag);
                    cmd.arg(prompt);
                }
                None => {}
            }
        }
    }

    // Inject Quay MCP server for autonomous Agent-to-Agent (A2A) collaboration.
    // `--mcp-config` takes several values and would read a bare argument after it as
    // another config file, so it goes after the custom flags and the launch prompt.
    if request.run_kind.gets_quay_mcp() {
        let mcp_config = serde_json::json!({
            "mcpServers": {
                "quay": {
                    "type": "http",
                    "url": format!("http://127.0.0.1:{}/mcp", bridge_port),
                    "headers": {
                        "Authorization": format!("Bearer {}", bridge_token)
                    }
                }
            }
        });

        let temp_dir = std::env::temp_dir();
        let mcp_path = temp_dir.join(format!("quay-mcp-{}.json", terminal_id));
        if let Ok(content) = serde_json::to_string_pretty(&mcp_config) {
            if std::fs::write(&mcp_path, content).is_ok() {
                cmd.arg("--mcp-config");
                cmd.arg(mcp_path.to_string_lossy().to_string());
            }
        }
    }

    cmd.cwd(&request.project_path);

    cmd
}

impl PtySession {
    pub fn spawn(
        request: SpawnTerminalRequest,
        terminal_id: String,
        bridge_port: u16,
        bridge_token: String,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let rows = request.rows.unwrap_or(45);
        let cols = request.cols.unwrap_or(160);

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let perm = request.permission_mode.unwrap_or(PermissionMode::Skip);

        let cmd = build_command(&request, &terminal_id, bridge_port, &bridge_token);

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn child process: {}", e))?;

        // Drop the slave end in this process so EOF works when child exits
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone master reader: {}", e))?;

        let writer = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| {
            format!("Failed to take master writer: {}", e)
        })?));

        let log_dir = {
            #[cfg(test)]
            {
                let t = std::env::temp_dir().join("quay2_test_sessions");
                let _ = std::fs::create_dir_all(&t);
                t
            }
            #[cfg(not(test))]
            {
                let d = if let Ok(local) = std::env::var("LOCALAPPDATA") {
                    std::path::Path::new(&local).join("Quay2").join("sessions")
                } else {
                    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
                    std::path::Path::new(&home).join(".quay2").join("sessions")
                };
                let _ = std::fs::create_dir_all(&d);
                d
            }
        };
        let log_path = log_dir.join(format!("{}.log", terminal_id));

        // Read existing scrollback if relaunching an existing terminal
        let initial_data = if log_path.exists() {
            std::fs::read(&log_path).ok().and_then(|bytes| {
                let max_len = 256 * 1024;
                let slice = if bytes.len() > max_len {
                    let start = bytes.len() - max_len;
                    let mut cut = start;
                    while cut < bytes.len() && (bytes[cut] & 0xC0) == 0x80 {
                        cut += 1;
                    }
                    &bytes[cut..]
                } else {
                    &bytes[..]
                };
                String::from_utf8(slice.to_vec()).ok()
            }).unwrap_or_default()
        } else {
            String::new()
        };

        let output_buffer = Arc::new(Mutex::new((initial_data, 0u64)));
        let current_size = Arc::new(Mutex::new((rows, cols)));
        let is_alive = Arc::new(AtomicBool::new(true));

        // Background thread for reading PTY output
        {
            let app_handle = app_handle.clone();
            let terminal_id = terminal_id.clone();
            let is_alive = is_alive.clone();
            let output_buffer = output_buffer.clone();
            let log_path_clone = log_path.clone();

            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let mut pending_utf8 = Vec::with_capacity(8);
                let mut current_seq = 0u64;
                let mut session_started_emitted = false;
                let mut log_file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path_clone)
                    .ok();

                while is_alive.load(Ordering::SeqCst) {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            let text = decode_utf8_streaming(&mut pending_utf8, &buf[..n]);
                            if text.is_empty() {
                                continue;
                            }

                            if let Some(ref mut file) = log_file {
                                use std::io::Write;
                                let _ = file.write_all(text.as_bytes());
                            }

                            // Transition session to active/idle state on first output from child process
                            if !session_started_emitted {
                                session_started_emitted = true;
                                let _ = app_handle.emit(
                                    "bridge-event",
                                    crate::slices::bridge::Envelope {
                                        v: 1,
                                        boot: "".to_string(),
                                        seq: 0,
                                        ts: std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_millis() as u64,
                                        session_id: terminal_id.clone(),
                                        tag: Some(terminal_id.clone()),
                                        event_type: "session.started".to_string(),
                                        data: serde_json::Value::Null,
                                    },
                                );
                            }

                            current_seq += 1;
                            let seq = current_seq;

                            // Buffer recent output for newly-mounting xterm instances
                            {
                                let mut guard = output_buffer.lock();
                                guard.0.push_str(&text);
                                guard.1 = seq;
                                // Cap buffer at 256KB to avoid unbounded memory usage
                                trim_output_buffer(&mut guard.0, 256 * 1024);
                            }

                            let _ = app_handle.emit(
                                "pty-output",
                                PtyOutputPayload {
                                    terminal_id: terminal_id.clone(),
                                    data: text,
                                    seq,
                                },
                            );
                        }
                        Err(e) => {
                            tracing::debug!("PTY reader ended for {}: {}", terminal_id, e);
                            break;
                        }
                    }
                }
                is_alive.store(false, Ordering::SeqCst);
            });
        }

        // Background thread for watching process exit
        {
            let app_handle = app_handle.clone();
            let terminal_id = terminal_id.clone();
            let is_alive = is_alive.clone();
            let log_path_exit = log_path.clone();

            std::thread::spawn(move || {
                let exit_status = child.wait();
                is_alive.store(false, Ordering::SeqCst);

                // Clean up temporary MCP config file if exists
                let temp_mcp = std::env::temp_dir().join(format!("quay-mcp-{}.json", terminal_id));
                let _ = std::fs::remove_file(temp_mcp);

                // Compact log file if it exceeds 2MB to keep disk space bounded
                if let Ok(metadata) = std::fs::metadata(&log_path_exit) {
                    if metadata.len() > 2 * 1024 * 1024 {
                        if let Ok(bytes) = std::fs::read(&log_path_exit) {
                            let max_len = 256 * 1024;
                            if bytes.len() > max_len {
                                let start = bytes.len() - max_len;
                                let mut cut = start;
                                while cut < bytes.len() && (bytes[cut] & 0xC0) == 0x80 {
                                    cut += 1;
                                }
                                let _ = std::fs::write(&log_path_exit, &bytes[cut..]);
                            }
                        }
                    }
                }

                let exit_code = match exit_status {
                    Ok(status) => {
                        if status.success() {
                            Some(0)
                        } else {
                            // On Windows, exit code is integer
                            Some(1)
                        }
                    }
                    Err(_) => None,
                };

                let _ = app_handle.emit(
                    "terminal-exited",
                    PtyExitPayload {
                        terminal_id,
                        exit_code,
                    },
                );
            });
        }

        let name = request.name.unwrap_or_else(|| match request.run_kind {
            RunKind::Claude => "claude".to_string(),
            RunKind::Antigravity => "agy".to_string(),
            RunKind::Codex => "codex".to_string(),
            RunKind::Pi => "pi".to_string(),
            RunKind::Gemini => "gemini".to_string(),
            RunKind::Grok => "grok".to_string(),
            RunKind::Aider => "aider".to_string(),
            RunKind::Kiro => "kiro".to_string(),
            RunKind::Copilot => "copilot".to_string(),
            RunKind::OpenCode => "opencode".to_string(),
            RunKind::PowerShell => "pwsh".to_string(),
            RunKind::Command => request
                .command_text
                .as_deref()
                .unwrap_or("cmd")
                .to_string(),
            RunKind::Archon => "archon".to_string(),
        });

        Ok(Self {
            id: terminal_id,
            name,
            project_path: request.project_path,
            run_kind: request.run_kind,
            permission_mode: perm,
            master: pair.master,
            writer,
            output_buffer,
            current_size,
            is_alive,
        })
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self.writer.lock();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        if rows == 0 || cols == 0 {
            return Ok(());
        }
        {
            let mut size = self.current_size.lock();
            if *size == (rows, cols) {
                return Ok(());
            }
            *size = (rows, cols);
        }
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    pub fn get_output(&self) -> TerminalOutputPayload {
        let guard = self.output_buffer.lock();
        TerminalOutputPayload {
            terminal_id: self.id.clone(),
            data: guard.0.clone(),
            last_seq: guard.1,
        }
    }

    pub fn is_alive(&self) -> bool {
        self.is_alive.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn test_spawn_claude_version() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty failed");

        let mut cmd = CommandBuilder::new("claude.exe");
        cmd.arg("--version");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn claude failed");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("reader failed");
        let mut writer = pair.master.take_writer().expect("writer failed");

        // Background reader thread
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            let mut full_output = String::new();
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let s = String::from_utf8_lossy(&buf[..n]).to_string();
                full_output.push_str(&s);
                let _ = tx.send(s);
            }
            full_output
        });

        // Whenever DSR 6n is received, answer with CPR \x1b[1;1R
        for msg in rx {
            print!("{}", msg);
            if msg.contains("\x1b[6n") {
                let _ = writer.write_all(b"\x1b[1;1R");
                let _ = writer.flush();
            }
            if msg.contains("2.") || msg.contains("claude") {
                break;
            }
        }
        let status = child.wait().expect("wait failed");
        assert!(status.success());
    }

    const MULTI_LINE_PROMPT: &str =
        "Role: Lead Developer\nYou are the \"Lead Developer\".\n  Teammates: a & b | c\nWait for the user's task.";

    fn spawn_request(run_kind: RunKind) -> SpawnTerminalRequest {
        SpawnTerminalRequest {
            id: None,
            name: None,
            project_path: ".".to_string(),
            run_kind,
            permission_mode: Some(PermissionMode::Skip),
            command_text: None,
            rows: None,
            cols: None,
            env_vars: None,
            custom_flags: None,
            initial_prompt: None,
        }
    }

    fn argv(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv()
            .iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn claude_gets_custom_flags_and_launch_prompt_before_mcp_config() {
        let mut request = spawn_request(RunKind::Claude);
        request.custom_flags = Some("--model claude-sonnet-5-5".to_string());
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());

        let args = argv(&build_command(&request, "term-claude-prompt", 1234, "tok"));

        assert_eq!(args.len(), 7, "{:?}", args);
        assert_eq!(
            args[..6],
            [
                "claude.exe",
                "--dangerously-skip-permissions",
                "--model",
                "claude-sonnet-5-5",
                MULTI_LINE_PROMPT,
                "--mcp-config",
            ]
        );
        assert!(args[6].ends_with("quay-mcp-term-claude-prompt.json"));
    }

    fn args_with_prompt(run_kind: RunKind, prompt: Option<&str>) -> Vec<String> {
        let mut request = spawn_request(run_kind);
        request.initial_prompt = prompt.map(str::to_string);
        // The program path of some CLIs depends on what is installed, so compare from argv[1]
        argv(&build_command(&request, "term-forms", 1234, "tok"))[1..].to_vec()
    }

    #[test]
    fn each_cli_takes_the_launch_prompt_in_its_own_form() {
        let p = MULTI_LINE_PROMPT;
        assert_eq!(
            args_with_prompt(RunKind::Codex, Some(p)),
            ["--dangerously-bypass-approvals-and-sandbox", p]
        );
        assert_eq!(args_with_prompt(RunKind::OpenCode, Some(p)), ["--auto", "--prompt", p]);
        assert_eq!(
            args_with_prompt(RunKind::Kiro, Some(p)),
            ["chat", "--trust-all-tools", p]
        );
        let copilot = args_with_prompt(RunKind::Copilot, Some(p));
        assert_eq!(copilot[copilot.len() - 2..], ["-i", p]);
    }

    #[test]
    fn clis_without_launch_prompt_support_get_no_prompt_argument() {
        for run_kind in [
            RunKind::Antigravity,
            RunKind::Grok,
            RunKind::Aider,
            RunKind::PowerShell,
            RunKind::Command,
        ] {
            assert_eq!(
                args_with_prompt(run_kind, Some(MULTI_LINE_PROMPT)),
                args_with_prompt(run_kind, None),
                "{:?} must ignore the launch prompt",
                run_kind
            );
        }
    }

    #[test]
    fn a_spawn_without_a_launch_prompt_gets_todays_arguments() {
        // Expected values are the arguments each CLI was started with before launch prompts
        assert_eq!(
            args_with_prompt(RunKind::Codex, None),
            ["--dangerously-bypass-approvals-and-sandbox"]
        );
        assert_eq!(args_with_prompt(RunKind::Pi, None), ["/c", "pi", "--approve"]);
        assert_eq!(args_with_prompt(RunKind::Gemini, None), ["/c", "gemini"]);
        assert_eq!(args_with_prompt(RunKind::OpenCode, None), ["--auto"]);
        assert_eq!(args_with_prompt(RunKind::Kiro, None), ["chat", "--trust-all-tools"]);
        assert_eq!(
            args_with_prompt(RunKind::Antigravity, None),
            ["--dangerously-skip-permissions"]
        );
        assert_eq!(args_with_prompt(RunKind::Aider, None), ["--yes-always"]);
        let claude = args_with_prompt(RunKind::Claude, None);
        assert_eq!(claude[..2], ["--dangerously-skip-permissions", "--mcp-config"]);
        assert_eq!(claude.len(), 3);
        // A blank prompt counts as none
        assert_eq!(
            args_with_prompt(RunKind::Codex, Some("  \n")),
            ["--dangerously-bypass-approvals-and-sandbox"]
        );
    }

    #[test]
    fn shell_terminals_get_todays_arguments() {
        let shell_args = |run_kind: RunKind, text: Option<&str>| {
            let mut request = spawn_request(run_kind);
            request.command_text = text.map(str::to_string);
            argv(&build_command(&request, "term-shell", 1234, "tok"))
        };
        for run_kind in [RunKind::PowerShell, RunKind::Command, RunKind::Archon] {
            #[cfg(windows)]
            {
                assert_eq!(shell_args(run_kind, None), ["pwsh.exe", "-NoProfile", "-NoLogo"]);
                assert_eq!(
                    shell_args(run_kind, Some("pnpm dev")),
                    ["pwsh.exe", "-NoProfile", "-NoLogo", "-NoExit", "-Command", "pnpm dev"]
                );
            }
            #[cfg(not(windows))]
            {
                assert_eq!(shell_args(run_kind, None), ["sh"]);
                let expected: &[&str] = if run_kind == RunKind::PowerShell {
                    &["sh"]
                } else {
                    &["sh", "-c", "pnpm dev"]
                };
                assert_eq!(shell_args(run_kind, Some("pnpm dev")), expected);
            }
        }
    }

    #[test]
    fn npm_shim_clis_take_the_launch_prompt_through_pwsh_not_cmd() {
        // cmd.exe ends a command line at its first newline, so a multi-line launch prompt
        // reaches pi and gemini through pwsh, which hands the shim each argument intact
        let mut request = spawn_request(RunKind::Pi);
        request.custom_flags = Some("--model it's".to_string());
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());
        let cmd = build_command(&request, "term-pi", 1234, "tok");
        assert_eq!(
            argv(&cmd)[1..],
            [
                "-NoProfile",
                "-NoLogo",
                "-Command",
                "& 'pi' '--approve' '--model' 'it''s' $env:QUAY_LAUNCH_PROMPT",
            ]
        );
        assert_eq!(
            cmd.get_env("QUAY_LAUNCH_PROMPT").map(|v| v.to_string_lossy().to_string()),
            Some(MULTI_LINE_PROMPT.to_string())
        );

        let gemini = args_with_prompt(RunKind::Gemini, Some(MULTI_LINE_PROMPT));
        assert_eq!(gemini[3], "& 'gemini' '-i' $env:QUAY_LAUNCH_PROMPT");
    }

    #[cfg(windows)]
    #[test]
    fn a_multi_line_launch_prompt_reaches_an_npm_shim_cli_intact() {
        // A stand-in pi.ps1 shim records the arguments it was handed
        let dir = std::env::temp_dir().join(format!("quay-launch-prompt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("args.json");
        let _ = std::fs::remove_file(&out);
        std::fs::write(
            dir.join("pi.ps1"),
            format!(
                "ConvertTo-Json -InputObject @($args) | Set-Content -Encoding utf8 -LiteralPath '{}'",
                out.display()
            ),
        )
        .unwrap();

        let mut request = spawn_request(RunKind::Pi);
        let path = std::env::var("PATH").unwrap_or_default();
        request.env_vars = Some(
            [("PATH".to_string(), format!("{};{}", dir.display(), path))]
                .into_iter()
                .collect(),
        );
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());
        let cmd = build_command(&request, "term-pi-e2e", 1234, "tok");

        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("openpty failed");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn pwsh failed");
        drop(pair.slave);
        // Drain the PTY so the child never blocks on a full output pipe,
        // and answer ConPTY's cursor-position query (DSR 6n) so the child starts
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let screen = Arc::new(Mutex::new(String::new()));
        let screen_seen = screen.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                if text.contains("[6n") {
                    let _ = writer.write_all(b"[1;1R");
                    let _ = writer.flush();
                }
                screen_seen.lock().push_str(&text);
            }
        });

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let recorded = loop {
            if let Ok(text) = std::fs::read_to_string(&out) {
                if let Ok(args) = serde_json::from_str::<Vec<String>>(text.trim_start_matches('\u{feff}')) {
                    break args;
                }
            }
            assert!(std::time::Instant::now() < deadline, "pi.ps1 never recorded its arguments: {}", screen.lock());
            std::thread::sleep(std::time::Duration::from_millis(100));
        };
        let _ = child.kill();
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(recorded, ["--approve", MULTI_LINE_PROMPT]);
    }

    #[test]
    fn test_buffer_drain_multibyte_utf8() {
        let mut buffer = String::new();
        // Fill buffer close to 256KB with 3-byte unicode characters (e.g. '━' or '✢')
        let chunk = "✢━│└"; // 3 bytes each
        while buffer.len() < 256 * 1024 - 2 {
            buffer.push_str(chunk);
        }
        // Now push a multi-byte string that pushes buffer over 256KB
        // such that 256 * 1024 falls in the middle of a multi-byte character
        buffer.push_str("🌟 Gusting... 322 tokens ━ Claude Code");

        trim_output_buffer(&mut buffer, 256 * 1024);

        assert!(buffer.len() <= 256 * 1024);
        assert!(buffer.is_char_boundary(0));
    }

    #[test]
    fn test_decode_utf8_streaming_split_multibyte() {
        let sample = "│ seanrobertwright/AI-WS-SDK        r: refresh ⚙️\r\n🪾 worktree AI-WS-SDK";
        let bytes = sample.as_bytes();
        let mut pending = Vec::new();
        let mut reconstructed = String::new();

        // Feed 1 byte at a time so every 3-byte and 4-byte UTF-8 sequence is split across calls
        for b in bytes {
            reconstructed.push_str(&decode_utf8_streaming(&mut pending, &[*b]));
        }
        assert!(pending.is_empty());
        assert_eq!(reconstructed, sample);
    }

    #[test]
    fn test_trim_output_buffer_avoids_splitting_csi_sequence() {
        let prefix = "A".repeat(100);
        // Suppose excess cuts right inside "\x1b[24;80H" at "24;80H"
        let tail = "\x1b[24;80H\x1b[32mHello World";
        let mut buf = format!("{}{}", prefix, tail);
        let max_len = tail.len() - 3; // cuts 3 bytes into `tail` ("4;80H\x1b[32mHello World")

        trim_output_buffer(&mut buf, max_len);
        assert!(
            buf.starts_with("\x1b[32mHello World"),
            "Expected buffer to advance to next ESC, got: {:?}",
            buf
        );
    }
}

