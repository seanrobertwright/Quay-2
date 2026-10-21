//! A recording: one terminal's whole run of a tutorial, as two gzipped files in the
//! tutorial's recordings folder.
//!
//! - `<cli>-<n>.cast.gz`: the terminal stream as an asciicast v2 file. Its header carries the
//!   terminal's `width` and `height`, when the run started as `timestamp` (Unix seconds) and,
//!   when the real CLI answered `--version`, the first line of its answer as `cli_version`; its
//!   events are output (`o`), keystrokes (`i`), resizes
//!   (`r`), step markers (`m`) and, when the CLI exited by itself, its exit code (`x`, as
//!   asciicast v3 names it).
//!
//! - `<cli>-<n>.http.jsonl.gz`: the terminal's calls to the bridge, one JSON object a line in
//!   the order they arrived: `t` (seconds into the run) and `d` (seconds until the bridge
//!   answered), `method`, `path`, `headers`, `body`, and the bridge's `status` and `response`.
//!   Bodies that are JSON are kept as JSON. No authentication header is kept, the bearer token
//!   is blanked wherever it appears, and the terminal's id is written as `{{tag}}`.
//!
//! Step markers are made with `quay-record-replay mark <folder> <NN-what>`, which appends the
//! name to the folder's `.step-markers` file; every recording in progress in the folder marks
//! it at that moment, and a terminal that starts later marks the latest one at its start.
//!
//! `<cli>` is the CLI the tool impersonated and `<n>` counts that CLI's terminals in the order
//! they started, from 1.
//!
//! While a run is being recorded the files are written uncompressed, an event a line, so a run
//! cut short still leaves everything up to the cut; they are gzipped when the CLI exits.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use crate::http::{Request, Response, is_hop_header};

pub const CAST: &str = "cast";
pub const HTTP_LOG: &str = "http.jsonl";
/// The file `mark` appends step markers to, one name a line, while a run is recorded.
pub const MARKERS: &str = ".step-markers";
/// What a recording has in place of the recorded terminal's id.
pub const TAG_PLACEHOLDER: &str = "{{tag}}";

/// In `QUAY_REPLAY_STATE`, the file a capture script writes the replay speed to, as a number:
/// `1` plays in real time, `10` ten times as fast. Every replay in the capture reads it.
pub const SPEED: &str = "speed";
/// In `QUAY_REPLAY_STATE`, the file a capture script writes a step marker's name to. A replay
/// that reaches that marker, or a later one, holds there until the file names a later step or
/// is removed. With no file, nothing holds.
pub const RUN_TO: &str = "run-to";
/// The extension of the file in `QUAY_REPLAY_STATE` where a replay lists, one a line, each step
/// marker it has reached: `<recording>.markers`.
pub const REACHED: &str = "markers";

/// What an event in a recording's asciicast is, and the code the file gives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CastCode {
    /// Output the CLI wrote to the terminal (`o`).
    Output,
    /// Text typed into the terminal (`i`).
    Input,
    /// The terminal resized, as `<cols>x<rows>` (`r`).
    Resize,
    /// A step marker's name (`m`).
    Marker,
    /// The CLI's exit code (`x`).
    Exit,
}

impl CastCode {
    const ALL: [CastCode; 5] = [CastCode::Output, CastCode::Input, CastCode::Resize, CastCode::Marker, CastCode::Exit];

    pub fn as_str(self) -> &'static str {
        match self {
            CastCode::Output => "o",
            CastCode::Input => "i",
            CastCode::Resize => "r",
            CastCode::Marker => "m",
            CastCode::Exit => "x",
        }
    }

    /// The event a code in the file names, or None for a code recordings don't use.
    pub fn parse(code: &str) -> Option<CastCode> {
        CastCode::ALL.into_iter().find(|c| c.as_str() == code)
    }
}

/// What a recording's asciicast header says about its run.
pub struct Header {
    pub cols: u16,
    pub rows: u16,
    /// When the run started, in Unix seconds.
    pub timestamp: Option<u64>,
    /// The first line of the real CLI's answer to `--version`.
    pub cli_version: Option<String>,
}

pub struct Recorder {
    start: Instant,
    cast_path: PathBuf,
    http_path: PathBuf,
    secret: Option<String>,
    tag: Option<String>,
    inner: Mutex<Inner>,
}

struct Inner {
    /// None once the recording is finished; later events are dropped.
    cast: Option<BufWriter<File>>,
    http: Option<BufWriter<File>>,
    pending_output: Vec<u8>,
    /// The end of the output so far when it could be the start of the token, kept back until
    /// the next output shows whether it is.
    held_output: String,
    keys: Keys,
}

