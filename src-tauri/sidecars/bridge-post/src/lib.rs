//! Posts agent events to Quay's bridge, for the sidecars Quay points a CLI at: the Codex
//! turn-end helper and the PiG extension. A sidecar runs inside the CLI's process tree, so
//! the bridge URL, terminal id and bearer token come from the `QUAY_*` variables Quay sets
//! on the terminal, and the token never touches disk or a command line.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const EVENTS_URL_VAR: &str = "QUAY_EVENTS_URL";
pub const TERMINAL_ID_VAR: &str = "QUAY_TERMINAL_ID";
pub const TOKEN_VAR: &str = "QUAY_A2A_TOKEN";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// A log starts over once it reaches this size.
pub const LOG_CAP: u64 = 256 * 1024;

/// Where and as whom a sidecar posts, from the terminal's environment.
#[derive(Debug, PartialEq)]
pub struct Bridge {
    pub events_url: EventsUrl,
    pub tag: String,
    pub token: String,
}

impl Bridge {
    /// The bridge named by `QUAY_EVENTS_URL`, `QUAY_TERMINAL_ID` and `QUAY_A2A_TOKEN`, as `var`
    /// reads them. Each is required, and none may hold a control character, which could
    /// split the request.
    pub fn from_env(var: &dyn Fn(&str) -> Option<String>) -> Result<Bridge, String> {
        let required = |name: &str| {
            let value = var(name).filter(|v| !v.is_empty()).ok_or(format!("{} is not set", name))?;
            if value.chars().any(char::is_control) {
                return Err(format!("{} holds a control character", name));
            }
            Ok(value)
        };
        Ok(Bridge {
            events_url: parse_events_url(&required(EVENTS_URL_VAR)?)?,
            tag: required(TERMINAL_ID_VAR)?,
            token: required(TOKEN_VAR)?,
        })
    }

    /// Posts `body`, a `/v1/events` request body, with the terminal's token, and returns the
    /// bridge's status code.
    pub fn post(&self, body: &str) -> Result<u16, String> {
        post_events(&self.events_url, &self.token, body)
    }
}

/// The bridge's event endpoint. Quay's bridge listens on loopback only, so a sidecar sends
/// the terminal's token nowhere else.
#[derive(Debug, PartialEq)]
pub struct EventsUrl {
    pub port: u16,
    pub host: String,
    pub path: String,
}

/// Parses `http://127.0.0.1:<port>/<path>` (or `localhost`), as Quay sets `QUAY_EVENTS_URL`.
pub fn parse_events_url(url: &str) -> Result<EventsUrl, String> {
    parse_loopback_url(EVENTS_URL_VAR, url)
}

/// Parses the variable `name`'s value `url` as `http://127.0.0.1:<port>/<path>` (or
/// `localhost`), the form of each URL Quay sets on a terminal. A URL anywhere else is refused,
/// since requests to it carry the terminal's token.
pub fn parse_loopback_url(name: &str, url: &str) -> Result<EventsUrl, String> {
    let bad = |why: &str| format!("{} {:?} {}", name, url, why);
    let rest = url.strip_prefix("http://").ok_or_else(|| bad("is not an http:// URL"))?;
    let (authority, path) = rest
        .find('/')
        .map(|at| rest.split_at(at))
        .ok_or_else(|| bad("has no path"))?;
    let (host, port) = authority.rsplit_once(':').ok_or_else(|| bad("has no port"))?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err(bad("is not on loopback"));
    }
    let port = match port.parse::<u16>() {
        Ok(number) if number != 0 && port.bytes().all(|b| b.is_ascii_digit()) => number,
        _ => return Err(bad("has no port from 1 to 65535")),
    };
    if path.contains(['?', '#']) {
        return Err(bad("has a query or fragment"));
    }
    Ok(EventsUrl { port, host: host.to_string(), path: path.to_string() })
}

/// Posts `body` to the bridge with the terminal's bearer token and returns the bridge's
/// status code. Every step has a timeout, and nothing follows a redirect.
pub fn post_events(url: &EventsUrl, token: &str, body: &str) -> Result<u16, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, url.port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("can't reach the bridge on port {}: {}", url.port, e))?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(|e| e.to_string())?;

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        url.path,
        url.host,
        url.port,
        token,
        body.len(),
        body
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("can't send to the bridge: {}", e))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("no answer from the bridge: {}", e))?;
    let status = status_code(&response).ok_or("the bridge's answer is not HTTP")?;
    if (200..300).contains(&status) {
        Ok(status)
    } else {
        Err(format!("the bridge answered {}", status))
    }
}

