use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::models::{PermissionMode, RunKind, SpawnTerminalRequest, TerminalOutputPayload};

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
    is_alive: Arc<AtomicBool>,
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
        let rows = request.rows.unwrap_or(30);
        let cols = request.cols.unwrap_or(120);

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let perm = request.permission_mode.unwrap_or(PermissionMode::Skip);

        let mut cmd = match request.run_kind {
            RunKind::PowerShell => {
                let mut c = CommandBuilder::new("pwsh.exe");
                c.arg("-NoLogo");
                c
            }
            RunKind::Command => {
                let mut c = CommandBuilder::new("pwsh.exe");
                c.arg("-NoLogo");
                if let Some(ref text) = request.command_text {
                    c.arg("-Command");
                    c.arg(text);
                }
                c
            }
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

                // Inject Quay MCP server for autonomous Agent-to-Agent (A2A) collaboration
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
                        c.arg("--mcp-config");
                        c.arg(mcp_path.to_string_lossy().to_string());
                    }
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

        // Inject custom CLI launch flags (e.g. for Claude)
        if request.run_kind == RunKind::Claude {
            if let Some(ref flags) = request.custom_flags {
                for flag in flags.split_whitespace() {
                    cmd.arg(flag);
                }
            }
        }

        cmd.cwd(&request.project_path);

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

        let output_buffer = Arc::new(Mutex::new((String::new(), 0u64)));
        let is_alive = Arc::new(AtomicBool::new(true));

        // Background thread for reading PTY output
        {
            let app_handle = app_handle.clone();
            let terminal_id = terminal_id.clone();
            let is_alive = is_alive.clone();
            let writer = writer.clone();
            let output_buffer = output_buffer.clone();

            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let mut current_seq = 0u64;

                while is_alive.load(Ordering::SeqCst) {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]).to_string();

                            // Auto-respond to ANSI DSR 6n (Cursor Position Report) queries
                            // from interactive CLIs like Claude Code so they don't block on stdin
                            if text.contains("\x1b[6n") {
                                let mut w = writer.lock();
                                let _ = w.write_all(b"\x1b[1;1R");
                                let _ = w.flush();
                            }

                            current_seq += 1;
                            let seq = current_seq;

                            // Buffer recent output for newly-mounting xterm instances
                            {
                                let mut guard = output_buffer.lock();
                                guard.0.push_str(&text);
                                guard.1 = seq;
                                // Cap buffer at 256KB to avoid unbounded memory usage
                                if guard.0.len() > 256 * 1024 {
                                    let excess = guard.0.len() - 256 * 1024;
                                    guard.0.drain(..excess);
                                }
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

            std::thread::spawn(move || {
                let exit_status = child.wait();
                is_alive.store(false, Ordering::SeqCst);

                // Clean up temporary MCP config file if exists
                let temp_mcp = std::env::temp_dir().join(format!("quay-mcp-{}.json", terminal_id));
                let _ = std::fs::remove_file(temp_mcp);

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
            RunKind::PowerShell => "pwsh".to_string(),
            RunKind::Command => request
                .command_text
                .as_deref()
                .unwrap_or("cmd")
                .to_string(),
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
}
