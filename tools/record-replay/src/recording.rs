//! A recording: one terminal's whole run of a tutorial, as two gzipped files in the
//! tutorial's recordings folder.
//!
//! - `<cli>-<n>.cast.gz`: the terminal stream as an asciicast v2 file. Its header carries the
//!   terminal's `width` and `height`; its events are output (`o`), keystrokes (`i`), resizes
//!   (`r`), step markers (`m`) and, when the CLI exited by itself, its exit code (`x`, as
//!   asciicast v3 names it).
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

pub const CAST: &str = "cast";

pub struct Recorder {
    start: Instant,
    cast_path: PathBuf,
    secret: Option<String>,
    inner: Mutex<Inner>,
}

struct Inner {
    /// None once the recording is finished; later events are dropped.
    cast: Option<BufWriter<File>>,
    pending_output: Vec<u8>,
    pending_input: Vec<u8>,
    /// An escape sequence split across reads, kept until the rest arrives.
    pending_keys: String,
}

impl Recorder {
    /// Starts the next recording for `cli` in `dir`. `secret` (the terminal's bearer token) is
    /// blanked out of everything recorded.
    pub fn create(dir: &Path, cli: &str, cols: u16, rows: u16, secret: Option<String>) -> Result<Recorder, String> {
        check_recordings_dir(dir)?;
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let (cast_path, cast) = claim(dir, cli)?;
        let mut cast = BufWriter::new(cast);
        let header = serde_json::json!({ "version": 2, "width": cols, "height": rows });
        writeln!(cast, "{header}").and_then(|_| cast.flush()).map_err(|e| e.to_string())?;
        Ok(Recorder {
            start: Instant::now(),
            cast_path,
            secret: secret.filter(|s| !s.is_empty()),
            inner: Mutex::new(Inner { cast: Some(cast), pending_output: Vec::new(), pending_input: Vec::new(), pending_keys: String::new() }),
        })
    }

    pub fn output(&self, bytes: &[u8]) {
        let mut inner = self.inner.lock().unwrap();
        let text = take_utf8(&mut inner.pending_output, bytes);
        self.event(&mut inner, "o", &text);
    }

    /// Records keystrokes as the text they type. ConPTY sends keys in win32-input-mode once the
    /// CLI's console asks for it; those, and the console's replies to cursor queries, are
    /// decoded or dropped here, while the CLI itself gets the bytes as they came.
    pub fn input(&self, bytes: &[u8]) {
        let mut inner = self.inner.lock().unwrap();
        let mut held = std::mem::take(&mut inner.pending_keys);
        held.push_str(&take_utf8(&mut inner.pending_input, bytes));
        let (typed, rest) = keystrokes(&held);
        inner.pending_keys = rest;
        self.event(&mut inner, "i", &typed);
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let mut inner = self.inner.lock().unwrap();
        self.event(&mut inner, "r", &format!("{cols}x{rows}"));
    }

    pub fn exit(&self, code: i32) {
        let mut inner = self.inner.lock().unwrap();
        self.event(&mut inner, "x", &code.to_string());
    }

    fn event(&self, inner: &mut Inner, code: &str, data: &str) {
        if data.is_empty() {
            return;
        }
        let Some(cast) = inner.cast.as_mut() else { return };
        let line = serde_json::json!([self.seconds(), code, self.scrub(data)]);
        let _ = writeln!(cast, "{line}").and_then(|_| cast.flush());
    }

    fn seconds(&self) -> f64 {
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
        let Some(cast) = inner.cast.take() else { return Ok(()) };
        cast.into_inner().map_err(|e| e.to_string())?;
        gzip_in_place(&self.cast_path)
    }
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

/// The text a run of console input types, and any trailing escape sequence still incomplete.
/// A win32-input-mode key (`ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _`) types its character `Uc` on
/// key down; a cursor position report (`ESC [ row ; col R`) types nothing. Anything else is
/// kept as it is.
fn keystrokes(input: &str) -> (String, String) {
    let mut typed = String::new();
    let mut rest = input;
    while let Some(at) = rest.find('') {
        typed.push_str(&rest[..at]);
        let seq = &rest[at..];
        if !seq.starts_with("[") {
            if seq.len() == 1 {
                return (typed, seq.to_string());
            }
            typed.push('');
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
