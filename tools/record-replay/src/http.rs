//! Just enough HTTP/1.1 to stand between an agent CLI and Quay's loopback bridge, which
//! answers every request with one whole body.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

/// How long a call to the bridge may take. The bridge holds `/v1/permission` open for up to
/// ten minutes while a human decides, so this is a little longer than that.
pub const BRIDGE_TIMEOUT: Duration = Duration::from_secs(11 * 60);

/// Headers that describe one connection rather than the request, or that a hop sets itself.
const HOP_HEADERS: [&str; 6] = ["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade"];

pub fn is_hop_header(name: &str) -> bool {
    HOP_HEADERS.iter().any(|h| h.eq_ignore_ascii_case(name))
}

#[derive(Debug, Clone)]
pub struct Request {
    pub method: String,
    /// The path and query, as the request line has them.
    pub target: String,
    /// Header names in lower case, in the order they came.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Reads one request, or None when the client closed the connection before starting one.
pub fn read_request(reader: &mut impl BufRead) -> Result<Option<Request>, String> {
    let mut line = String::new();
    if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target), Some(_version)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(format!("malformed request line {line:?}"));
    };
    let headers = read_headers(reader)?;
    let body = read_body(reader, &headers, false)?;
    Ok(Some(Request { method: method.to_string(), target: target.to_string(), headers, body }))
}

fn read_response(reader: &mut impl BufRead) -> Result<Response, String> {
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.trim_end().splitn(3, ' ');
    let status = parts
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("malformed status line {line:?}"))?;
    let reason = parts.next().unwrap_or("").to_string();
    let headers = read_headers(reader)?;
    let body = read_body(reader, &headers, true)?;
    Ok(Response { status, reason, headers, body })
}

fn read_headers(reader: &mut impl BufRead) -> Result<Vec<(String, String)>, String> {
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            return Err("connection closed inside the headers".into());
        }
        let line = line.trim_end();
        if line.is_empty() {
            return Ok(headers);
        }
        let (name, value) = line.split_once(':').ok_or_else(|| format!("malformed header {line:?}"))?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
}

fn read_body(reader: &mut impl BufRead, headers: &[(String, String)], until_close: bool) -> Result<Vec<u8>, String> {
    let get = |name: &str| headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
    if get("transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked")) {
        return read_chunked(reader);
    }
    if let Some(len) = get("content-length") {
        let len: usize = len.parse().map_err(|_| format!("bad content-length {len:?}"))?;
        let mut body = vec![0; len];
        reader.read_exact(&mut body).map_err(|e| e.to_string())?;
        return Ok(body);
    }
    let mut body = Vec::new();
    if until_close {
        reader.read_to_end(&mut body).map_err(|e| e.to_string())?;
    }
    Ok(body)
}

fn read_chunked(reader: &mut impl BufRead) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        let size = line.trim().split(';').next().unwrap_or("");
        let size = usize::from_str_radix(size, 16).map_err(|_| format!("bad chunk size {line:?}"))?;
        if size == 0 {
            // Trailers, then the blank line that ends them.
            read_headers(reader)?;
            return Ok(body);
        }
        let start = body.len();
        body.resize(start + size, 0);
        reader.read_exact(&mut body[start..]).map_err(|e| e.to_string())?;
        let mut crlf = [0u8; 2];
        reader.read_exact(&mut crlf).map_err(|e| e.to_string())?;
    }
}

/// Sends `request` to the server at `host` (`127.0.0.1:<port>`) on a connection of its own and
/// returns the whole response. Hop headers in `request` are replaced; redirects are returned,
/// never followed.
pub fn send(host: &str, request: &Request) -> Result<Response, String> {
    let mut stream = TcpStream::connect(host).map_err(|e| format!("cannot reach {host}: {e}"))?;
    stream.set_read_timeout(Some(BRIDGE_TIMEOUT)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(30))).map_err(|e| e.to_string())?;
    let mut head = format!("{} {} HTTP/1.1\r\nHost: {host}\r\n", request.method, request.target);
    for (name, value) in request.headers.iter().filter(|(k, _)| !is_hop_header(k)) {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", request.body.len()));
    stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&request.body)).map_err(|e| e.to_string())?;
    read_response(&mut BufReader::new(stream))
}

/// Writes `response` back to a client, whole, with its hop headers replaced.
pub fn write_response(out: &mut impl Write, response: &Response, close: bool) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {} {}\r\n", response.status, response.reason);
    for (name, value) in response.headers.iter().filter(|(k, _)| !is_hop_header(k)) {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\n", response.body.len()));
    if close {
        head.push_str("Connection: close\r\n");
    }
    head.push_str("\r\n");
    out.write_all(head.as_bytes())?;
    out.write_all(&response.body)?;
    out.flush()
}

/// The `host:port` of the bridge `CLAUDE_EVENTS_URL` names, which Quay always gives as
/// `http://127.0.0.1:<port>`.
pub fn bridge_host(url: &str) -> Result<String, String> {
    let bad = || format!("CLAUDE_EVENTS_URL {url:?} is not http://<host>:<port>");
    let rest = url.strip_prefix("http://").ok_or_else(bad)?.trim_end_matches('/');
    let (host, port) = rest.rsplit_once(':').ok_or_else(bad)?;
    let port: u16 = port.parse().map_err(|_| bad())?;
    if host.is_empty() || host.contains('/') || port == 0 {
        return Err(bad());
    }
    Ok(rest.to_string())
}