impl Recorder {
    /// Starts the next recording for `cli` in `dir`. `secret` (the terminal's bearer token) is
    /// blanked out of everything recorded, and `tag` (the terminal's id) out of the HTTP log;
    /// either may be empty.
    pub fn create(dir: &Path, cli: &str, header: Header, secret: &str, tag: &str) -> Result<Recorder, String> {
        check_recordings_dir(dir)?;
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let (cast_path, cast) = claim(dir, cli)?;
        let mut cast = BufWriter::new(cast);
        let mut header_json = serde_json::json!({ "version": 2, "width": header.cols, "height": header.rows });
        if let Some(timestamp) = header.timestamp {
            header_json["timestamp"] = timestamp.into();
        }
        if let Some(version) = header.cli_version {
            header_json["cli_version"] = version.into();
        }
        let header = header_json;
        writeln!(cast, "{header}").and_then(|_| cast.flush()).map_err(|e| e.to_string())?;
        let http_path = cast_path.with_extension(HTTP_LOG);
        let http = File::create(&http_path).map_err(|e| format!("cannot create {}: {e}", http_path.display()))?;
        Ok(Recorder {
            start: Instant::now(),
            cast_path,
            http_path,
            secret: Some(secret.to_string()).filter(|s| !s.is_empty()),
            tag: Some(tag.to_string()).filter(|s| !s.is_empty()),
            inner: Mutex::new(Inner { cast: Some(cast), http: Some(BufWriter::new(http)), pending_output: Vec::new(), held_output: String::new(), keys: Keys::default() }),
        })
    }

    pub fn output(&self, bytes: &[u8]) {
        let mut inner = self.inner.lock().unwrap();
        let mut text = std::mem::take(&mut inner.held_output);
        text.push_str(&take_utf8(&mut inner.pending_output, bytes));
        if let Some(secret) = &self.secret {
            text = text.replace(secret.as_str(), "<token>");
            let held = (1..secret.len().min(text.len() + 1))
                .rev()
                .find(|&k| secret.is_char_boundary(k) && text.ends_with(&secret[..k]))
                .unwrap_or(0);
            inner.held_output = text.split_off(text.len() - held);
        }
        self.event(&mut inner, CastCode::Output, &text);
    }

    fn release_held_output(&self, inner: &mut Inner) {
        let held = std::mem::take(&mut inner.held_output);
        self.event(inner, CastCode::Output, &held);
    }

    /// Records keystrokes as the text they type (see `Keys`), while the CLI itself gets the
    /// bytes as they came.
    pub fn input(&self, bytes: &[u8]) {
        let mut inner = self.inner.lock().unwrap();
        let typed = inner.keys.feed(bytes);
        self.event(&mut inner, CastCode::Input, &typed);
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let mut inner = self.inner.lock().unwrap();
        self.event(&mut inner, CastCode::Resize, &format!("{cols}x{rows}"));
    }

    pub fn marker(&self, name: &str) {
        let mut inner = self.inner.lock().unwrap();
        self.event(&mut inner, CastCode::Marker, name);
    }

    pub fn exit(&self, code: i32) {
        let mut inner = self.inner.lock().unwrap();
        self.release_held_output(&mut inner);
        self.event(&mut inner, CastCode::Exit, &code.to_string());
    }

    /// Logs one bridge call that arrived `t` seconds into the run and took `d` seconds.
    pub fn http(&self, t: f64, d: f64, request: &Request, answer: &Result<Response, String>) {
        let headers: serde_json::Map<String, serde_json::Value> = request
            .headers
            .iter()
            .filter(|(k, _)| !is_hop_header(k) && !k.contains("authorization"))
            .map(|(k, v)| (k.clone(), v.clone().into()))
            .collect();
        let mut entry = serde_json::json!({
            "t": round(t),
            "d": round(d),
            "method": request.method,
            "path": request.target,
            "headers": headers,
            "body": body_value(&request.body),
        });
        match answer {
            Ok(response) => {
                entry["status"] = response.status.into();
                entry["response"] = body_value(&response.body);
            }
            Err(error) => {
                entry["status"] = 502.into();
                entry["error"] = error.clone().into();
            }
        }
        let mut line = self.scrub(&entry.to_string());
        if let Some(tag) = &self.tag {
            line = line.replace(tag.as_str(), TAG_PLACEHOLDER);
        }
        let mut inner = self.inner.lock().unwrap();
        if let Some(http) = inner.http.as_mut() {
            let _ = writeln!(http, "{line}").and_then(|_| http.flush());
        }
    }

