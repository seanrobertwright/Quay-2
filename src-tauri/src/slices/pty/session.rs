use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use crate::webview::WebviewEvents;

use super::models::{
    LaunchPromptForm, PermissionMode, RunKind, SpawnTerminalRequest, TerminalOutputPayload,
};
use super::{commit_stamp, jsonc, opencode_permission};
use super::opencode_serve::{self, OpenCodeLaunch, OpenCodeServer, Sidecar, SidecarEnder};
use super::osc7501::{self, Osc7501, Osc7501Scanner};
use super::plugin_watch::LaunchRef;
use super::screen::{self, ScreenKeeper};
use crate::slices::surface::{names::SURFACE_TOOLS, timing::CLI_LIMIT};

/// `CLI_LIMIT` in the unit Claude Code and OpenCode take it in.
const CLI_LIMIT_MS: u64 = CLI_LIMIT.as_millis() as u64;

/// How often a running terminal checks whether its output has paused long enough to save
/// its screen (see `screen::SAVE_AFTER_IDLE`).
const SCREEN_SAVE_POLL: std::time::Duration = std::time::Duration::from_millis(500);

/// How long after a process ends its screen is saved, so the reader can take the output
/// still in flight.
const EXIT_DRAIN: std::time::Duration = std::time::Duration::from_millis(300);

/// How long `PtySession::end` waits for the reader to send what the PTY writes as it closes.
const TEARDOWN_DRAIN: std::time::Duration = std::time::Duration::from_secs(2);

/// How much recent output a session keeps for a pane that mounts, in bytes.
const OUTPUT_BUFFER_LIMIT: usize = 256 * 1024;

/// The exit code of a terminal that shows why its CLI couldn't start, the one the exit watcher
/// gives any process that failed.
const MESSAGE_EXIT_CODE: i32 = 1;

/// What a PTY reader runs with each OSC 7501 sequence the process prints, in order.
pub type Osc7501Hook = Box<dyn FnMut(Osc7501) + Send>;

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
    /// The launch that started it (see `LaunchRef`), once `of_launch` has named it.
    launch: Option<u64>,
    /// The PTY its process runs in, or `None` for a terminal whose CLI couldn't start, which
    /// runs no process and shows why.
    pty: Option<PtyEnds>,
    output_buffer: Arc<Mutex<(String, u64)>>,
    current_size: Arc<Mutex<(u16, u16)>>,
    is_alive: Arc<AtomicBool>,
    screen: Arc<ScreenKeeper>,
    /// An OpenCode 2.x terminal's `opencode serve`, which ends when the session drops, its
    /// process exits, or Quay exits (`PtyManager::end_sidecars`).
    sidecar: Option<Sidecar>,
    /// The end of a session that runs no process, until `take_exit_report` takes it.
    exit_report: Option<ExitReport>,
    /// Set once `end` has read the last seq: the session sends no output after it.
    output_closed: Arc<AtomicBool>,
    /// Hangs up when the PTY reader is done, for a session with a process.
    reader_done: Option<std::sync::mpsc::Receiver<()>>,
}

/// The two ends of a PTY Quay holds: the master, which takes its size, and the writer into it.
struct PtyEnds {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

/// How a terminal's launch goes: a process in a PTY, or, for a CLI that can't start, no
/// process and the message that says why.
enum Launch {
    /// The command its PTY runs, and the OpenCode 2.x server that command connects to, if any.
    Process(CommandBuilder, Option<Sidecar>),
    /// What its pane shows in place of its CLI.
    Message(String),
}

/// Where each chunk of a session's output goes: its log, its saved screen, its buffer for a
/// pane that mounts, and the pane itself as `pty-output`.
#[derive(Clone)]
struct OutputSink {
    terminal_id: String,
    events: WebviewEvents,
    log_path: PathBuf,
    output_buffer: Arc<Mutex<(String, u64)>>,
    screen: Arc<ScreenKeeper>,
    output_closed: Arc<AtomicBool>,
}

impl OutputSink {
    /// The terminal's log, opened to append, or `None` when it can't be opened.
    fn open_log(&self) -> Option<std::fs::File> {
        std::fs::OpenOptions::new().create(true).append(true).open(&self.log_path).ok()
    }

    /// Writes `text`, one chunk, to `log` and the screen, runs `before_send` with it, then
    /// buffers it under the next seq and sends it as `pty-output`. Once the session's output is
    /// closed (see `PtySession::end`), it drops the chunk.
    fn write(&self, log: Option<&mut std::fs::File>, text: String, before_send: impl FnOnce(&str)) {
        if self.output_closed.load(Ordering::SeqCst) {
            return;
        }
        if let Some(file) = log {
            let _ = file.write_all(text.as_bytes());
        }
        self.screen.feed(&text, std::time::Instant::now());
        before_send(&text);
        // Buffer recent output for newly-mounting xterm instances, capped to avoid unbounded
        // memory usage. The chunk is sent under the buffer's lock, so a replay and the sent
        // chunks agree, and `PtySession::end` returns only after the last one is sent.
        let mut buffer = self.output_buffer.lock();
        if self.output_closed.load(Ordering::SeqCst) {
            return;
        }
        let seq = append_output(&mut buffer, &text, OUTPUT_BUFFER_LIMIT);
        self.events.emit(
            "pty-output",
            PtyOutputPayload {
                terminal_id: self.terminal_id.clone(),
                data: text,
                seq,
            },
        );
    }
}

/// What reports the end of a session: its `on_exit`, then `terminal-exited`.
pub type ExitReport = Box<dyn FnOnce() + Send>;

/// Reports a session's end with `exit_code`: `on_exit` runs, then `terminal-exited` is sent.
fn report_exit(
    on_exit: Box<dyn FnOnce(Option<i32>) + Send>,
    events: &WebviewEvents,
    terminal_id: String,
    exit_code: Option<i32>,
) {
    on_exit(exit_code);
    events.emit("terminal-exited", PtyExitPayload { terminal_id, exit_code });
}

/// Quay's MCP server as `launch`'s CLI is pointed at it. The launch in it is how a handshake is
/// known to be from this launch's CLI and not from an earlier one's; the token is the terminal's.
fn mcp_url(bridge_port: u16, launch: &LaunchRef) -> String {
    format!("http://127.0.0.1:{}/mcp/{}", bridge_port, launch.launch)
}

/// The value Claude Code's `--mcp-config` receives: the Quay MCP server as one line
/// of JSON. It is passed inline rather than as a file path so the terminal's bearer
/// token never touches disk, and the header names `${CLAUDE_EVENTS_TOKEN}`, which
/// Claude Code expands from its environment, so the token stays out of the command line.
/// `timeout` is how long Claude Code waits on a call to this server, in milliseconds.
pub fn mcp_config_arg(mcp_url: &str) -> String {
    serde_json::json!({
        "mcpServers": {
            "quay": {
                "type": "http",
                "url": mcp_url,
                "headers": {
                    "Authorization": "Bearer ${CLAUDE_EVENTS_TOKEN}"
                },
                "timeout": CLI_LIMIT_MS
            }
        }
    })
    .to_string()
}

/// The program name of Quay's Codex turn-end helper, as `bundle.externalBin` in
/// `tauri.conf.json` names it.
const CODEX_NOTIFY_NAME: &str = "quay-codex-notify";

/// The program name of Quay's PiG extension, as `bundle.externalBin` in `tauri.conf.json`
/// names it. PiG loads an extension only under the name it registers, which is this one.
const PIG_BRIDGE_NAME: &str = "quay-pig-bridge";

/// The sidecar `name`. Tauri puts a sidecar beside the app's own executable, in the build
/// folder and in an install alike.
pub(crate) fn sidecar_program(name: &str) -> PathBuf {
    let file = format!("{}{}", name, std::env::consts::EXE_SUFFIX);
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(&file)))
        .unwrap_or_else(|| PathBuf::from(file))
}

/// Quay's Codex turn-end helper.
fn codex_notify_program() -> PathBuf {
    sidecar_program(CODEX_NOTIFY_NAME)
}

/// Quay's PiG extension, which puts a PiG terminal on the bus as a full peer.
fn pig_bridge_program() -> PathBuf {
    sidecar_program(PIG_BRIDGE_NAME)
}

/// `text` as a TOML basic string, the form Codex reads a `-c` value in. A JSON string is
/// one: the two share their quoting and escapes.
fn toml_string(text: &str) -> String {
    serde_json::Value::from(text).to_string()
}

/// The `-c` overrides that put a Codex terminal on the bus for this run only: Quay's MCP
/// server, whose `Authorization` header Codex fills from `QUAY_A2A_TOKEN` so the token stays
/// off disk and off the command line; approval for every tool on that server, without which
/// Codex refuses the call when its approval policy is `never`; how long Codex waits on a call to
/// it, in seconds; and `notify`, which runs `notify_program` at each turn end.
fn codex_bus_args(mcp_url: &str, notify_program: &Path) -> Vec<String> {
    let notify = toml_string(&notify_program.to_string_lossy());
    [
        format!("mcp_servers.quay.url={}", toml_string(mcp_url)),
        format!("mcp_servers.quay.bearer_token_env_var={}", toml_string("QUAY_A2A_TOKEN")),
        format!("mcp_servers.quay.default_tools_approval_mode={}", toml_string("approve")),
        format!("mcp_servers.quay.tool_timeout_sec={}", CLI_LIMIT.as_secs()),
        format!("notify=[{}]", notify),
    ]
    .into_iter()
    .flat_map(|value| ["-c".to_string(), value])
    .collect()
}

/// The variable OpenCode reads an extra layer of config from, as JSON.
const OPENCODE_CONFIG_VAR: &str = "OPENCODE_CONFIG_CONTENT";

/// The value an OpenCode terminal's `OPENCODE_CONFIG_CONTENT` receives: the Quay MCP server
/// as `mcp.quay`, added to `workspace`, the value the terminal would otherwise get, when that
/// is a JSON object (comments and trailing commas aside). The server is `remote`, and its header names `{env:QUAY_A2A_TOKEN}`,
/// which OpenCode expands from its environment, so the token stays out of the config.
/// `oauth: false` keeps OpenCode from trying to sign in to it, and `timeout` is how long OpenCode
/// waits on a call to it, in milliseconds. Of that server's tools, `allowed` run without a prompt.
pub fn opencode_config_content(mcp_url: &str, workspace: Option<&str>, allowed: &[&str]) -> String {
    opencode_config(mcp_url, workspace, allowed).to_string()
}

/// `opencode_config_content` for OpenCode 2.x, whose Quay server has `"codemode": false`:
/// without it OpenCode 2.4.1 offers the model none of Quay's tools, only Code Mode's `execute`.
pub fn opencode_2_config_content(mcp_url: &str, workspace: Option<&str>, allowed: &[&str]) -> String {
    let mut config = opencode_config(mcp_url, workspace, allowed);
    config["mcp"]["quay"]["codemode"] = serde_json::Value::Bool(false);
    config.to_string()
}

/// The config `opencode_config_content` gives as text, and that `opencode_2_config_content`
/// adds `"codemode": false` to.
fn opencode_config(mcp_url: &str, workspace: Option<&str>, allowed: &[&str]) -> serde_json::Value {
    let mut config = match workspace.filter(|content| !content.is_empty()).map(jsonc::object) {
        Some(Ok(object)) => serde_json::Value::Object(object),
        Some(Err(e)) => {
            tracing::warn!("The workspace's {} is left out: {}", OPENCODE_CONFIG_VAR, e);
            serde_json::json!({})
        }
        None => serde_json::json!({}),
    };
    if !config["mcp"].is_object() {
        config["mcp"] = serde_json::json!({});
    }
    config["mcp"]["quay"] = serde_json::json!({
        "type": "remote",
        "url": mcp_url,
        "headers": {
            "Authorization": "Bearer {env:QUAY_A2A_TOKEN}"
        },
        "oauth": false,
        "timeout": CLI_LIMIT_MS
    });
    opencode_permission::add_allow_rules(&mut config, allowed);
    config
}

/// Sets the `CLAUDE_EVENTS_*` variables Claude Code's event-bridge plugin reads.
fn set_event_bridge_env(
    cmd: &mut CommandBuilder,
    terminal_id: &str,
    bridge_port: u16,
    bridge_token: &str,
    perm: PermissionMode,
) {
    cmd.env("CLAUDE_EVENTS_URL", format!("http://127.0.0.1:{}", bridge_port));
    cmd.env("CLAUDE_EVENTS_TOKEN", bridge_token);
    cmd.env("CLAUDE_EVENTS_TAG", terminal_id);
    cmd.env("CLAUDE_EVENTS_TOOLS", "full");
    // Skip mode turns host permission checks off too, so Claude doesn't block waiting on them
    let permissions = if perm == PermissionMode::Skip { "off" } else { "host" };
    cmd.env("CLAUDE_EVENTS_PERMISSIONS", permissions);
}