/// The status code on an HTTP/1.x response's status line.
fn status_code(response: &[u8]) -> Option<u16> {
    let line = response.split(|&b| b == b'\n').next()?;
    let line = std::str::from_utf8(line).ok()?;
    let mut parts = line.split_whitespace();
    parts.next().filter(|version| version.starts_with("HTTP/1."))?;
    parts.next()?.parse().ok()
}

/// The log `file_name` in Quay's data folder: `%LOCALAPPDATA%\Quay2`, or `.quay2` in the
/// user's home. `None` when neither is known, since a sidecar runs in the CLI's project
/// folder and a relative log would land in the user's repository.
pub fn log_path(var: &dyn Fn(&str) -> Option<String>, file_name: &str) -> Option<PathBuf> {
    let set = |name: &str| var(name).filter(|value| !value.is_empty());
    let dir = match set("LOCALAPPDATA") {
        Some(local) => PathBuf::from(local).join("Quay2"),
        None => PathBuf::from(set("USERPROFILE").or_else(|| set("HOME"))?).join(".quay2"),
    };
    Some(dir.join(file_name))
}

/// Appends `line` to the log at `path`, starting the log over once it reaches `LOG_CAP`.
/// A log that can't be written is skipped: the event matters more than its record.
pub fn append_log(path: &Path, line: &str) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let full = std::fs::metadata(path).is_ok_and(|meta| meta.len() >= LOG_CAP);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!full)
        .truncate(full)
        .open(path);
    if let Ok(mut file) = file {
        let _ = writeln!(file, "{}", line);
    }
}