    fn event(&self, inner: &mut Inner, code: CastCode, data: &str) {
        if data.is_empty() {
            return;
        }
        let Some(cast) = inner.cast.as_mut() else { return };
        let line = serde_json::json!([round(self.now()), code.as_str(), self.scrub(data)]);
        let _ = writeln!(cast, "{line}").and_then(|_| cast.flush());
    }

    /// Seconds since the recording started.
    pub fn now(&self) -> f64 {
        (self.start.elapsed().as_micros() as f64) / 1_000_000.0
    }

    fn scrub(&self, text: &str) -> String {
        match &self.secret {
            Some(secret) if text.contains(secret.as_str()) => text.replace(secret.as_str(), "<token>"),
            _ => text.to_string(),
        }
    }

    /// Gzips the recording's files and removes the uncompressed ones.
    pub fn finish(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        self.release_held_output(&mut inner);
        let (Some(cast), Some(http)) = (inner.cast.take(), inner.http.take()) else { return Ok(()) };
        cast.into_inner().map_err(|e| e.to_string())?;
        http.into_inner().map_err(|e| e.to_string())?;
        gzip_in_place(&self.cast_path)?;
        gzip_in_place(&self.http_path)
    }
}

/// Whether `name` is a step marker's name: two digits, a hyphen, then lower-case words joined
/// by hyphens, like `06-reply-quoted`. It is the name of the step's screenshot.
pub fn is_marker_name(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() > 3
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b'-'
        && name[3..].split('-').all(|w| !w.is_empty() && w.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

/// A step marker's step number, the `NN` its name starts with.
pub fn marker_step(name: &str) -> Option<u32> {
    is_marker_name(name).then(|| name[..2].parse().ok()).flatten()
}

/// Appends a step marker to the recordings folder `dir`, for the recordings in progress there.
pub fn mark(dir: &Path, name: &str) -> Result<(), String> {
    if !is_marker_name(name) {
        return Err(format!("{name:?} is not a step marker; name it NN-<what>, like 06-reply-quoted"));
    }
    check_recordings_dir(dir)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let path = dir.join(MARKERS);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    writeln!(file, "{name}").map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Ends a capture in the recordings folder `dir`: gzips the files of every run Quay closed
/// before its CLI exited, and removes the step markers file. Run it once every terminal is
/// closed.
pub fn finish(dir: &Path) -> Result<usize, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    let mut finished = 0;
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        if !(name.ends_with(&format!(".{CAST}")) || name.ends_with(&format!(".{HTTP_LOG}"))) {
            continue;
        }
        if gz_path(&path).exists() {
            return Err(format!("both {name} and {name}.gz exist; remove the one that is not wanted"));
        }
        gzip_in_place(&path).map_err(|e| format!("{e} (is a terminal still recording?)"))?;
        finished += 1;
    }
    let markers = dir.join(MARKERS);
    if markers.exists() {
        std::fs::remove_file(&markers).map_err(|e| format!("cannot remove {}: {e}", markers.display()))?;
    }
    Ok(finished)
}

/// Seconds to the microsecond, so a recording doesn't carry float noise.
fn round(seconds: f64) -> f64 {
    (seconds * 1_000_000.0).round() / 1_000_000.0
}

/// A body as JSON when it is JSON, else as text.
fn body_value(body: &[u8]) -> serde_json::Value {
    let text = String::from_utf8_lossy(body);
    if text.trim().is_empty() {
        return serde_json::Value::Null;
    }
    serde_json::from_str(&text).unwrap_or_else(|_| text.into_owned().into())
}

/// Recordings live beside the tool, one folder per tutorial, never under `docs/`.
fn check_recordings_dir(dir: &Path) -> Result<(), String> {
    let under_docs = dir.components().any(|c| matches!(c, Component::Normal(name) if name.eq_ignore_ascii_case("docs")));
    if under_docs {
        return Err(format!("{} is under a docs folder; recordings never live under docs/", dir.display()));
    }
    Ok(())
}

/// Creates `<cli>-<n>.cast` for the lowest `n` no recording or recorder has taken yet.
fn claim(dir: &Path, cli: &str) -> Result<(PathBuf, File), String> {
    for n in 1..10_000 {
        let path = dir.join(format!("{cli}-{n}.{CAST}"));
        if gz_path(&path).exists() {
            continue;
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("cannot create {}: {e}", path.display())),
        }
    }
    Err(format!("no free recording name for {cli} in {}", dir.display()))
}

pub fn gz_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".gz");
    PathBuf::from(name)
}

