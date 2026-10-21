//! Replay mode: the fake CLI. Plays a recording into Quay's terminal and re-issues its bridge
//! calls against the live bridge, each at its recorded offset into the run.
//!
//! The replay keeps the recording's causality where the live run can be slower than the
//! recorded one: anything recorded after a bridge call answered waits for the replayed call to
//! answer, and everything after that is pushed back by the wait.
//!
//! A capture script steers every replay in a capture through files in the state folder: it
//! sets the speed they all play at, names the step marker they all hold at, and reads the
//! markers each one has reached (see `recording::SPEED`, `RUN_TO` and `REACHED`).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::console;
use crate::http::{self, Live, Request};
use crate::recording::{self, Call, CastCode, CastEvent, Keys, TAG_PLACEHOLDER};

enum Item<'a> {
    Cast(&'a CastEvent),
    Call(&'a Call),
}

impl Item<'_> {
    fn t(&self) -> f64 {
        match self {
            Item::Cast(e) => e.t,
            Item::Call(c) => c.t,
        }
    }
}

/// A replayed call still out, and when the recorded one answered.
struct Outstanding {
    answered_at: f64,
    done: Arc<AtomicBool>,
}

pub fn run(cli: &str, replay_dir: &Path, state_dir: &Path) -> Result<i32, String> {
    let recording = recording::claim_for_replay(replay_dir, state_dir, cli)?;
    let live = Arc::new(Live::from_env()?);
    // The terminal is the replay's screen, so a call the bridge refuses is reported here.
    let errors = Arc::new(state_dir.join(format!("{}.errors", recording.name)));

    let mut items: Vec<Item> = recording.events.iter().map(Item::Cast).collect();
    items.extend(recording.calls.iter().map(Item::Call));
    items.sort_by(|a, b| a.t().total_cmp(&b.t()));

    let _raw = console::RawMode::enter();
    let entered = count_enters();
    // Enters the replay has waited for so far.
    let mut used_enters = 0;
    let mut clock = Clock::new(Speed::new(state_dir, errors.clone()));
    let mut outstanding: Vec<Outstanding> = Vec::new();
    let mut out = std::io::stdout();
    let mut exit_code = None;

    for item in &items {
        let t = item.t();
        let waited = outstanding.iter().filter(|o| o.answered_at <= t).fold(false, |waited, o| {
            let mut waited = waited;
            while !o.done.load(Ordering::SeqCst) {
                waited = true;
                std::thread::sleep(Duration::from_millis(5));
            }
            waited
        });
        outstanding.retain(|o| o.answered_at > t);
        if waited {
            clock.catch_up(t);
        }
        clock.wait_until(t);

        match item {
            Item::Cast(event) => match event.code {
                CastCode::Output => {
                    let _ = out.write_all(event.data.as_bytes());
                    let _ = out.flush();
                }
                // A prompt submitted in the recording: wait for one to be submitted here, so
                // the turn it started begins after it arrives, however late that is.
                CastCode::Input if recording::enters(&event.data) > 0 => {
                    used_enters += recording::enters(&event.data);
                    while entered.load(Ordering::SeqCst) < used_enters {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    clock.catch_up(t);
                }
                CastCode::Marker => {
                    report(&state_dir.join(format!("{}.{}", recording.name, recording::REACHED)), &event.data);
                    if hold_at(state_dir, &event.data) {
                        clock.catch_up(t);
                    }
                }
                CastCode::Exit => exit_code = event.data.trim().parse().ok(),
                _ => {}
            },
            Item::Call(call) => {
                let Some(request) = live.bridge.as_ref().map(|_| request_for(call, &live)) else { continue };
                let done = Arc::new(AtomicBool::new(false));
                outstanding.push(Outstanding { answered_at: call.t + call.d, done: done.clone() });
                let live = live.clone();
                let errors = errors.clone();
                std::thread::spawn(move || {
                    let host = live.bridge.as_deref().unwrap_or_default();
                    let failure = match http::send(host, &request) {
                        Ok(response) if (200..300).contains(&response.status) => None,
                        Ok(response) => Some(format!("HTTP {} {}", response.status, String::from_utf8_lossy(&response.body))),
                        Err(error) => Some(error),
                    };
                    if let Some(failure) = failure {
                        report(&errors, &format!("{} {}: {failure}", request.method, request.target));
                    }
                    done.store(true, Ordering::SeqCst);
                });
            }
        }
    }

    match exit_code {
        Some(code) => {
            for o in &outstanding {
                while !o.done.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            Ok(code)
        }
        // The recorded CLI was still running when the run was cut, so the replay stays on its
        // last screen until Quay closes the terminal.
        None => loop {
            std::thread::sleep(Duration::from_secs(3600));
        },
    }
}

/// The recorded call as the live terminal makes it: the terminal's id wherever the recording
/// has `{{tag}}` and on every event envelope, the event time now, and the live bearer token.
fn request_for(call: &Call, live: &Live) -> Request {
    let fill = |s: &str| s.replace(TAG_PLACEHOLDER, &live.tag);
    let mut body = call.body.clone();
    if let Some(events) = body.get_mut("events").and_then(|e| e.as_array_mut()) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        for event in events.iter_mut().filter_map(|e| e.as_object_mut()) {
            event.insert("tag".into(), live.tag.clone().into());
            if event.contains_key("ts") {
                event.insert("ts".into(), now.into());
            }
        }
    }
    let body = match &body {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => fill(text),
        json => fill(&json.to_string()),
    };
    let mut headers: Vec<(String, String)> = call.headers.iter().map(|(k, v)| (k.clone(), fill(v))).collect();
    headers.push(("authorization".into(), format!("Bearer {}", live.token)));
    Request { method: call.method.clone(), target: fill(&call.path), headers, body: body.into_bytes() }
}

/// Counts the Enters typed into the terminal from now on. Anything else typed is dropped: the
/// recording already shows the CLI's echo of what was typed when it was made.
fn count_enters() -> Arc<AtomicUsize> {
    let entered = Arc::new(AtomicUsize::new(0));
    let counter = entered.clone();
    std::thread::spawn(move || {
        let mut keys = Keys::default();
        let mut input = std::io::stdin();
        let mut buf = [0u8; 4096];
        while let Ok(n) = input.read(&mut buf) {
            if n == 0 {
                break;
            }
            counter.fetch_add(recording::enters(&keys.feed(&buf[..n])), Ordering::SeqCst);
        }
    });
    entered
}

fn report(path: &Path, line: &str) {
    let file = std::fs::OpenOptions::new().create(true).append(true).open(path);
    if let Ok(mut file) = file {
        let _ = writeln!(file, "{line}");
    }
}

/// Holds while the capture's run-to marker is at or before `marker`'s step. Returns whether it
/// held.
fn hold_at(state_dir: &Path, marker: &str) -> bool {
    let Some(step) = recording::marker_step(marker) else { return false };
    let run_to = state_dir.join(recording::RUN_TO);
    // A read that fails while the script replaces the file keeps the hold; only a missing
    // file or a later step releases it.
    let holds = || match std::fs::read_to_string(&run_to) {
        Ok(name) => recording::marker_step(name.trim()).is_none_or(|to| to <= step),
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    };
    let mut held = false;
    while holds() {
        held = true;
        std::thread::sleep(Duration::from_millis(20));
    }
    held
}

/// The replay speed the capture sets in the state folder, read at most every 50 ms. With no
/// speed file the replay plays in real time; a speed that is not a positive number is reported
/// once, and it or a failed read leaves the replay at the speed it had.
struct Speed {
    file: PathBuf,
    errors: Arc<PathBuf>,
    current: f64,
    read_at: Option<Instant>,
    reported: Option<String>,
}

impl Speed {
    fn new(state_dir: &Path, errors: Arc<PathBuf>) -> Self {
        Speed { file: state_dir.join(recording::SPEED), errors, current: 1.0, read_at: None, reported: None }
    }

    fn get(&mut self) -> f64 {
        if self.read_at.is_some_and(|at| at.elapsed() < Duration::from_millis(50)) {
            return self.current;
        }
        self.read_at = Some(Instant::now());
        match std::fs::read_to_string(&self.file) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => self.current = 1.0,
            // The script is replacing the file; keep the speed until it reads.
            Err(_) => {}
            Ok(text) => match text.trim().parse::<f64>() {
                Ok(speed) if speed.is_finite() && speed > 0.0 => self.current = speed,
                _ if self.reported.as_deref() == Some(text.as_str()) => {}
                _ => {
                    let line = format!("{}: {text:?} is not a positive number; kept speed {}", self.file.display(), self.current);
                    report(&self.errors, &line);
                    self.reported = Some(text);
                }
            },
        }
        self.current
    }
}

/// Where the replay is in the recording, in recorded seconds, moving at the capture's speed.
struct Clock {
    speed: Speed,
    at: f64,
    since: Instant,
    rate: f64,
}

impl Clock {
    fn new(mut speed: Speed) -> Self {
        let rate = speed.get();
        Clock { speed, at: 0.0, since: Instant::now(), rate }
    }

    fn now(&self) -> f64 {
        self.at + self.since.elapsed().as_secs_f64() * self.rate
    }

    /// Sets the clock back to `t` when a wait has carried it past `t`, so what follows keeps its
    /// recorded pace from now.
    fn catch_up(&mut self, t: f64) {
        if self.now() > t {
            self.at = t;
            self.since = Instant::now();
        }
    }

    /// Sleeps until the clock reaches `t`, following any change of speed on the way.
    fn wait_until(&mut self, t: f64) {
        loop {
            let rate = self.speed.get();
            if rate != self.rate {
                self.at = self.now();
                self.since = Instant::now();
                self.rate = rate;
            }
            let ahead = t - self.now();
            if ahead <= 0.0 {
                return;
            }
            std::thread::sleep(Duration::from_secs_f64((ahead / self.rate).min(0.05)));
        }
    }
}
