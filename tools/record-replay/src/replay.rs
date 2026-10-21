//! Replay mode: the fake CLI. Plays a recording into Quay's terminal and re-issues its bridge
//! calls against the live bridge, each at its recorded offset into the run.
//!
//! The replay keeps the recording's causality where the live run can be slower than the
//! recorded one: anything recorded after a bridge call answered waits for the replayed call to
//! answer, and everything after that is pushed back by the wait.

use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::console;
use crate::http::{self, Live, Request};
use crate::recording::{self, Call, CastEvent, Keys, TAG_PLACEHOLDER};

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
    let start = Instant::now();
    // Seconds the replay runs behind the recording, from waits on the live bridge.
    let mut behind = 0.0;
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
            behind = f64::max(behind, start.elapsed().as_secs_f64() - t);
        }
        sleep_until(start + Duration::from_secs_f64(t + behind));

        match item {
            Item::Cast(event) => match event.code.as_str() {
                "o" => {
                    let _ = out.write_all(event.data.as_bytes());
                    let _ = out.flush();
                }
                // A prompt submitted in the recording: wait for one to be submitted here, so
                // the turn it started begins after it arrives, however late that is.
                "i" if recording::enters(&event.data) > 0 => {
                    used_enters += recording::enters(&event.data);
                    while entered.load(Ordering::SeqCst) < used_enters {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    behind = f64::max(behind, start.elapsed().as_secs_f64() - t);
                }
                "x" => exit_code = event.data.trim().parse().ok(),
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

fn sleep_until(when: Instant) {
    let now = Instant::now();
    if when > now {
        std::thread::sleep(when - now);
    }
}