fn gzip_in_place(path: &Path) -> Result<(), String> {
    let data = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let out = File::create(gz_path(path)).map_err(|e| format!("cannot write {}.gz: {e}", path.display()))?;
    let mut gz = flate2::write::GzEncoder::new(out, flate2::Compression::best());
    gz.write_all(&data).and_then(|_| gz.finish().map(|_| ())).map_err(|e| e.to_string())?;
    std::fs::remove_file(path).map_err(|e| format!("cannot remove {}: {e}", path.display()))
}

/// Decodes as much of `pending` + `bytes` as is whole UTF-8, keeping a split character's
/// leading bytes for the next call. Bytes that are not UTF-8 at all become U+FFFD.
fn take_utf8(pending: &mut Vec<u8>, bytes: &[u8]) -> String {
    pending.extend_from_slice(bytes);
    let mut out = String::new();
    let mut rest: &[u8] = pending;
    loop {
        match std::str::from_utf8(rest) {
            Ok(text) => {
                out.push_str(text);
                rest = &[];
                break;
            }
            Err(e) => {
                let (good, bad) = rest.split_at(e.valid_up_to());
                out.push_str(std::str::from_utf8(good).unwrap());
                match e.error_len() {
                    Some(len) => {
                        out.push('\u{FFFD}');
                        rest = &bad[len..];
                    }
                    None => {
                        rest = bad;
                        break;
                    }
                }
            }
        }
    }
    let keep = rest.to_vec();
    *pending = keep;
    out
}

/// Turns the bytes a console reads into the text they type. ConPTY sends keys in
/// win32-input-mode once a CLI's console asks for it, and the console answers cursor queries
/// on the same input; both are decoded or dropped, and a sequence split across reads waits for
/// its rest.
#[derive(Default)]
pub struct Keys {
    pending_bytes: Vec<u8>,
    pending_sequence: String,
}

impl Keys {
    pub fn feed(&mut self, bytes: &[u8]) -> String {
        let mut held = std::mem::take(&mut self.pending_sequence);
        held.push_str(&take_utf8(&mut self.pending_bytes, bytes));
        let (typed, rest) = keystrokes(&held);
        self.pending_sequence = rest;
        typed
    }
}

/// How many times `typed` presses Enter, counting `\r\n` once.
pub fn enters(typed: &str) -> usize {
    let mut count = 0;
    let mut previous = '\0';
    for c in typed.chars() {
        if c == '\r' || (c == '\n' && previous != '\r') {
            count += 1;
        }
        previous = c;
    }
    count
}

/// The text a run of console input types, and any trailing escape sequence still incomplete.
/// A win32-input-mode key (`ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _`) types its character `Uc` on
/// key down; a cursor position report (`ESC [ row ; col R`) types nothing. Anything else is
/// kept as it is.
fn keystrokes(input: &str) -> (String, String) {
    let mut typed = String::new();
    let mut rest = input;
    while let Some(at) = rest.find('\x1b') {
        typed.push_str(&rest[..at]);
        let seq = &rest[at..];
        if !seq.starts_with("\x1b[") {
            if seq.len() == 1 {
                return (typed, seq.to_string());
            }
            typed.push('\x1b');
            rest = &seq[1..];
            continue;
        }
        let body = &seq[2..];
        let Some(end) = body.find(|c: char| !(c.is_ascii_digit() || c == ';')) else {
            return (typed, seq.to_string());
        };
        let params: Vec<u32> = body[..end].split(';').map(|p| p.parse().unwrap_or(0)).collect();
        let final_char = body[end..].chars().next().unwrap_or('_');
        match final_char {
            '_' => {
                if params.len() == 6 && params[3] == 1 && params[2] != 0 {
                    typed.extend(char::from_u32(params[2]));
                }
            }
            'R' => {}
            _ => typed.push_str(&seq[..2 + end + final_char.len_utf8()]),
        }
        rest = &body[end + final_char.len_utf8()..];
    }
    typed.push_str(rest);
    (typed, String::new())
}

/// One event of a recorded asciicast.
#[derive(Debug, Clone)]
pub struct CastEvent {
    pub t: f64,
    pub code: CastCode,
    pub data: String,
}

/// One logged bridge call.
#[derive(Debug, Clone)]
pub struct Call {
    pub t: f64,
    pub d: f64,
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: serde_json::Value,
}

/// A recording read back for replay.
#[derive(Debug)]
pub struct Recording {
    pub name: String,
    pub events: Vec<CastEvent>,
    pub calls: Vec<Call>,
}