pub(crate) const CLAUDE_EVENT_KEYS: [&str; 5] = [
    "CLAUDE_EVENTS_URL",
    "CLAUDE_EVENTS_TOKEN",
    "CLAUDE_EVENTS_TAG",
    "CLAUDE_EVENTS_TOOLS",
    "CLAUDE_EVENTS_PERMISSIONS",
];

pub(crate) const QUAY_ENV_KEYS: [&str; 4] =
    ["QUAY_TERMINAL_ID", "QUAY_A2A_TOKEN", "QUAY_MCP_URL", "QUAY_EVENTS_URL"];

/// Sets the variables every peer terminal gets, whatever its level, so a CLI's own wiring
/// onto the bus can read the terminal's id, token and bridge URLs from its environment.
fn set_quay_env(cmd: &mut CommandBuilder, launch: &LaunchRef, bridge_port: u16, bridge_token: &str) {
    cmd.env("QUAY_TERMINAL_ID", &launch.terminal_id);
    cmd.env("QUAY_A2A_TOKEN", bridge_token);
    cmd.env("QUAY_MCP_URL", mcp_url(bridge_port, launch));
    cmd.env("QUAY_EVENTS_URL", format!("http://127.0.0.1:{}/v1/events", bridge_port));
}

fn clear_event_bridge_env(cmd: &mut CommandBuilder) {
    for key in CLAUDE_EVENT_KEYS {
        cmd.env_remove(key);
    }
}

fn clear_quay_env(cmd: &mut CommandBuilder) {
    for key in QUAY_ENV_KEYS {
        cmd.env_remove(key);
    }
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

/// The Claude Code executable for this platform: `claude.exe` on Windows, `claude` elsewhere.
fn claude_program() -> &'static str {
    #[cfg(windows)]
    let program = "claude.exe";
    #[cfg(not(windows))]
    let program = "claude";
    program
}

/// The OpenCode executable's file name for this platform.
fn opencode_file_name() -> &'static str {
    #[cfg(windows)]
    let name = "opencode.exe";
    #[cfg(not(windows))]
    let name = "opencode";
    name
}

/// The file names OpenCode is looked for under in one folder, in the order a lookup tries
/// them. On Windows that is `PATHEXT`'s order: the executable, then the `.cmd` shim npm installs.
fn opencode_file_names() -> &'static [&'static str] {
    #[cfg(windows)]
    let names: &[&str] = &["opencode.exe", "opencode.cmd"];
    #[cfg(not(windows))]
    let names: &[&str] = &["opencode"];
    names
}

/// The program an OpenCode terminal starts, by its full path: the first OpenCode in the
/// absolute folders of `path`, the terminal's `PATH`, in order, and failing that bun's install,
/// `.bun/bin` under `home`. A spawn given a bare name would look it up on Quay's own `PATH`,
/// not the terminal's. When there is none it is the bare name, so the spawn error names it.
fn opencode_program(path: Option<&std::ffi::OsStr>, home: Option<&std::path::Path>) -> String {
    let on_path = path
        .into_iter()
        .flat_map(std::env::split_paths)
        .filter(|dir| dir.is_absolute());
    let bun = home.map(|home| home.join(".bun").join("bin"));
    on_path
        .chain(bun)
        .flat_map(|dir| opencode_file_names().iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
        .map_or_else(|| opencode_file_name().to_string(), |found| found.to_string_lossy().to_string())
}

/// Whether `program` is a Windows batch file, such as npm's `opencode.cmd` shim, which a PTY
/// can only start through `cmd.exe /c`.
fn is_cmd_shim(program: &str) -> bool {
    Path::new(program)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd"))
}

/// How long `opencode --version` may take before an OpenCode terminal is launched as 2.x.
const VERSION_PATIENCE: std::time::Duration = std::time::Duration::from_secs(3);

/// How long an OpenCode 2.x terminal's server may take to be ready. A cold start of OpenCode
/// can take some seconds on a busy machine.
const SIDECAR_PATIENCE: std::time::Duration = std::time::Duration::from_secs(10);

/// How the OpenCode terminal of `request` is launched on loopback `port`, by what its CLI's
/// `--version` prints (see `opencode_serve::launch_of`). The probe runs the program the
/// terminal would, with the request's variables, and blocks for at most `VERSION_PATIENCE`, so
/// call it on a thread that may block, holding no lock.
pub(crate) fn opencode_launch(request: &SpawnTerminalRequest, port: u16) -> OpenCodeLaunch {
    let program = opencode_program(terminal_path(request).as_deref(), terminal_home(request).as_deref());
    let mut cmd = crate::spawn::hidden_command(program);
    cmd.arg("--version");
    if let Some(envs) = &request.env_vars {
        cmd.envs(envs);
    }
    opencode_serve::launch_of(opencode_serve::probe_version(cmd, VERSION_PATIENCE).as_deref(), port)
}

/// The PiG executable's file name for this platform.
fn pig_file_name() -> &'static str {
    #[cfg(windows)]
    let name = "pig.exe";
    #[cfg(not(windows))]
    let name = "pig";
    name
}

/// The shim `npm i -g @pi-in-go/pig` puts on a Windows `PATH`, which starts PiG through
/// Node. Elsewhere npm links `pig` itself onto `PATH`.
const PIG_NPM_SHIM: &str = "pig.cmd";

/// The npm package that holds PiG's Windows binary for this machine's architecture.
#[cfg(target_arch = "aarch64")]
const PIG_NPM_PLATFORM: &str = "pig-win32-arm64";
#[cfg(not(target_arch = "aarch64"))]
const PIG_NPM_PLATFORM: &str = "pig-win32-x64";

/// The folder of PiG's npm package that holds the real binary, from the folder holding npm's
/// shim.
const PIG_NPM_BINARY_DIR: [&str; 6] =
    ["node_modules", "@pi-in-go", "pig", "node_modules", "@pi-in-go", PIG_NPM_PLATFORM];

/// What a PiG terminal's pane prints when Quay can't find PiG. Quay never installs it.
const PIG_NOT_INSTALLED: &str = "PiG isn't installed. Install it with `npm i -g @pi-in-go/pig` \
    (or `irm https://pi-in-go.dev/install.ps1 | iex` and add its folder to PATH), then run \
    `pig login` once. PiG doesn't use Pi's sign-in.";

/// The real PiG executable a PiG terminal starts, or `None` when PiG isn't installed. In
/// order: PiG in a folder on `path`, the terminal's `PATH`; npm's real binary, behind npm's
/// Windows shim on `path`; then `go install`'s, under `home`. Folders that aren't absolute,
/// such as an empty `PATH` entry, are skipped. On Windows Quay starts PiG directly, never
/// through npm's shim or `cmd.exe`, which can swallow Ctrl+C and misreads `& | > ^` in
/// arguments.
fn pig_program(path: Option<&std::ffi::OsStr>, home: Option<&Path>) -> Option<PathBuf> {
    let name = pig_file_name();
    let dirs: Vec<PathBuf> = path
        .map(|path| std::env::split_paths(path).filter(|dir| dir.is_absolute()).collect())
        .unwrap_or_default();
    let on_path = dirs.iter().map(|dir| dir.join(name));
    let behind_npm_shim = dirs
        .iter()
        .filter(|dir| dir.join(PIG_NPM_SHIM).is_file())
        .map(|dir| PIG_NPM_BINARY_DIR.iter().fold(dir.clone(), |dir, part| dir.join(part)).join(name));
    let from_go = home
        .filter(|home| home.is_absolute())
        .map(|home| home.join("go").join("bin").join(name));
    on_path.chain(behind_npm_shim).chain(from_go).find(|program| program.is_file())
}

/// `message` as a terminal shows it, each line ended with `\r\n`.
fn message_output(message: &str) -> String {
    message.lines().map(|line| format!("{}\r\n", line)).collect()
}

/// The PiG executable `request`'s terminal starts, looked for on its own `PATH` and home (see
/// `pig_program`), or `None` when PiG isn't installed there.
fn pig_launch(request: &SpawnTerminalRequest) -> Option<PathBuf> {
    pig_program(terminal_path(request).as_deref(), terminal_home(request).as_deref())
}

/// What a terminal's pane shows in place of its CLI when the CLI isn't installed, or `None`
/// when it can start. Only PiG is looked for before its launch.
fn missing_cli_message(request: &SpawnTerminalRequest) -> Option<&'static str> {
    (request.run_kind == RunKind::Pig && pig_launch(request).is_none()).then_some(PIG_NOT_INSTALLED)
}

/// The home folder a terminal's process gets: its `USERPROFILE`, or failing that its `HOME`.
fn terminal_home(request: &SpawnTerminalRequest) -> Option<PathBuf> {
    terminal_var(request, "USERPROFILE")
        .or_else(|| terminal_var(request, "HOME"))
        .map(PathBuf::from)
}