/// Milliseconds since the Unix epoch, as an envelope's `ts`.
pub fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Helpers for a sidecar's tests: a stand-in environment and a stand-in bridge. A sidecar
/// gets them through the `testing` feature, in its dev-dependencies only.
#[cfg(any(test, feature = "testing"))]
pub mod testing {
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    /// An environment holding only `pairs`.
    pub fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |name: &str| map.get(name).cloned()
    }

    /// A bridge on a free loopback port that answers each of `requests` requests with
    /// `status` and hands back the raw requests it got, in order.
    pub fn fake_bridge(status: &str, requests: usize) -> (u16, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let status = status.to_string();
        let handle = std::thread::spawn(move || {
            (0..requests)
                .map(|_| {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                    let mut request = Vec::new();
                    let mut buf = [0u8; 4096];
                    loop {
                        let n = stream.read(&mut buf).unwrap();
                        request.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&request).to_string();
                        if let Some(head_end) = text.find("\r\n\r\n") {
                            let length: usize = text
                                .lines()
                                .find_map(|l| l.strip_prefix("Content-Length: "))
                                .unwrap()
                                .parse()
                                .unwrap();
                            if request.len() >= head_end + 4 + length {
                                break;
                            }
                        }
                        if n == 0 {
                            break;
                        }
                    }
                    let _ = stream.write_all(format!("HTTP/1.1 {}\r\nContent-Length: 0\r\n\r\n", status).as_bytes());
                    String::from_utf8_lossy(&request).to_string()
                })
                .collect()
        });
        (port, handle)
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{env_of, fake_bridge};
    use super::*;

    #[test]
    fn the_events_url_must_be_loopback_http_with_a_port_and_path() {
        assert_eq!(
            parse_events_url("http://127.0.0.1:50362/v1/events"),
            Ok(EventsUrl { port: 50362, host: "127.0.0.1".into(), path: "/v1/events".into() })
        );
        assert!(parse_events_url("http://localhost:1/v1/events").is_ok());
        assert_eq!(
            parse_loopback_url("QUAY_MCP_URL", "http://example.com:1/mcp").unwrap_err(),
            r#"QUAY_MCP_URL "http://example.com:1/mcp" is not on loopback"#
        );
        for bad in [
            "https://127.0.0.1:50362/v1/events",
            "http://example.com:50362/v1/events",
            "http://user@127.0.0.1:50362/v1/events",
            "http://127.0.0.1/v1/events",
            "http://127.0.0.1:50362",
            "http://127.0.0.1:0/v1/events",
            "http://127.0.0.1:65536/v1/events",
            "http://127.0.0.1:+80/v1/events",
            "http://127.0.0.1:abc/v1/events",
            "http://127.0.0.1:50362/v1/events?x=1",
            "",
        ] {
            let err = parse_events_url(bad).unwrap_err();
            assert!(err.contains("QUAY_EVENTS_URL"), "{bad}: {err}");
        }
    }

    #[test]
    fn each_bridge_variable_is_required_and_named_when_missing() {
        let full = [
            ("QUAY_EVENTS_URL", "http://127.0.0.1:4000/v1/events"),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "tok"),
        ];
        let bridge = Bridge::from_env(&env_of(&full)).unwrap();
        assert_eq!(bridge.tag, "term-codex");
        assert_eq!(bridge.token, "tok");

        for name in ["QUAY_EVENTS_URL", "QUAY_TERMINAL_ID", "QUAY_A2A_TOKEN"] {
            let without: Vec<_> = full.iter().copied().filter(|(k, _)| *k != name).collect();
            let err = Bridge::from_env(&env_of(&without)).unwrap_err();
            assert_eq!(err, format!("{} is not set", name));

            let empty: Vec<_> = full
                .iter()
                .map(|&(k, v)| if k == name { (k, "") } else { (k, v) })
                .collect();
            assert_eq!(Bridge::from_env(&env_of(&empty)).unwrap_err(), format!("{} is not set", name));
        }
    }

    #[test]
    fn a_token_that_could_split_the_request_is_refused() {
        let env = env_of(&[
            ("QUAY_EVENTS_URL", "http://127.0.0.1:4000/v1/events"),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "tok\r\nX-Evil: 1"),
        ]);
        assert_eq!(
            Bridge::from_env(&env).unwrap_err(),
            "QUAY_A2A_TOKEN holds a control character"
        );
    }

    #[test]
    fn a_post_carries_the_terminals_token_and_a_refusal_is_a_failure() {
        let (port, bridge) = fake_bridge("200 OK", 1);
        let url = parse_events_url(&format!("http://127.0.0.1:{}/v1/events", port)).unwrap();
        assert_eq!(post_events(&url, "tok-1", r#"{"events":[]}"#), Ok(200));
        let request = bridge.join().unwrap().remove(0);
        let (head, body) = request.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("POST /v1/events HTTP/1.1\r\n"), "{head}");
        assert!(head.contains("\r\nAuthorization: Bearer tok-1\r\n"), "{head}");
        assert!(head.contains(&format!("\r\nHost: 127.0.0.1:{}\r\n", port)), "{head}");
        assert!(head.contains("\r\nContent-Type: application/json\r\n"), "{head}");
        assert_eq!(body, r#"{"events":[]}"#);

        let (port, bridge) = fake_bridge("401 Unauthorized", 1);
        let url = parse_events_url(&format!("http://127.0.0.1:{}/v1/events", port)).unwrap();
        assert_eq!(post_events(&url, "stale", "{}"), Err("the bridge answered 401".to_string()));
        bridge.join().unwrap();
    }

    #[test]
    fn the_log_sits_in_quays_data_folder_and_never_in_the_project() {
        let name = "sidecar.log";
        assert_eq!(
            log_path(&env_of(&[("LOCALAPPDATA", "C:\\Local")]), name),
            Some(PathBuf::from("C:\\Local").join("Quay2").join(name))
        );
        let home = Some(PathBuf::from("C:\\Home").join(".quay2").join(name));
        assert_eq!(log_path(&env_of(&[("LOCALAPPDATA", ""), ("USERPROFILE", "C:\\Home")]), name), home);
        assert_eq!(log_path(&env_of(&[("HOME", "C:\\Home")]), name), home);
        assert_eq!(log_path(&env_of(&[("LOCALAPPDATA", ""), ("USERPROFILE", "")]), name), None);
    }

    #[test]
    fn the_log_starts_over_once_it_is_full() {
        let dir = std::env::temp_dir().join(format!("quay-bridge-post-{}", std::process::id()));
        let path = dir.join("sidecar.log");
        let _ = std::fs::remove_file(&path);

        append_log(&path, "first");
        append_log(&path, "second");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\nsecond\n");

        std::fs::write(&path, vec![b'x'; LOG_CAP as usize]).unwrap();
        append_log(&path, "fresh");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "fresh\n");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