/// Takes the next recording of `cli` in `dir` that no replay has taken yet, so the terminals a
/// tutorial opens with the same CLI get its recordings in the order they were recorded. Each
/// take is a `<cli>-<n>.claim` file in `state`, which a capture starts empty.
pub fn claim_for_replay(dir: &Path, state: &Path, cli: &str) -> Result<Recording, String> {
    std::fs::create_dir_all(state).map_err(|e| format!("cannot create {}: {e}", state.display()))?;
    for n in 1.. {
        let name = format!("{cli}-{n}");
        if !gz_path(&dir.join(format!("{name}.{CAST}"))).exists() {
            return Err(format!("no recording of {cli} left to replay in {} (replayed {})", dir.display(), n - 1));
        }
        match OpenOptions::new().write(true).create_new(true).open(state.join(format!("{name}.claim"))) {
            Ok(_) => return load(dir, &name),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("cannot claim {name} in {}: {e}", state.display())),
        }
    }
    unreachable!()
}

/// Reads recording `name` from `dir`, rejecting anything that is not in the recording format.
/// Events with a code recordings don't use are skipped, as asciicast players skip them.
pub fn load(dir: &Path, name: &str) -> Result<Recording, String> {
    let cast_path = gz_path(&dir.join(format!("{name}.{CAST}")));
    let cast = gunzip(&cast_path)?;
    let at = |line: usize| format!("{}:{}", cast_path.display(), line + 1);
    let mut lines = cast.lines().enumerate();
    let (_, header) = lines.next().ok_or_else(|| format!("{} is empty", cast_path.display()))?;
    let header: serde_json::Value = serde_json::from_str(header).map_err(|e| format!("{}: {e}", at(0)))?;
    if header["version"] != 2 || !header["width"].is_u64() || !header["height"].is_u64() {
        return Err(format!("{}: not an asciicast v2 header with width and height", at(0)));
    }
    let mut events = Vec::new();
    for (i, line) in lines.filter(|(_, l)| !l.trim().is_empty()) {
        let value: serde_json::Value = serde_json::from_str(line).map_err(|e| format!("{}: {e}", at(i)))?;
        match (value[0].as_f64(), value[1].as_str(), value[2].as_str()) {
            (Some(t), Some(code), Some(data)) if t.is_finite() && t >= 0.0 => {
                if let Some(code) = CastCode::parse(code) {
                    events.push(CastEvent { t, code, data: data.to_string() })
                }
            }
            _ => return Err(format!("{}: not an event [seconds, code, data]", at(i))),
        }
    }

    let http_path = gz_path(&dir.join(format!("{name}.{HTTP_LOG}")));
    let log = gunzip(&http_path)?;
    let mut calls = Vec::new();
    for (i, line) in log.lines().enumerate().filter(|(_, l)| !l.trim().is_empty()) {
        let bad = |what: &str| format!("{}:{}: {what}", http_path.display(), i + 1);
        let entry: serde_json::Value = serde_json::from_str(line).map_err(|e| bad(&e.to_string()))?;
        let seconds = |key: &str| entry[key].as_f64().filter(|s| s.is_finite() && *s >= 0.0);
        let (Some(t), Some(d), Some(method), Some(path)) =
            (seconds("t"), seconds("d"), entry["method"].as_str(), entry["path"].as_str())
        else {
            return Err(bad("a call needs t, d, method and path"));
        };
        if !path.starts_with('/') || method.is_empty() {
            return Err(bad("a call's path starts with / and it has a method"));
        }
        let mut headers = Vec::new();
        for (k, v) in entry["headers"].as_object().into_iter().flatten() {
            let v = v.as_str().ok_or_else(|| bad("header values are strings"))?;
            headers.push((k.clone(), v.to_string()));
        }
        calls.push(Call { t, d, method: method.into(), path: path.into(), headers, body: entry["body"].clone() });
    }
    Ok(Recording { name: name.to_string(), events, calls })
}

fn gunzip(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let mut text = String::new();
    std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(file), &mut text)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_split_across_reads_of_the_terminal_is_not_recorded() {
        let dir = std::env::temp_dir().join(format!("quay-record-replay-split-token-{}", std::process::id()));
        let token = "tok-0123456789abcdef";
        let header = Header { cols: 80, rows: 24, timestamp: None, cli_version: None };
        let recorder = Recorder::create(&dir, "claude", header, token, "").unwrap();
        recorder.output(b"token: tok-0123");
        recorder.output(b"456789abcdef and tok-");
        recorder.output(b"012 is not it");
        recorder.finish().unwrap();

        let cast = gunzip(&dir.join("claude-1.cast.gz")).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        let output: String = cast
            .lines()
            .skip(1)
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())
            .filter(|e| e[1] == "o")
            .map(|e| e[2].as_str().unwrap().to_string())
            .collect();
        assert_eq!(output, "token: <token> and tok-012 is not it");
    }
}