/// Whether `a` and `b` name one environment variable. Windows reads a name in any case (it spells
/// `PATH` as `Path`); elsewhere two spellings are two variables.
pub(super) fn same_variable(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

/// The value the environment variable `name` has for a terminal's process before Quay sets its
/// own: the request's when it holds one, whether the terminal's own or the workspace's, otherwise
/// the one in Quay's environment.
fn terminal_var(request: &SpawnTerminalRequest, name: &str) -> Option<std::ffi::OsString> {
    request
        .env_vars
        .as_ref()
        .and_then(|envs| envs.iter().find(|(key, _)| same_variable(key, name)))
        .map(|(_, value)| value.into())
        .or_else(|| std::env::var_os(name))
}

/// The `PATH` a terminal's process gets (see `terminal_var`).
fn terminal_path(request: &SpawnTerminalRequest) -> Option<std::ffi::OsString> {
    terminal_var(request, "PATH")
}

/// Appends a decoded chunk to the replay buffer and returns the chunk's seq, one above the
/// buffer's last. The count carries on from whatever seq the buffer started at, so a relaunched
/// session keeps numbering above what its still-mounted pane has already seen.
fn append_output(buffer: &mut (String, u64), text: &str, max_len: usize) -> u64 {
    buffer.0.push_str(text);
    buffer.1 += 1;
    trim_output_buffer(&mut buffer.0, max_len);
    buffer.1
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
/// runs the CLI's `.ps1` shim, which hands each argument on intact. pwsh finds that shim for
/// a bare name; for a `.cmd` shim named by its path it is the `.ps1` beside it, when there is one.
fn start_through_pwsh(cmd: &mut CommandBuilder, form: Option<LaunchPromptForm>, prompt: &str) {
    let mut script = String::from("&");
    for (i, arg) in cmd.get_argv().iter().skip(2).enumerate() {
        let mut arg = arg.to_string_lossy().to_string();
        if i == 0 && is_cmd_shim(&arg) {
            let ps1 = Path::new(&arg).with_extension("ps1");
            if ps1.is_file() {
                arg = ps1.to_string_lossy().to_string();
            }
        }
        script.push(' ');
        script.push_str(&pwsh_literal(&arg));
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

/// The variable OpenCode 2.x's server takes its password from, and its TUI the password it sends
/// to a `--server`. OpenCode keeps it out of the environment of the shells its tools run.
const OPENCODE_PASSWORD_VAR: &str = "OPENCODE_PASSWORD";

/// The two commands of an OpenCode 2.x terminal, which share one environment, the server's
/// password in it, and one folder: `opencode serve`, listening on `server`'s loopback port only,
/// for the terminal's sidecar (see `opencode_serve::Sidecar`), and the TUI connected to it, for
/// the PTY (see `build_command`).
pub(crate) fn build_serve(
    request: &SpawnTerminalRequest,
    launch: &LaunchRef,
    bridge_port: u16,
    bridge_token: &str,
    server: &OpenCodeServer,
) -> (std::process::Command, CommandBuilder) {
    let tui = build_command(request, launch, bridge_port, bridge_token, Some(OpenCodeLaunch::Server(server.clone())));
    let mut serve = crate::spawn::hidden_command(opencode_program(
        terminal_path(request).as_deref(),
        terminal_home(request).as_deref(),
    ));
    serve.args(["serve", "--port", &server.port().to_string(), "--hostname", "127.0.0.1"]);
    serve.env_clear();
    serve.envs(tui.iter_full_env_as_str());
    serve.current_dir(&request.project_path);
    (serve, tui)
}

/// Builds the command line for a terminal: the CLI, its permission flags, custom flags,
/// the launch prompt and, last, Quay's MCP config. `opencode` is how an OpenCode terminal is
/// launched; other CLIs ignore it, and an OpenCode terminal without one runs its TUI with no
/// `--port`. The sidecar of an OpenCode 2.x terminal is `build_serve`'s.
pub(crate) fn build_command(
    request: &SpawnTerminalRequest,
    launch: &LaunchRef,
    bridge_port: u16,
    bridge_token: &str,
    opencode: Option<OpenCodeLaunch>,
) -> CommandBuilder {
    let mcp_url = mcp_url(bridge_port, launch);
    let perm = request.run_kind.permission_mode(request.permission_mode);

    let mut cmd = match request.run_kind {
        // On Unix a PowerShell terminal opens a bare shell and ignores its command text
        RunKind::PowerShell => {
            shell_command(request.command_text.as_deref().filter(|_| cfg!(windows)))
        }
        RunKind::Command | RunKind::Archon => shell_command(request.command_text.as_deref()),
        RunKind::Claude => {
            let mut c = CommandBuilder::new(claude_program());
            if perm == PermissionMode::Skip {
                c.arg("--dangerously-skip-permissions");
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
            let program =
                opencode_program(terminal_path(request).as_deref(), terminal_home(request).as_deref());
            let mut c = if is_cmd_shim(&program) {
                let mut c = CommandBuilder::new("cmd.exe");
                c.arg("/c");
                c.arg(program);
                c
            } else {
                CommandBuilder::new(program)
            };
            match &opencode {
                // Its TUI serves its events there, which Quay reads (see `opencode_watch`)
                None | Some(OpenCodeLaunch::Tui(_)) => {
                    if let Some(port) = opencode.as_ref().map(OpenCodeLaunch::port) {
                        c.arg("--port");
                        c.arg(port.to_string());
                    }
                }
                // The TUI of 2.x, connected to the terminal's own server, in the project
                Some(OpenCodeLaunch::Server(server)) => {
                    c.arg("--server");
                    c.arg(server.url());
                    c.arg(&request.project_path);
                }
            }
            if perm == PermissionMode::Skip {
                c.arg("--auto");
            }
            c
        }
        // PiG never asks before a tool call, and its `--approve` only trusts project-local
        // files, so Quay passes no permission flag
        RunKind::Pig => {
            // Without PiG this is its bare name, so a spawn error names it; `PtySession::spawn`
            // shows `PIG_NOT_INSTALLED` instead and starts nothing (see `missing_cli_message`)
            let program = pig_launch(request).unwrap_or_else(|| PathBuf::from(pig_file_name()));
            // Quay's extension registers Quay's MCP server and reports PiG's turns, from the
            // terminal's `QUAY_*` variables. Explicit `-e` paths load even with
            // `--no-extensions` in the custom flags.
            let mut c = CommandBuilder::new(program);
            c.arg("-e");
            c.arg(pig_bridge_program());
            c
        }
    };

    // Inject the terminal's own and the workspace's environment variables
    if let Some(ref envs) = request.env_vars {
        for (k, v) in envs {
            cmd.env(k, v);
        }
    }

    // After the request's variables, so none of them can stand in for Quay's
    if request.run_kind == RunKind::Claude {
        set_event_bridge_env(&mut cmd, &launch.terminal_id, bridge_port, bridge_token, perm);
    } else {
        clear_event_bridge_env(&mut cmd);
    }
    if request.run_kind.is_peer() {
        set_quay_env(&mut cmd, launch, bridge_port, bridge_token);
    } else {
        clear_quay_env(&mut cmd);
    }
    if request.run_kind == RunKind::OpenCode {
        let workspace = cmd.get_env(OPENCODE_CONFIG_VAR).map(|v| v.to_string_lossy().to_string());
        let allowed = opencode_permission::not_denied(
            &SURFACE_TOOLS,
            &opencode_permission::Surroundings {
                project: Path::new(&request.project_path),
                home: terminal_home(request).as_deref(),
                var: &|name| terminal_var(request, name),
                content: workspace.as_deref(),
            },
        );
        let content = match &opencode {
            None | Some(OpenCodeLaunch::Tui(_)) => opencode_config_content(&mcp_url, workspace.as_deref(), &allowed),
            Some(OpenCodeLaunch::Server(_)) => opencode_2_config_content(&mcp_url, workspace.as_deref(), &allowed),
        };
        cmd.env(OPENCODE_CONFIG_VAR, content);
        // After the request's variables, so none of them can stand in for the launch's password
        if let Some(OpenCodeLaunch::Server(server)) = &opencode {
            cmd.env(OPENCODE_PASSWORD_VAR, server.password());
        }
    }
    // Quay reads Antigravity's status and answers from these, so `brief`, which drops each
    // answer, is unset whether the request or Quay's own environment set it
    if request.run_kind.takes_osc7501_vars() {
        cmd.env(osc7501::ENABLE_VAR, "on");
        cmd.env_remove(osc7501::MESSAGES_VAR);
    }
    let hooks_dir = request.run_kind.is_agent().then(commit_stamp::launch_hooks_dir).flatten();
    commit_stamp::apply(&mut cmd, request.run_kind, hooks_dir.as_deref());

    // Inject custom CLI launch flags (for any supported agent)
    if request.run_kind.is_agent() {
        if let Some(ref flags) = request.custom_flags {
            for flag in flags.split_whitespace() {
                cmd.arg(flag);
            }
        }
    }

    // After the custom flags, so a custom `-c` can't replace them, and before the launch
    // prompt, Codex's positional argument
    if request.run_kind == RunKind::Codex {
        for arg in codex_bus_args(&mcp_url, &codex_notify_program()) {
            cmd.arg(arg);
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

    // Inject Quay MCP server for autonomous Agent-to-Agent (A2A) collaboration. OpenCode
    // gets it through `OPENCODE_CONFIG_CONTENT` and Codex through its `-c` overrides, above.
    // Claude's `--allowedTools` and `--mcp-config` take several values and would read a bare
    // argument after them as one more, so they go after the custom flags and the launch prompt.
    if request.run_kind == RunKind::Claude {
        cmd.arg("--allowedTools");
        cmd.arg(SURFACE_TOOLS.map(|tool| format!("mcp__quay__{tool}")).join(","));
        cmd.arg("--mcp-config");
        cmd.arg(mcp_config_arg(&mcp_url));
    }

    cmd.cwd(&request.project_path);

    cmd
}

/// The name a terminal gets when its request gives none: its CLI's, or a command terminal's
/// command.
fn terminal_name(request: &SpawnTerminalRequest) -> String {
    request.name.clone().unwrap_or_else(|| match request.run_kind {
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
        RunKind::Pig => "pig".to_string(),
        RunKind::PowerShell => "pwsh".to_string(),
        RunKind::Command => request
            .command_text
            .as_deref()
            .unwrap_or("cmd")
            .to_string(),
        RunKind::Archon => "archon".to_string(),
    })
}

impl PtySession {
    /// Starts the process for `terminal_id`. `start_seq` is the last output seq already sent
    /// under this id (0 for a new terminal); output from this session is numbered above it,
    /// because a mounted pane drops any chunk whose seq is not above the highest it has seen.
    /// `opencode` is how an OpenCode terminal is launched (see `opencode_launch`), and `None`
    /// for other CLIs. For 2.x the session starts the terminal's server as its sidecar,
    /// blocking until it is ready (see `opencode_serve::Sidecar::start`), and runs the TUI
    /// connected to it in the PTY.
    /// `on_first_output` runs once, on the reader thread, when the process first writes output.
    /// `on_osc7501`, when given, runs there with each OSC 7501 sequence the output carries,
    /// after `on_first_output`. `on_exit` runs once, on the exit watcher thread, with the exit
    /// code when the process ends, before `terminal-exited` is sent.
    ///
    /// When the CLI can't start, because an OpenCode 2.x server can't be had or PiG isn't
    /// installed, the session runs no process and opens no PTY. Its output is one chunk, the
    /// message that says why, numbered and sent as the reader would, with `on_first_output` run
    /// here before it is sent. Its end, with `MESSAGE_EXIT_CODE`, is reported only when the
    /// starter runs `take_exit_report`'s report.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        request: SpawnTerminalRequest,
        launch: LaunchRef,
        start_seq: u64,
        bridge_port: u16,
        bridge_token: String,
        opencode: Option<OpenCodeLaunch>,
        events: WebviewEvents,
        on_first_output: Box<dyn FnOnce() + Send>,
        on_osc7501: Option<Osc7501Hook>,
        on_exit: Box<dyn FnOnce(Option<i32>) + Send>,
    ) -> Result<Self, String> {
        let rows = request.rows.unwrap_or(45);
        let cols = request.cols.unwrap_or(160);
        let perm = request.run_kind.permission_mode(request.permission_mode);

        // An OpenCode 2.x terminal's server is its sidecar. When the server can't be had, or the
        // CLI isn't installed, the pane says why. Should the PTY not start, the sidecar ends as
        // `sidecar` drops.
        let launched = match opencode {
            Some(OpenCodeLaunch::Server(server)) => {
                let (serve, tui) = build_serve(&request, &launch, bridge_port, &bridge_token, &server);
                match Sidecar::start(serve, &server, &mcp_url(bridge_port, &launch), SIDECAR_PATIENCE) {
                    Ok(sidecar) => Launch::Process(tui, Some(sidecar)),
                    Err(why) => Launch::Message(why),
                }
            }
            opencode => match missing_cli_message(&request) {
                Some(message) => Launch::Message(message.to_string()),
                None => Launch::Process(build_command(&request, &launch, bridge_port, &bridge_token, opencode), None),
            },
        };
        let terminal_id = launch.terminal_id;
        let name = terminal_name(&request);

        let log_dir = super::manager::get_sessions_dir();
        let log_path = log_dir.join(format!("{}.log", terminal_id));

        // A relaunched terminal starts from what it showed before: its saved screen, or the
        // raw log when an older Quay saved none
        let earlier = match screen::load_screen(&log_dir, &terminal_id) {
            Some(saved) => saved.data,
            None => super::manager::read_log_tail(&log_path),
        };
        let initial_data = if earlier.is_empty() { String::new() } else { format!("{}\r\n", earlier) };

        let output_buffer = Arc::new(Mutex::new((initial_data, start_seq)));
        let current_size = Arc::new(Mutex::new((rows, cols)));
        let screen = Arc::new(ScreenKeeper::new(
            &log_dir,
            &terminal_id,
            rows,
            cols,
            (!earlier.is_empty()).then_some(earlier.as_str()),
        ));

        let output_closed = Arc::new(AtomicBool::new(false));
        let sink = OutputSink {
            terminal_id: terminal_id.clone(),
            events: events.clone(),
            log_path: log_path.clone(),
            output_buffer: output_buffer.clone(),
            screen: screen.clone(),
            output_closed: output_closed.clone(),
        };
        // The session as it is with no process; a launch that runs one adds its PTY
        let without_process = Self {
            id: terminal_id.clone(),
            name,
            project_path: request.project_path,
            run_kind: request.run_kind,
            permission_mode: perm,
            launch: None,
            pty: None,
            output_buffer,
            current_size,
            is_alive: Arc::new(AtomicBool::new(false)),
            screen: screen.clone(),
            sidecar: None,
            exit_report: None,
            output_closed,
            reader_done: None,
        };

        let (cmd, sidecar) = match launched {
            Launch::Process(cmd, sidecar) => (cmd, sidecar),
            // No process and no PTY: Quay writes the message into the terminal's output itself,
            // as the reader writes a chunk, so nothing is left to repaint it on a resize
            Launch::Message(message) => {
                sink.write(sink.open_log().as_mut(), message_output(&message), |_| on_first_output());
                screen.save_now();
                let exit_report: ExitReport =
                    Box::new(move || report_exit(on_exit, &events, terminal_id, Some(MESSAGE_EXIT_CODE)));
                return Ok(Self { exit_report: Some(exit_report), ..without_process });
            }
        };
        let sidecar_ender = sidecar.as_ref().map(Sidecar::ender);

        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

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

        let is_alive = Arc::new(AtomicBool::new(true));
        let (reader_running, reader_done) = std::sync::mpsc::channel::<()>();
        // Background thread for reading PTY output
        {
            let is_alive = is_alive.clone();
            let screen = screen.clone();

            std::thread::spawn(move || {
                // Dropped as the thread ends, which tells `end` the reader is done
                let _reader_running = reader_running;
                let mut buf = [0u8; 8192];
                let mut pending_utf8 = Vec::with_capacity(8);
                let mut on_first_output = Some(on_first_output);
                let mut osc7501 = on_osc7501.map(|hook| (Osc7501Scanner::default(), hook));
                let mut log_file = sink.open_log();

                while is_alive.load(Ordering::SeqCst) {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            let text = decode_utf8_streaming(&mut pending_utf8, &buf[..n]);
                            if text.is_empty() {
                                continue;
                            }

                            sink.write(log_file.as_mut(), text, |text| {
                                if let Some(hook) = on_first_output.take() {
                                    hook();
                                }
                                if let Some((scanner, hook)) = osc7501.as_mut() {
                                    for seq in scanner.feed(text) {
                                        hook(seq);
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            tracing::debug!("PTY reader ended for {}: {}", sink.terminal_id, e);
                            break;
                        }
                    }
                }
                is_alive.store(false, Ordering::SeqCst);
                // The reader is done with every chunk it read
                screen.save_now();
            });
        }

        // Saves the screen whenever output pauses, so a crash loses at most the last burst
        {
            let is_alive = is_alive.clone();
            let screen = screen.clone();
            std::thread::spawn(move || {
                while is_alive.load(Ordering::SeqCst) {
                    std::thread::sleep(SCREEN_SAVE_POLL);
                    screen.save_if_idle(std::time::Instant::now());
                }
            });
        }

        // Background thread for watching process exit
        {
            let events = events.clone();
            let terminal_id = terminal_id.clone();
            let is_alive = is_alive.clone();
            let log_path_exit = log_path.clone();
            let screen = screen.clone();

            std::thread::spawn(move || {
                let exit_status = child.wait();
                is_alive.store(false, Ordering::SeqCst);
                // The terminal's process is over, so its server is too
                if let Some(ender) = sidecar_ender {
                    ender.end();
                }

                // Compact log file if it exceeds 2MB to keep disk space bounded
                if let Ok(metadata) = std::fs::metadata(&log_path_exit) {
                    if metadata.len() > 2 * 1024 * 1024 {
                        if let Ok(bytes) = std::fs::read(&log_path_exit) {
                            let _ = std::fs::write(&log_path_exit, super::manager::log_tail(&bytes));
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

                report_exit(on_exit, &events, terminal_id, exit_code);

                // ConPTY can keep the reader blocked after the process ends, until the
                // session is dropped, so the reader's own save may be a long way off. Give
                // it a moment to take the last output, then save what it has.
                std::thread::sleep(EXIT_DRAIN);
                screen.save_now();
            });
        }

        Ok(Self {
            pty: Some(PtyEnds { master: pair.master, writer }),
            is_alive,
            sidecar,
            reader_done: Some(reader_done),
            ..without_process
        })
    }

    /// Saves what the terminal shows now, for Quay shutting down with it still running.
    pub fn save_screen(&self) {
        self.screen.save_now();
    }

    /// Stops this session saving its screen, for a terminal being closed or relaunched.
    pub fn discard_screen(&self) {
        self.screen.discard();
    }

    /// What ends this session's OpenCode server, if it has one.
    pub fn sidecar_ender(&self) -> Option<SidecarEnder> {
        self.sidecar.as_ref().map(Sidecar::ender)
    }

    /// The keeper of this session's screen, for discarding it once the session itself has
    /// moved somewhere it can't be reached.
    pub fn screen_keeper(&self) -> Arc<ScreenKeeper> {
        self.screen.clone()
    }

    /// This session, as the one the launch numbered `launch` started.
    pub fn of_launch(self, launch: u64) -> Self {
        Self { launch: Some(launch), ..self }
    }

    /// Whether the launch numbered `launch` started it.
    pub fn is_of_launch(&self, launch: u64) -> bool {
        self.launch == Some(launch)
    }

    /// What reports the end of a session that runs no process (see `spawn`), for its starter to
    /// run once the terminal is listed: an exit reported before then moves no status (see
    /// `PtyManager::exit_launch`). `None` for a session with a process, whose exit watcher
    /// reports its end, and on every call after the first.
    pub fn take_exit_report(&mut self) -> Option<ExitReport> {
        self.exit_report.take()
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        // A session without a process drops what is typed into it, as an exited process's PTY
        // does
        let Some(pty) = &self.pty else {
            return Ok(());
        };
        let mut writer = pty.writer.lock();
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
        self.screen.resize(rows, cols);
        // A session without a process has no PTY to resize, and nothing that would repaint
        let Some(pty) = &self.pty else {
            return Ok(());
        };
        pty.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    pub fn get_output(&self) -> TerminalOutputPayload {
        let (rows, cols) = *self.current_size.lock();
        let guard = self.output_buffer.lock();
        TerminalOutputPayload {
            terminal_id: self.id.clone(),
            data: guard.0.clone(),
            last_seq: guard.1,
            rows: Some(rows),
            cols: Some(cols),
        }
    }

    pub fn is_alive(&self) -> bool {
        self.is_alive.load(Ordering::SeqCst)
    }

    /// The seq of the last output chunk this session sent.
    pub fn last_seq(&self) -> u64 {
        self.output_buffer.lock().1
    }

    /// Ends this session, and its process with it, and returns the seq of its last output chunk,
    /// for the session that takes its place to number on from. Closing a PTY can write output
    /// of its own, as ConPTY writes a mode reset: the reader has up to `TEARDOWN_DRAIN` to send
    /// it, and the session sends nothing after that. So every chunk it sent is numbered at or
    /// below the seq returned, and was sent before `end` returns. It blocks while it waits, so
    /// call it holding no lock.
    pub fn end(mut self) -> u64 {
        let reader_done = self.reader_done.take();
        let output_buffer = self.output_buffer.clone();
        let output_closed = self.output_closed.clone();
        let terminal_id = self.id.clone();
        // Closes the PTY, which ends the process and, once the PTY's last output is read, the reader
        drop(self);
        if let Some(done) = reader_done {
            if let Err(std::sync::mpsc::RecvTimeoutError::Timeout) = done.recv_timeout(TEARDOWN_DRAIN) {
                tracing::debug!("PTY reader for {} still running after its session ended", terminal_id);
            }
        }
        let buffer = output_buffer.lock();
        output_closed.store(true, Ordering::SeqCst);
        buffer.1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::io::Read;

    /// `super::build_command` for launch 7 of terminal `terminal_id`, as OpenCode 1.x on
    /// `server_port` when there is one.
    fn build_command(
        request: &SpawnTerminalRequest,
        terminal_id: &str,
        bridge_port: u16,
        bridge_token: &str,
        server_port: Option<u16>,
    ) -> CommandBuilder {
        let launch = LaunchRef { terminal_id: terminal_id.to_string(), launch: 7 };
        super::build_command(request, &launch, bridge_port, bridge_token, server_port.map(OpenCodeLaunch::Tui))
    }

    #[test]
    fn claude_program_matches_the_platform_binary_name() {
        #[cfg(windows)]
        assert_eq!(claude_program(), "claude.exe");
        #[cfg(not(windows))]
        assert_eq!(claude_program(), "claude");
    }

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

        let mut cmd = CommandBuilder::new(claude_program());
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

        let args = argv(&build_command(&request, "term-claude-prompt", 1234, "tok", Some(4567)));

        // `surface_launch_tests` covers the surface tools' approval, between these two
        assert_eq!(args.len(), 9, "{:?}", args);
        assert_eq!(
            args[..5],
            [
                claude_program(),
                "--dangerously-skip-permissions",
                "--model",
                "claude-sonnet-5-5",
                MULTI_LINE_PROMPT,
            ]
        );
        assert_eq!(args[7..], ["--mcp-config".to_string(), mcp_config_arg("http://127.0.0.1:1234/mcp/7")]);
    }

    fn args_with_prompt(run_kind: RunKind, prompt: Option<&str>) -> Vec<String> {
        let mut request = spawn_request(run_kind);
        request.initial_prompt = prompt.map(str::to_string);
        // The program path of some CLIs depends on what is installed, so compare from argv[1]
        argv(&build_command(&request, "term-forms", 1234, "tok", Some(4567)))[1..].to_vec()
    }

    /// Codex's arguments in Skip mode: its permission flag, then `rest`.
    fn codex_args(rest: &[String]) -> Vec<String> {
        let mut args = vec!["--dangerously-bypass-approvals-and-sandbox".to_string()];
        args.extend_from_slice(rest);
        args
    }

    fn bus_args() -> Vec<String> {
        codex_bus_args("http://127.0.0.1:1234/mcp/7", &codex_notify_program())
    }

    #[test]
    fn each_cli_takes_the_launch_prompt_in_its_own_form() {
        let p = MULTI_LINE_PROMPT;
        assert_eq!(
            args_with_prompt(RunKind::Codex, Some(p)),
            codex_args(&[bus_args(), vec![p.to_string()]].concat())
        );
        assert_eq!(
            args_with_prompt(RunKind::OpenCode, Some(p)),
            ["--port", "4567", "--auto", "--prompt", p]
        );
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
        // Expected values are the arguments each CLI was started with before launch prompts,
        // with Codex's bus overrides after its permission flag and Claude's surface tools allowed
        assert_eq!(args_with_prompt(RunKind::Codex, None), codex_args(&bus_args()));
        assert_eq!(args_with_prompt(RunKind::Pi, None), ["/c", "pi"]);
        assert_eq!(args_with_prompt(RunKind::Gemini, None), ["/c", "gemini"]);
        assert_eq!(args_with_prompt(RunKind::OpenCode, None), ["--port", "4567", "--auto"]);
        assert_eq!(args_with_prompt(RunKind::Kiro, None), ["chat", "--trust-all-tools"]);
        assert_eq!(
            args_with_prompt(RunKind::Antigravity, None),
            ["--dangerously-skip-permissions"]
        );
        assert_eq!(args_with_prompt(RunKind::Aider, None), ["--yes-always"]);
        let claude = args_with_prompt(RunKind::Claude, None);
        assert_eq!(claude[..2], ["--dangerously-skip-permissions", "--allowedTools"]);
        assert_eq!(claude[3], "--mcp-config");
        assert_eq!(claude.len(), 5);
        // A blank prompt counts as none
        assert_eq!(args_with_prompt(RunKind::Codex, Some("  \n")), codex_args(&bus_args()));
    }

    #[test]
    fn codex_joins_the_bus_through_its_overrides_in_both_permission_modes() {
        let notify = Path::new(r"C:\Program Files\Quay\quay-codex-notify.exe");
        assert_eq!(
            codex_bus_args("http://127.0.0.1:4321/mcp/7", notify),
            [
                "-c",
                r#"mcp_servers.quay.url="http://127.0.0.1:4321/mcp/7""#,
                "-c",
                r#"mcp_servers.quay.bearer_token_env_var="QUAY_A2A_TOKEN""#,
                "-c",
                r#"mcp_servers.quay.default_tools_approval_mode="approve""#,
                "-c",
                "mcp_servers.quay.tool_timeout_sec=150",
                "-c",
                r#"notify=["C:\\Program Files\\Quay\\quay-codex-notify.exe"]"#,
            ]
        );

        let expected = codex_bus_args("http://127.0.0.1:4321/mcp/7", &codex_notify_program());
        for mode in [PermissionMode::Normal, PermissionMode::Skip] {
            let mut request = spawn_request(RunKind::Codex);
            request.permission_mode = Some(mode);
            let args = argv(&build_command(&request, "term-codex-bus", 4321, "tok-1", Some(4567)));
            assert!(
                args.windows(expected.len()).any(|w| w == expected.as_slice()),
                "{:?}: {:?}",
                mode,
                args
            );
        }
    }

    #[test]
    fn a_quote_in_the_helper_path_stays_inside_the_toml_string() {
        assert_eq!(toml_string(r#"C:\a "b"\c"#), r#""C:\\a \"b\"\\c""#);
    }

    #[test]
    fn codex_bus_overrides_follow_the_custom_flags_and_precede_the_launch_prompt() {
        let mut request = spawn_request(RunKind::Codex);
        request.permission_mode = Some(PermissionMode::Normal);
        request.custom_flags = Some("--model gpt-5 -c notify=[]".to_string());
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());

        let args = argv(&build_command(&request, "term-codex-order", 1234, "tok-1", Some(4567)));

        let expected: Vec<String> = ["--model", "gpt-5", "-c", "notify=[]"]
            .iter()
            .map(|a| a.to_string())
            .chain(bus_args())
            .chain([MULTI_LINE_PROMPT.to_string()])
            .collect();
        assert_eq!(args[1..], expected);
    }

    #[test]
    fn the_codex_token_stays_off_the_command_line() {
        let cmd = build_command(&spawn_request(RunKind::Codex), "term-codex-tok", 1234, "tok-secret", Some(4567));
        assert!(argv(&cmd).iter().all(|arg| !arg.contains("tok-secret")), "{:?}", argv(&cmd));
        assert_eq!(env_of(&cmd, "QUAY_A2A_TOKEN").as_deref(), Some("tok-secret"));
    }

    #[test]
    fn every_connected_cli_is_wired_to_the_quay_mcp_server_its_own_way() {
        // PiG's line holds its extension only when PiG is installed
        let installs = PigInstalls::new("wired");
        installs.on_path_pig();
        let bridge = pig_bridge_program().to_string_lossy().to_string();
        for run_kind in crate::slices::pty::models::ALL_RUN_KINDS {
            let request = if run_kind == RunKind::Pig { installs.request() } else { spawn_request(run_kind) };
            let cmd = build_command(&request, "term-wired", 1234, "tok", Some(4567));
            let args = argv(&cmd);
            let mcp_config = args.iter().any(|arg| arg == "--mcp-config");
            let codex_override = args.iter().any(|arg| arg.starts_with("mcp_servers.quay.url="));
            let opencode_config = env_of(&cmd, "OPENCODE_CONFIG_CONTENT").is_some();
            let pig_extension = args.windows(2).any(|pair| pair[0] == "-e" && pair[1] == bridge);
            assert_eq!(mcp_config, run_kind == RunKind::Claude, "{:?}: {:?}", run_kind, args);
            assert_eq!(codex_override, run_kind == RunKind::Codex, "{:?}: {:?}", run_kind, args);
            assert_eq!(opencode_config, run_kind == RunKind::OpenCode, "{:?}", run_kind);
            assert_eq!(pig_extension, run_kind == RunKind::Pig, "{:?}: {:?}", run_kind, args);
            assert_eq!(
                mcp_config || codex_override || opencode_config || pig_extension,
                run_kind.is_connected(),
                "{:?}: {:?}",
                run_kind,
                args
            );
        }
    }

    #[test]
    fn the_pig_extension_sits_beside_quay_under_the_name_it_registers() {
        let program = pig_bridge_program();
        assert_eq!(program.parent(), std::env::current_exe().unwrap().parent());
        assert_eq!(
            program.file_name().unwrap().to_string_lossy(),
            format!("quay-pig-bridge{}", std::env::consts::EXE_SUFFIX)
        );
    }

    #[test]
    fn the_codex_turn_end_helper_sits_beside_quay() {
        let program = codex_notify_program();
        assert_eq!(program.parent(), std::env::current_exe().unwrap().parent());
        assert_eq!(
            program.file_name().unwrap().to_string_lossy(),
            format!("quay-codex-notify{}", std::env::consts::EXE_SUFFIX)
        );
    }

    #[test]
    fn pi_never_gets_approve_which_only_trusts_project_files() {
        for mode in [PermissionMode::Skip, PermissionMode::Normal] {
            let mut request = spawn_request(RunKind::Pi);
            request.permission_mode = Some(mode);
            assert_eq!(argv(&build_command(&request, "term-pi", 1234, "tok", Some(4567)))[1..], ["/c", "pi"], "{:?}", mode);
        }
    }

    #[test]
    fn shell_terminals_get_todays_arguments() {
        let shell_args = |run_kind: RunKind, text: Option<&str>| {
            let mut request = spawn_request(run_kind);
            request.command_text = text.map(str::to_string);
            argv(&build_command(&request, "term-shell", 1234, "tok", Some(4567)))
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

    fn env_of(cmd: &CommandBuilder, key: &str) -> Option<String> {
        cmd.get_env(key).map(|v| v.to_string_lossy().to_string())
    }

    const AGENT_KINDS: [RunKind; 12] = [
        RunKind::Claude,
        RunKind::Antigravity,
        RunKind::Codex,
        RunKind::Pi,
        RunKind::Gemini,
        RunKind::Grok,
        RunKind::Aider,
        RunKind::Kiro,
        RunKind::Copilot,
        RunKind::OpenCode,
        RunKind::Pig,
        RunKind::Archon,
    ];

    #[test]
    fn every_agent_terminal_points_core_hooks_path_at_quays_forwarders() {
        for run_kind in AGENT_KINDS {
            let cmd = build_command(&spawn_request(run_kind), "term-stamp", 4321, "tok", Some(4567));
            let count: usize = env_of(&cmd, "GIT_CONFIG_COUNT").unwrap().parse().unwrap();
            let index = count - 1;
            assert_eq!(
                env_of(&cmd, &format!("GIT_CONFIG_KEY_{}", index)).as_deref(),
                Some("core.hooksPath"),
                "{:?}",
                run_kind
            );
            let hooks = env_of(&cmd, &format!("GIT_CONFIG_VALUE_{}", index)).unwrap();
            assert!(Path::new(&hooks).join("prepare-commit-msg").is_file(), "{:?} {}", run_kind, hooks);
            assert_eq!(env_of(&cmd, "QUAY_AGENT_KIND").as_deref(), Some(run_kind.as_str()));
        }
    }

    #[test]
    fn an_agent_terminal_appends_to_a_workspace_git_config_count() {
        let mut request = spawn_request(RunKind::Codex);
        request.env_vars = Some(std::collections::HashMap::from([
            ("GIT_CONFIG_COUNT".to_string(), "1".to_string()),
            ("GIT_CONFIG_KEY_0".to_string(), "user.name".to_string()),
            ("GIT_CONFIG_VALUE_0".to_string(), "Workspace".to_string()),
        ]));

        let cmd = build_command(&request, "term-stamp-preset", 4321, "tok", None);

        assert_eq!(env_of(&cmd, "GIT_CONFIG_COUNT").as_deref(), Some("2"));
        assert_eq!(env_of(&cmd, "GIT_CONFIG_KEY_0").as_deref(), Some("user.name"));
        assert_eq!(env_of(&cmd, "GIT_CONFIG_KEY_1").as_deref(), Some("core.hooksPath"));
    }

    #[test]
    fn a_plain_terminal_gets_no_stamping_env() {
        for run_kind in [RunKind::PowerShell, RunKind::Command] {
            let mut request = spawn_request(run_kind);
            request.env_vars = Some(std::collections::HashMap::from([("QUAY_AGENT_KIND".to_string(), "claude".to_string())]));

            let cmd = build_command(&request, "term-plain", 4321, "tok", None);

            assert_eq!(env_of(&cmd, "QUAY_AGENT_KIND"), None, "{:?}", run_kind);
            assert_eq!(env_of(&cmd, "GIT_CONFIG_COUNT"), None, "{:?}", run_kind);
        }
    }

    #[test]
    fn every_peer_terminal_gets_the_four_quay_variables() {
        for run_kind in [
            RunKind::Claude,
            RunKind::Codex,
            RunKind::OpenCode,
            RunKind::Antigravity,
            RunKind::Copilot,
            RunKind::Kiro,
            RunKind::Gemini,
            RunKind::Grok,
            RunKind::Pi,
            RunKind::Aider,
        ] {
            let cmd = build_command(&spawn_request(run_kind), "term-quay-env", 4321, "tok-1", Some(4567));
            assert_eq!(env_of(&cmd, "QUAY_TERMINAL_ID").as_deref(), Some("term-quay-env"), "{:?}", run_kind);
            assert_eq!(env_of(&cmd, "QUAY_A2A_TOKEN").as_deref(), Some("tok-1"), "{:?}", run_kind);
            assert_eq!(
                env_of(&cmd, "QUAY_MCP_URL").as_deref(),
                Some("http://127.0.0.1:4321/mcp/7"),
                "{:?}",
                run_kind
            );
            assert_eq!(
                env_of(&cmd, "QUAY_EVENTS_URL").as_deref(),
                Some("http://127.0.0.1:4321/v1/events"),
                "{:?}",
                run_kind
            );
        }
    }

    #[test]
    fn shell_and_archon_terminals_get_no_quay_variables() {
        for run_kind in [RunKind::PowerShell, RunKind::Command, RunKind::Archon] {
            let cmd = build_command(&spawn_request(run_kind), "term-no-env", 4321, "tok-1", Some(4567));
            for key in QUAY_ENV_KEYS {
                assert_eq!(env_of(&cmd, key), None, "{:?} got {}", run_kind, key);
            }
        }
    }

    #[test]
    fn workspace_env_vars_never_replace_the_quay_variables() {
        let mut request = spawn_request(RunKind::Codex);
        request.env_vars = Some(
            QUAY_ENV_KEYS
                .iter()
                .map(|key| (key.to_string(), "from-workspace".to_string()))
                .collect(),
        );

        let cmd = build_command(&request, "term-quay-wins", 4321, "tok-1", Some(4567));

        assert_eq!(env_of(&cmd, "QUAY_TERMINAL_ID").as_deref(), Some("term-quay-wins"));
        assert_eq!(env_of(&cmd, "QUAY_A2A_TOKEN").as_deref(), Some("tok-1"));
    }

    #[test]
    fn antigravity_reports_its_turns_with_their_messages_whatever_the_workspace_sets() {
        let mut request = spawn_request(RunKind::Antigravity);
        request.env_vars = Some(
            [("AGY_CLI_OSC7501", "off"), ("AGY_CLI_OSC7501_MESSAGES", "brief")]
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect(),
        );

        let cmd = build_command(&request, "term-agy-osc", 4321, "tok-1", Some(4567));

        assert_eq!(env_of(&cmd, "AGY_CLI_OSC7501").as_deref(), Some("on"));
        assert_eq!(env_of(&cmd, "AGY_CLI_OSC7501_MESSAGES"), None);
    }

    #[test]
    fn no_other_cli_gets_antigravitys_variables() {
        for kind in crate::slices::pty::models::ALL_RUN_KINDS.into_iter().filter(|kind| *kind != RunKind::Antigravity) {
            let mut request = spawn_request(kind);
            request.env_vars = Some([("AGY_CLI_OSC7501_MESSAGES".to_string(), "brief".to_string())].into());

            let cmd = build_command(&request, "term-no-agy", 4321, "tok-1", Some(4567));

            assert_eq!(env_of(&cmd, "AGY_CLI_OSC7501"), None, "{kind:?}");
            assert_eq!(env_of(&cmd, "AGY_CLI_OSC7501_MESSAGES").as_deref(), Some("brief"), "{kind:?}");
        }
    }

    #[test]
    fn workspace_env_vars_never_replace_the_event_bridge_variables() {
        let mut request = spawn_request(RunKind::Claude);
        request.env_vars = Some(
            ["CLAUDE_EVENTS_URL", "CLAUDE_EVENTS_TOKEN", "CLAUDE_EVENTS_TAG"]
                .iter()
                .map(|key| (key.to_string(), "from-workspace".to_string()))
                .collect(),
        );

        let cmd = build_command(&request, "term-bridge-wins", 4321, "tok-1", Some(4567));

        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_URL").as_deref(), Some("http://127.0.0.1:4321"));
        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_TOKEN").as_deref(), Some("tok-1"));
        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_TAG").as_deref(), Some("term-bridge-wins"));
    }

    #[test]
    fn claude_keeps_the_event_bridge_variables_beside_the_quay_ones() {
        let cmd = build_command(&spawn_request(RunKind::Claude), "term-claude-env", 4321, "tok-1", Some(4567));

        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_URL").as_deref(), Some("http://127.0.0.1:4321"));
        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_TOKEN").as_deref(), Some("tok-1"));
        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_TAG").as_deref(), Some("term-claude-env"));
        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_TOOLS").as_deref(), Some("full"));
        assert_eq!(env_of(&cmd, "CLAUDE_EVENTS_PERMISSIONS").as_deref(), Some("off"));
        // The event-bridge plugin reads only Claude's variables
        let codex = build_command(&spawn_request(RunKind::Codex), "term-codex-env", 4321, "tok-1", Some(4567));
        for key in CLAUDE_EVENT_KEYS {
            assert_eq!(env_of(&codex, key), None, "{:?} got {}", RunKind::Codex, key);
        }
    }

    #[test]
    fn opencode_serves_on_its_port_and_gets_the_quay_mcp_server_from_its_config_variable() {
        let cmd = build_command(&spawn_request(RunKind::OpenCode), "term-oc", 4321, "tok-1", Some(4567));

        assert_eq!(argv(&cmd)[1..], ["--port", "4567", "--auto"]);
        let config = env_of(&cmd, "OPENCODE_CONFIG_CONTENT").expect("OpenCode gets its config variable");
        assert!(!config.contains("tok-1"), "the token stays out of the config: {}", config);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&config).unwrap()["mcp"],
            serde_json::json!({
                "quay": {
                    "type": "remote",
                    "url": "http://127.0.0.1:4321/mcp/7",
                    "headers": { "Authorization": "Bearer {env:QUAY_A2A_TOKEN}" },
                    "oauth": false,
                    "timeout": 150000
                }
            })
        );
        assert_eq!(env_of(&cmd, "QUAY_A2A_TOKEN").as_deref(), Some("tok-1"));
    }

    /// `super::build_serve` for launch 7 of `term-oc2`, with Quay's bridge on 4321.
    fn serve_and_tui(request: &SpawnTerminalRequest, server: &OpenCodeServer) -> (std::process::Command, CommandBuilder) {
        let launch = LaunchRef { terminal_id: "term-oc2".to_string(), launch: 7 };
        super::build_serve(request, &launch, 4321, "tok-1", server)
    }

    fn opencode_config(cmd: &CommandBuilder) -> serde_json::Value {
        serde_json::from_str(&env_of(cmd, "OPENCODE_CONFIG_CONTENT").expect("OpenCode's config")).unwrap()
    }

    fn envs_of(serve: &std::process::Command) -> std::collections::BTreeMap<String, String> {
        serve
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_string_lossy().to_string(), v?.to_string_lossy().to_string())))
            .collect()
    }

    #[test]
    fn opencode_2_runs_its_tui_on_the_terminals_server_in_the_project_with_auto_and_the_launch_prompt() {
        let mut request = spawn_request(RunKind::OpenCode);
        request.project_path = "E:\\Projects\\App".to_string();
        request.custom_flags = Some("--model anthropic/x".to_string());
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());

        let (_, tui) = serve_and_tui(&request, &OpenCodeServer::for_tests(4567));

        assert_eq!(
            argv(&tui)[1..],
            [
                "--server",
                "http://127.0.0.1:4567",
                "E:\\Projects\\App",
                "--auto",
                "--model",
                "anthropic/x",
                "--prompt",
                MULTI_LINE_PROMPT
            ]
        );
        assert_eq!(tui.get_cwd().map(|d| d.to_string_lossy().to_string()).as_deref(), Some("E:\\Projects\\App"));

        let mut normal = spawn_request(RunKind::OpenCode);
        normal.permission_mode = Some(PermissionMode::Normal);
        let (_, tui) = serve_and_tui(&normal, &OpenCodeServer::for_tests(4567));
        assert!(!argv(&tui).iter().any(|arg| arg == "--auto"), "{:?}", argv(&tui));
    }

    #[test]
    fn opencode_2s_server_serves_on_loopback_with_the_tuis_environment() {
        let mut request = spawn_request(RunKind::OpenCode);
        request.project_path = "E:\\Projects\\App".to_string();
        request.env_vars = Some([("MY_KEY".to_string(), "mine".to_string())].into_iter().collect());

        let (serve, tui) = serve_and_tui(&request, &OpenCodeServer::for_tests(4567));

        assert_eq!(serve.get_program().to_string_lossy(), argv(&tui)[0]);
        let args: Vec<String> = serve.get_args().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(args, ["serve", "--port", "4567", "--hostname", "127.0.0.1"]);
        assert_eq!(serve.get_current_dir().map(|d| d.to_string_lossy().to_string()).as_deref(), Some("E:\\Projects\\App"));
        let serve_env = envs_of(&serve);
        let tui_env: std::collections::BTreeMap<String, String> =
            tui.iter_full_env_as_str().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(serve_env, tui_env);
        assert_eq!(serve_env.get("MY_KEY").map(String::as_str), Some("mine"));
        assert_eq!(serve_env.get("QUAY_A2A_TOKEN").map(String::as_str), Some("tok-1"));
        assert!(serve_env.contains_key("OPENCODE_CONFIG_CONTENT"));
    }

    #[test]
    fn opencode_2s_password_is_the_launchs_own_in_the_environment_and_never_on_a_command_line() {
        let mut request = spawn_request(RunKind::OpenCode);
        request.initial_prompt = Some("Do the task".to_string());
        // A workspace's own password never stands in for the launch's
        request.env_vars = Some([("OPENCODE_PASSWORD".to_string(), "the-workspaces".to_string())].into_iter().collect());
        let server = OpenCodeServer::for_tests(4567);

        let (serve, tui) = serve_and_tui(&request, &server);

        assert_eq!(env_of(&tui, "OPENCODE_PASSWORD").as_deref(), Some(server.password()));
        assert_eq!(envs_of(&serve).get("OPENCODE_PASSWORD").map(String::as_str), Some(server.password()));
        let serve_args: Vec<String> = serve.get_args().map(|a| a.to_string_lossy().to_string()).collect();
        assert!(!argv(&tui).iter().chain(&serve_args).any(|arg| arg.contains(server.password())));

        // 1.x gets none
        let one = build_command(&spawn_request(RunKind::OpenCode), "term-oc", 4321, "tok-1", Some(4567));
        assert_eq!(env_of(&one, "OPENCODE_PASSWORD"), None);
    }

    #[test]
    fn only_opencode_2_shows_quays_tools_outside_code_mode() {
        let two = opencode_config(&serve_and_tui(&spawn_request(RunKind::OpenCode), &OpenCodeServer::for_tests(4567)).1);
        assert_eq!(two["mcp"]["quay"]["codemode"], false);
        assert_eq!(two["mcp"]["quay"]["url"], "http://127.0.0.1:4321/mcp/7");
        // Skip is `--auto` on the command line, as for 1.x, not a rule in the config allowing all
        assert_ne!(two["permission"], "allow");
        assert_ne!(two["permission"]["*"], "allow");
        assert_eq!(two["permission"]["quay_quay_ask"], "allow");

        let one = build_command(&spawn_request(RunKind::OpenCode), "term-oc", 4321, "tok-1", Some(4567));
        assert_eq!(opencode_config(&one)["mcp"]["quay"].get("codemode"), None);
    }

    #[test]
    fn opencode_without_a_server_port_gets_no_port_flag() {
        let cmd = build_command(&spawn_request(RunKind::OpenCode), "term-oc", 4321, "tok-1", None);
        assert_eq!(argv(&cmd)[1..], ["--auto"]);
    }

    #[test]
    fn a_workspace_opencode_config_keeps_its_settings_and_gains_the_quay_server() {
        let quay = serde_json::json!({
            "type": "remote",
            "url": "http://127.0.0.1:4321/mcp/7",
            "headers": { "Authorization": "Bearer {env:QUAY_A2A_TOKEN}" },
            "oauth": false,
            "timeout": 150000
        });
        let merged = |workspace: &str| -> serde_json::Value {
            serde_json::from_str(&opencode_config_content("http://127.0.0.1:4321/mcp/7", Some(workspace), &[])).unwrap()
        };

        assert_eq!(
            merged(r#"{"model":"anthropic/claude-sonnet-5-5","mcp":{"docs":{"type":"local"},"quay":{"type":"local"}}}"#),
            serde_json::json!({
                "model": "anthropic/claude-sonnet-5-5",
                "mcp": { "docs": { "type": "local" }, "quay": quay }
            })
        );
        assert_eq!(
            merged("{\n  // mine\n  \"model\": \"x\",\n}"),
            serde_json::json!({ "model": "x", "mcp": { "quay": quay } })
        );
        assert_eq!(merged(""), serde_json::json!({ "mcp": { "quay": quay } }));
        assert_eq!(merged(r#"{"mcp":"nonsense"}"#), serde_json::json!({ "mcp": { "quay": quay } }));
        assert_eq!(merged("not json"), serde_json::json!({ "mcp": { "quay": quay } }));
        assert_eq!(merged("[1, 2]"), serde_json::json!({ "mcp": { "quay": quay } }));

        let mut request = spawn_request(RunKind::OpenCode);
        request.env_vars = Some(
            [("OPENCODE_CONFIG_CONTENT".to_string(), r#"{"model":"x"}"#.to_string())]
                .into_iter()
                .collect(),
        );
        let cmd = build_command(&request, "term-oc-ws", 4321, "tok-1", Some(4567));
        let config: serde_json::Value =
            serde_json::from_str(&env_of(&cmd, "OPENCODE_CONFIG_CONTENT").unwrap()).unwrap();
        assert_eq!(config["model"], "x");
        assert_eq!(config["mcp"]["quay"], quay);
    }

    #[test]
    fn opencode_is_found_on_the_path_first_then_in_buns_folder() {
        let root = TempDir::new("opencode-path");
        let on_path = root.join("bin");
        let home = root.join("home");
        let bun_bin = home.join(".bun").join("bin");
        std::fs::create_dir_all(&on_path).unwrap();
        std::fs::create_dir_all(&bun_bin).unwrap();
        let name = opencode_file_name();
        let bun = bun_bin.join(name);
        std::fs::write(&bun, b"").unwrap();
        let path = std::env::join_paths([root.join("empty"), on_path.clone()]).unwrap();

        // Not on the PATH: bun's install
        assert_eq!(opencode_program(Some(&path), Some(&home)), bun.to_string_lossy());
        // On the PATH: its full path there, since a spawn looks a bare name up on Quay's own PATH
        std::fs::write(on_path.join(name), b"").unwrap();
        assert_eq!(opencode_program(Some(&path), Some(&home)), on_path.join(name).to_string_lossy());
        // A relative folder on the PATH is never looked in
        let relative = std::env::join_paths([std::path::PathBuf::from("bin")]).unwrap();
        assert_eq!(opencode_program(Some(&relative), Some(&root.join("nobody"))), name);
        // Neither: the bare name, so the spawn error names it
        assert_eq!(opencode_program(None, Some(&root.join("nobody"))), name);
        assert_eq!(opencode_program(None, None), name);

    }

    /// npm installs OpenCode on Windows as an `opencode.cmd` shim, with no `opencode.exe`.
    #[cfg(windows)]
    #[test]
    fn opencodes_npm_shim_on_the_terminals_path_is_found_by_its_full_path() {
        let root = TempDir::new("opencode-shim");
        let on_path = root.join("npm");
        let home = root.join("home");
        let bun_bin = home.join(".bun").join("bin");
        std::fs::create_dir_all(&on_path).unwrap();
        std::fs::create_dir_all(&bun_bin).unwrap();
        std::fs::write(bun_bin.join("opencode.exe"), b"").unwrap();
        let shim = on_path.join("opencode.cmd");
        std::fs::write(&shim, b"").unwrap();
        let path = std::env::join_paths([root.join("empty"), on_path.clone()]).unwrap();

        // The terminal's PATH wins over bun's install
        assert_eq!(opencode_program(Some(&path), Some(&home)), shim.to_string_lossy());
        // In one folder the executable wins over the shim, as `PATHEXT` orders them
        let exe = on_path.join("opencode.exe");
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(opencode_program(Some(&path), Some(&home)), exe.to_string_lossy());
        // A shim in bun's folder is found when nothing on the PATH is
        std::fs::remove_file(bun_bin.join("opencode.exe")).unwrap();
        std::fs::write(bun_bin.join("opencode.cmd"), b"").unwrap();
        assert_eq!(
            opencode_program(None, Some(&home)),
            bun_bin.join("opencode.cmd").to_string_lossy()
        );
    }

    /// A PTY starts npm's shim through `cmd.exe /c`; `opencode serve` runs the shim itself.
    #[cfg(windows)]
    #[test]
    fn an_opencode_shim_on_the_terminals_path_starts_its_tui_through_cmd_and_its_server_directly() {
        let root = TempDir::new("opencode-shim-launch");
        let shim = root.join("opencode.cmd");
        std::fs::write(&shim, b"").unwrap();
        let shim = shim.to_string_lossy().to_string();
        let mut request = spawn_request(RunKind::OpenCode);
        request.env_vars =
            Some([(PATH_NAME.to_string(), root.to_string_lossy().to_string())].into_iter().collect());

        let cmd = build_command(&request, "term-oc-shim", 4321, "tok-1", Some(4567));
        assert_eq!(argv(&cmd)[..5], ["cmd.exe", "/c", shim.as_str(), "--port", "4567"]);

        let (serve, tui) = serve_and_tui(&request, &OpenCodeServer::for_tests(4567));
        assert_eq!(serve.get_program().to_string_lossy(), shim);
        assert_eq!(argv(&tui)[..5], ["cmd.exe", "/c", shim.as_str(), "--server", "http://127.0.0.1:4567"]);
    }

    /// cmd.exe would cut a multi-line prompt short, so pwsh runs the `.ps1` shim npm puts
    /// beside the `.cmd` one, which hands the prompt on intact.
    #[cfg(windows)]
    #[test]
    fn an_opencode_shims_launch_prompt_goes_through_pwsh_to_its_ps1_sibling() {
        let root = TempDir::new("opencode-shim-prompt");
        std::fs::write(root.join("opencode.cmd"), b"").unwrap();
        let ps1 = root.join("opencode.ps1");
        std::fs::write(&ps1, b"").unwrap();
        let mut request = spawn_request(RunKind::OpenCode);
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());
        request.env_vars =
            Some([(PATH_NAME.to_string(), root.to_string_lossy().to_string())].into_iter().collect());

        let cmd = build_command(&request, "term-oc-shim", 4321, "tok-1", Some(4567));

        assert_eq!(argv(&cmd)[..4], ["pwsh.exe", "-NoProfile", "-NoLogo", "-Command"]);
        assert_eq!(
            argv(&cmd)[4],
            format!("& '{}' '--port' '4567' '--auto' '--prompt' $env:QUAY_LAUNCH_PROMPT", ps1.to_string_lossy())
        );
        assert_eq!(env_of(&cmd, "QUAY_LAUNCH_PROMPT").as_deref(), Some(MULTI_LINE_PROMPT));
    }

    /// The version probe runs npm's shim on the terminal's PATH, not an OpenCode on Quay's.
    /// A probe that can't run reads as 2.x too, so the 1.x shim is what shows it ran.
    #[cfg(windows)]
    #[test]
    fn the_version_probe_runs_the_opencode_shim_on_the_terminals_path() {
        let probed = |version: &str| {
            let root = TempDir::new("opencode-shim-probe");
            let npm = root.join("npm");
            let home = root.join("home");
            std::fs::create_dir_all(&npm).unwrap();
            std::fs::create_dir_all(&home).unwrap();
            std::fs::write(npm.join("opencode.cmd"), format!("@echo {version}\r\n")).unwrap();
            let mut path = vec![npm];
            path.extend(std::env::var_os("PATH").iter().flat_map(std::env::split_paths));
            let mut request = spawn_request(RunKind::OpenCode);
            request.env_vars = Some(
                [
                    (PATH_NAME.to_string(), std::env::join_paths(path).unwrap().to_string_lossy().to_string()),
                    ("USERPROFILE".to_string(), home.to_string_lossy().to_string()),
                ]
                .into_iter()
                .collect(),
            );
            opencode_launch(&request, 4567)
        };

        assert!(matches!(probed("2.4.1"), OpenCodeLaunch::Server(server) if server.port() == 4567));
        assert!(matches!(probed("1.4.0"), OpenCodeLaunch::Tui(4567)));
    }

    /// How the platform spells the variable `terminal_path` reads.
    const PATH_NAME: &str = if cfg!(windows) { "Path" } else { "PATH" };

    #[test]
    fn opencode_looks_on_the_workspaces_path_when_it_sets_one() {
        let mut request = spawn_request(RunKind::OpenCode);
        request.env_vars = Some(
            [(PATH_NAME.to_string(), r"C:\stub-bin".to_string())].into_iter().collect(),
        );
        assert_eq!(terminal_path(&request), Some(std::ffi::OsString::from(r"C:\stub-bin")));
        request.env_vars = None;
        assert_eq!(terminal_path(&request), std::env::var_os("PATH"));
    }

    /// Only on Windows is `Path` the `PATH` the process reads.
    #[cfg(not(windows))]
    #[test]
    fn a_path_spelled_in_another_case_is_not_the_terminals_path() {
        let mut request = spawn_request(RunKind::OpenCode);
        request.env_vars = Some([("Path".to_string(), "/stub-bin".to_string())].into_iter().collect());
        assert_eq!(terminal_path(&request), std::env::var_os("PATH"));
    }

    /// Folders PiG can be installed in, under a fresh temp folder named for `tag`: one on the
    /// `PATH`, npm's prefix and a home folder. Each starts empty.
    struct PigInstalls {
        root: TempDir,
        on_path: PathBuf,
        npm: PathBuf,
        home: PathBuf,
    }

    impl PigInstalls {
        fn new(tag: &str) -> Self {
            let root = TempDir::new(&format!("pig-{tag}"));
            let installs = Self {
                on_path: root.join("bin"),
                npm: root.join("npm"),
                home: root.join("home"),
                root,
            };
            for dir in [&installs.on_path, &installs.npm, &installs.home] {
                std::fs::create_dir_all(dir).unwrap();
            }
            installs
        }

        /// A `PATH` holding an empty folder, npm's prefix and `on_path`, in that order.
        fn path(&self) -> std::ffi::OsString {
            std::env::join_paths([self.root.join("empty"), self.npm.clone(), self.on_path.clone()]).unwrap()
        }

        /// Puts an empty `file` at `dir`, making the folders it needs, and returns its path.
        fn put(&self, dir: PathBuf, file: &str) -> PathBuf {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(file), b"").unwrap();
            dir.join(file)
        }

        fn on_path_pig(&self) -> PathBuf {
            self.put(self.on_path.clone(), pig_file_name())
        }

        fn npm_shim(&self) -> PathBuf {
            self.put(self.npm.clone(), PIG_NPM_SHIM)
        }

        fn npm_pig(&self) -> PathBuf {
            let dir = PIG_NPM_BINARY_DIR.iter().fold(self.npm.clone(), |dir, part| dir.join(part));
            self.put(dir, pig_file_name())
        }

        fn go_pig(&self) -> PathBuf {
            self.put(self.home.join("go").join("bin"), pig_file_name())
        }

        fn found(&self) -> Option<PathBuf> {
            pig_program(Some(&self.path()), Some(&self.home))
        }

        /// A PiG spawn request whose `PATH` and home folder are these folders.
        fn request(&self) -> SpawnTerminalRequest {
            let mut request = spawn_request(RunKind::Pig);
            request.env_vars = Some(
                [
                    (PATH_NAME.to_string(), self.path().to_string_lossy().to_string()),
                    ("USERPROFILE".to_string(), self.home.to_string_lossy().to_string()),
                    ("HOME".to_string(), self.home.to_string_lossy().to_string()),
                ]
                .into_iter()
                .collect(),
            );
            request
        }
    }

    #[test]
    fn pig_on_the_path_is_found_first() {
        let installs = PigInstalls::new("on-path");
        let on_path = installs.on_path_pig();
        installs.npm_shim();
        installs.npm_pig();
        installs.go_pig();
        assert_eq!(installs.found(), Some(on_path));
    }

    #[test]
    fn with_only_npms_shim_on_the_path_pig_is_npms_real_binary() {
        let installs = PigInstalls::new("npm");
        installs.npm_shim();
        let npm = installs.npm_pig();
        installs.go_pig();
        assert_eq!(installs.found(), Some(npm));
    }

    #[test]
    fn npms_binary_is_looked_for_only_behind_its_shim() {
        let installs = PigInstalls::new("npm-no-shim");
        installs.npm_pig();
        assert_eq!(installs.found(), None);
        let go = installs.go_pig();
        assert_eq!(installs.found(), Some(go));
    }

    #[test]
    fn relative_path_entries_and_a_relative_home_are_skipped() {
        // Quay's working directory would otherwise stand in for each of them
        let path = std::env::join_paths([PathBuf::from(""), PathBuf::from(".")]).unwrap();
        let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
        assert!(dirs.iter().all(|dir| !dir.is_absolute()), "{:?}", dirs);
        assert_eq!(pig_program(Some(&path), Some(Path::new(""))), None);
        assert_eq!(pig_program(Some(&path), Some(Path::new("home"))), None);
    }

    #[test]
    fn pig_from_go_install_is_found_last() {
        let installs = PigInstalls::new("go");
        let go = installs.go_pig();
        assert_eq!(installs.found(), Some(go));
        assert_eq!(pig_program(None, Some(&installs.home)), Some(installs.go_pig()));
    }

    #[test]
    fn without_pig_anywhere_it_is_not_installed() {
        let installs = PigInstalls::new("none");
        // npm's shim alone, with its package's binary missing
        installs.npm_shim();
        assert_eq!(installs.found(), None);
        assert_eq!(pig_program(None, None), None);
    }

    #[test]
    fn pig_starts_directly_with_its_extension_then_its_custom_flags_then_the_positional_launch_prompt() {
        let installs = PigInstalls::new("launch");
        let pig = installs.on_path_pig();
        for mode in [PermissionMode::Skip, PermissionMode::Normal] {
            let mut request = installs.request();
            request.permission_mode = Some(mode);
            request.custom_flags = Some("--model sonnet:high -c".to_string());
            request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());
            let cmd = build_command(&request, "term-pig", 4321, "tok-1", Some(4567));
            let bridge = pig_bridge_program();
            assert_eq!(
                argv(&cmd),
                [
                    pig.to_string_lossy().as_ref(),
                    "-e",
                    bridge.to_string_lossy().as_ref(),
                    "--model",
                    "sonnet:high",
                    "-c",
                    MULTI_LINE_PROMPT
                ],
                "{:?}",
                mode
            );
            for key in QUAY_ENV_KEYS {
                assert!(env_of(&cmd, key).is_some(), "{}", key);
            }
        }
    }

    /// The events a session sent, by name and payload.
    fn recorded_events() -> (WebviewEvents, Arc<Mutex<Vec<(String, serde_json::Value)>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let log = sent.clone();
        (WebviewEvents::to(move |event, payload| log.lock().push((event.to_string(), payload))), sent)
    }

    /// The `pty-output` chunks among `sent`, as their seq and text.
    fn output_chunks(sent: &[(String, serde_json::Value)]) -> Vec<(u64, String)> {
        sent.iter()
            .filter(|(event, _)| event == "pty-output")
            .map(|(_, payload)| (payload["seq"].as_u64().unwrap(), payload["data"].as_str().unwrap().to_string()))
            .collect()
    }

    /// What a terminal whose CLI couldn't start showed and how it ended: started as `opencode`
    /// at 24 x 80 after output numbered up to 5, resized three times, then ended by its report.
    struct MessageTerminal {
        /// The `pty-output` chunks it sent, as their seq and text.
        chunks: Vec<(u64, String)>,
        replay: TerminalOutputPayload,
        ran_first_output: bool,
        ran_a_process: bool,
        /// What typing Enter into it answered.
        typed: Result<(), String>,
        /// The exit code `on_exit` had before the report ran, and after.
        exit_before_report: Option<Option<i32>>,
        exit_after_report: Option<Option<i32>>,
        /// The `terminal-exited` payloads it sent.
        ends: Vec<serde_json::Value>,
    }

    fn message_terminal(mut request: SpawnTerminalRequest, terminal_id: &str, opencode: Option<OpenCodeLaunch>) -> MessageTerminal {
        request.rows = Some(24);
        request.cols = Some(80);
        let launch = LaunchRef { terminal_id: terminal_id.to_string(), launch: 7 };
        let (events, sent) = recorded_events();
        let first_output = Arc::new(AtomicBool::new(false));
        let printed = first_output.clone();
        let (exited, exit_code) = std::sync::mpsc::channel();
        let mut session = PtySession::spawn(
            request,
            launch,
            5,
            4321,
            "tok-1".to_string(),
            opencode,
            events,
            Box::new(move || printed.store(true, Ordering::SeqCst)),
            None,
            Box::new(move |code| exited.send(code).unwrap()),
        )
        .unwrap();
        for (rows, cols) in [(30, 100), (20, 60), (40, 160)] {
            session.resize(rows, cols).unwrap();
        }
        let ran_a_process = session.is_alive();
        let typed = session.write("\r");
        let exit_before_report = exit_code.try_recv().ok();
        let report = session.take_exit_report().expect("a session without a process reports its own end");
        assert!(session.take_exit_report().is_none(), "it reports its end once");
        report();
        let sent = sent.lock();
        MessageTerminal {
            chunks: output_chunks(&sent),
            replay: session.get_output(),
            ran_first_output: first_output.load(Ordering::SeqCst),
            ran_a_process,
            typed,
            exit_before_report,
            exit_after_report: exit_code.try_recv().ok(),
            ends: sent.iter().filter(|(event, _)| event == "terminal-exited").map(|(_, payload)| payload.clone()).collect(),
        }
    }

    /// Asserts that `shown` sent one chunk, numbered on from seq 5, holding `phrase` once and
    /// replayed as it was sent, and ended Exited with code 1 only when its report ran.
    fn assert_shown_once_and_ended(shown: &MessageTerminal, terminal_id: &str, phrase: &str) {
        let seqs: Vec<u64> = shown.chunks.iter().map(|(seq, _)| *seq).collect();
        assert_eq!(seqs, [6], "one chunk, numbered on from the seq it started at");
        let sent: String = shown.chunks.iter().map(|(_, text)| text.as_str()).collect();
        assert_eq!(sent.matches(phrase).count(), 1, "{:?}", sent);
        assert!(sent.ends_with("\r\n"), "{:?}", sent);
        assert_eq!(shown.replay.data, sent);
        assert_eq!((shown.replay.last_seq, shown.replay.rows, shown.replay.cols), (6, Some(40), Some(160)));
        assert!(shown.ran_first_output, "the message is the terminal's first output");
        assert!(!shown.ran_a_process);
        assert_eq!(shown.typed, Ok(()), "typing into it is dropped, as an exited process's PTY drops it");
        assert_eq!(shown.exit_before_report, None, "its end waits for the report");
        assert_eq!(shown.exit_after_report, Some(Some(1)));
        assert_eq!(shown.ends, [serde_json::json!({ "terminal_id": terminal_id, "exit_code": 1 })]);
    }

    #[test]
    fn a_pig_terminal_without_pig_shows_its_message_once_across_resizes_and_replay_and_ends_as_a_failure() {
        let installs = PigInstalls::new("message-once");
        let mut request = installs.request();
        request.custom_flags = Some("--model opus".to_string());
        request.initial_prompt = Some("Get-ChildItem; exit".to_string());
        let shown = message_terminal(request, "term-pig-message-once", None);
        assert_shown_once_and_ended(&shown, "term-pig-message-once", "PiG isn't installed.");
        assert_eq!(shown.replay.data, format!("{}\r\n", PIG_NOT_INSTALLED), "the message and nothing else");
    }

    #[test]
    fn an_opencode_2_terminal_whose_server_cannot_start_shows_why_once_and_ends_as_a_failure() {
        let installs = PigInstalls::new("opencode-message-once");
        let mut request = installs.request();
        request.run_kind = RunKind::OpenCode;
        // No folder to start in, so `opencode serve` fails before anything runs
        request.project_path = installs.root.join("no-such-project").to_string_lossy().to_string();
        let server = OpenCodeServer::for_tests(4567);
        let shown = message_terminal(request, "term-oc2-message-once", Some(OpenCodeLaunch::Server(server)));
        assert_shown_once_and_ended(&shown, "term-oc2-message-once", "Quay couldn't start OpenCode's server");
        assert!(shown.replay.data.starts_with("Quay couldn't start OpenCode's server (`opencode serve`): "));
    }

    #[test]
    fn the_not_installed_message_is_the_one_decided() {
        assert_eq!(
            PIG_NOT_INSTALLED,
            "PiG isn't installed. Install it with `npm i -g @pi-in-go/pig` (or `irm \
             https://pi-in-go.dev/install.ps1 | iex` and add its folder to PATH), then run `pig \
             login` once. PiG doesn't use Pi's sign-in."
        );
    }

    /// The text the stand-in bridge's `quay_ping` tool returns.
    const PING_REPLY: &str = "PONG-7731";

    /// What the stand-in bridge answers an `/mcp/7` request with, as its HTTP status line and body,
    /// the way Quay's MCP server does: `GET` with 405, a notification with 202 and no body, and a
    /// JSON-RPC request with one tool, `quay_ping`.
    fn stand_in_mcp(method: &str, body: &str) -> (&'static str, String) {
        if method == "GET" {
            return ("405 Method Not Allowed", String::new());
        }
        let request: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
        if request.get("id").is_none() {
            return ("202 Accepted", String::new());
        }
        let result = match request["method"].as_str().unwrap_or_default() {
            "initialize" => serde_json::json!({
                "protocolVersion": request["params"]["protocolVersion"].as_str().unwrap_or("2024-11-05"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "quay-a2a", "version": "1.0.0" }
            }),
            "tools/list" => serde_json::json!({ "tools": [{
                "name": "quay_ping",
                "description": "Answers with a fixed word.",
                "inputSchema": { "type": "object", "properties": {} }
            }] }),
            "tools/call" => serde_json::json!({ "content": [{ "type": "text", "text": PING_REPLY }] }),
            _ => serde_json::json!({}),
        };
        ("200 OK", serde_json::json!({ "jsonrpc": "2.0", "id": request["id"], "result": result }).to_string())
    }

    /// A stand-in for Quay's bridge on a free loopback port. It keeps each `POST /v1/events`
    /// body and each request's method, path and `Authorization` header, in order, and
    /// answers `/mcp/7` as `stand_in_mcp` does and anything else `200` with no body.
    #[allow(clippy::type_complexity)]
    fn recording_bridge() -> (
        u16,
        Arc<parking_lot::Mutex<Vec<(String, serde_json::Value)>>>,
        Arc<parking_lot::Mutex<Vec<String>>>,
    ) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let posts = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let requests = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let seen = posts.clone();
        let heard = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let seen = seen.clone();
                let heard = heard.clone();
                std::thread::spawn(move || {
                    let mut stream = stream;
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                    let mut request = Vec::new();
                    let mut buf = [0u8; 8192];
                    while let Ok(n) = stream.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        request.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&request).to_string();
                        if let Some(end) = text.find("\r\n\r\n") {
                            let length = text[..end]
                                .lines()
                                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length: ").map(str::to_string))
                                .and_then(|l| l.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            if request.len() >= end + 4 + length {
                                break;
                            }
                        }
                    }
                    let text = String::from_utf8_lossy(&request).to_string();
                    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
                    let mut start = head.lines().next().unwrap_or_default().split_whitespace();
                    let (method, path) = (start.next().unwrap_or_default(), start.next().unwrap_or_default());
                    let auth = head
                        .lines()
                        .find_map(|l| {
                            let (name, value) = l.split_once(':')?;
                            name.eq_ignore_ascii_case("authorization").then(|| value.trim().to_string())
                        })
                        .unwrap_or_default();
                    heard.lock().push(format!("{} {} {}", method, path, auth));
                    if method == "POST" && path == "/v1/events" {
                        if let Ok(body) = serde_json::from_str(body) {
                            seen.lock().push((auth, body));
                        }
                    }
                    let (status, reply) =
                        if path == "/mcp/7" { stand_in_mcp(method, body) } else { ("200 OK", String::new()) };
                    let _ = stream.write_all(
                        format!(
                            "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            status,
                            reply.len(),
                            reply
                        )
                        .as_bytes(),
                    );
                });
            }
        });
        (port, posts, requests)
    }

    /// Launches the real PiG TUI the way Quay does, with Quay's PiG extension and a launch
    /// prompt, against a stand-in bridge, and checks the extension's two jobs: PiG calls the
    /// bridge's MCP tool with the terminal's token, and the extension reports the session
    /// start, then the turn's start and its end with PiG's answer, each tagged with the
    /// terminal and sent with its token. Needs PiG installed and signed in with `pig login`,
    /// and the extension built, which any build of the app does. Run with
    /// `cargo test live_pig_reports_its_turn_to_the_bridge -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_pig_reports_its_turn_to_the_bridge() {
        // Put the built extension where Quay looks for it, beside this test binary
        let built = crate::test_support::relay::built_sidecar(PIG_BRIDGE_NAME);
        std::fs::copy(&built, pig_bridge_program()).expect("the app's build builds quay-pig-bridge");

        let (port, posts, requests) = recording_bridge();
        let project = TempDir::new("live-pig");
        let mut request = spawn_request(RunKind::Pig);
        request.project_path = project.to_string_lossy().to_string();
        // So the check leaves no session behind in PiG's own folder
        request.custom_flags = Some("--no-session".to_string());
        request.initial_prompt = Some(
            "Call the quay_ping tool, then reply with only the exact text it returned.".to_string(),
        );
        let cmd = build_command(&request, "term-live-pig", port, "tok-live", None);
        println!("argv: {:?}", cmd.get_argv());
        assert!(!starts_through_cmd(&cmd), "PiG must start directly");

        let pair = native_pty_system()
            .openpty(PtySize { rows: 40, cols: 140, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut child = pair.slave.spawn_command(cmd).expect("spawn pig");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = Arc::new(parking_lot::Mutex::new(pair.master.take_writer().unwrap()));
        let answers = writer.clone();
        let screen = Arc::new(parking_lot::Mutex::new(String::new()));
        let shown = screen.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                // Answer ConPTY's cursor-position query so the TUI starts
                if text.contains("\x1b[6n") {
                    let _ = answers.lock().write_all(b"\x1b[1;1R");
                }
                shown.lock().push_str(&text);
            }
        });

        let events = || -> Vec<(String, serde_json::Value)> {
            posts
                .lock()
                .iter()
                .flat_map(|(auth, body)| {
                    body["events"].as_array().cloned().unwrap_or_default().into_iter().map(|e| (auth.clone(), e))
                })
                .collect()
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        while std::time::Instant::now() < deadline
            && !events().iter().any(|(_, e)| e["type"] == "turn.completed")
        {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let _ = child.kill();

        let events = events();
        for (_, event) in &events {
            println!("{} {}", event["type"], event["data"]);
        }
        let requests = requests.lock().clone();
        println!("requests: {:?}", requests);
        let tail: String = screen.lock().chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
        let types: Vec<&str> = events.iter().map(|(_, e)| e["type"].as_str().unwrap_or_default()).collect();
        assert_eq!(types, ["session.started", "turn.started", "turn.completed"], "screen:\n{}", tail);
        for (auth, event) in &events {
            assert_eq!(auth, "Bearer tok-live");
            assert_eq!(event["tag"], "term-live-pig");
        }
        // The text came from the tool, so PiG reached it through Quay's MCP server
        assert!(events[2].1["data"]["answer"].as_str().unwrap().contains(PING_REPLY), "{}", events[2].1);
        let mcp: Vec<&String> = requests.iter().filter(|r| r.contains(" /mcp/7 ")).collect();
        assert!(!mcp.is_empty());
        for request in mcp {
            assert!(request.ends_with(" Bearer tok-live"), "{}", request);
        }
    }

    #[test]
    fn npm_shim_clis_take_the_launch_prompt_through_pwsh_not_cmd() {
        // cmd.exe ends a command line at its first newline, so a multi-line launch prompt
        // reaches pi and gemini through pwsh, which hands the shim each argument intact
        let mut request = spawn_request(RunKind::Pi);
        request.custom_flags = Some("--model it's".to_string());
        request.initial_prompt = Some(MULTI_LINE_PROMPT.to_string());
        let cmd = build_command(&request, "term-pi", 1234, "tok", Some(4567));
        assert_eq!(
            argv(&cmd)[1..],
            [
                "-NoProfile",
                "-NoLogo",
                "-Command",
                "& 'pi' '--model' 'it''s' $env:QUAY_LAUNCH_PROMPT",
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
        let dir = TempDir::new("launch-prompt");
        let out = dir.join("args.json");
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
        let cmd = build_command(&request, "term-pi-e2e", 1234, "tok", Some(4567));

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

        assert_eq!(recorded, [MULTI_LINE_PROMPT]);
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
    fn test_append_output_continues_from_start_seq() {
        // A relaunched session's buffer starts at the old session's last seq
        let mut buffer = ("old scrollback".to_string(), 41u64);

        assert_eq!(append_output(&mut buffer, "PS> ", 256 * 1024), 42);
        assert_eq!(append_output(&mut buffer, "echo hi", 256 * 1024), 43);
        assert_eq!(buffer.1, 43);
        assert_eq!(buffer.0, "old scrollbackPS> echo hi");
    }

    #[test]
    fn test_append_output_new_terminal_starts_at_one() {
        let mut buffer = (String::new(), 0u64);
        assert_eq!(append_output(&mut buffer, "hello", 256 * 1024), 1);
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

    #[test]
    fn mcp_config_arg_is_inline_json_that_reads_the_token_from_the_environment() {
        let arg = mcp_config_arg("http://127.0.0.1:4123/mcp/7");

        assert!(!arg.contains('\n'), "inline config must be one line: {:?}", arg);
        let parsed: serde_json::Value = serde_json::from_str(&arg).expect("inline config is JSON");
        assert_eq!(
            parsed,
            serde_json::json!({
                "mcpServers": {
                    "quay": {
                        "type": "http",
                        "url": "http://127.0.0.1:4123/mcp/7",
                        "headers": { "Authorization": "Bearer ${CLAUDE_EVENTS_TOKEN}" },
                        "timeout": 150000
                    }
                }
            })
        );
    }
}

