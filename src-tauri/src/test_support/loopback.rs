//! HTTP to a server on loopback, as a client outside Quay speaks it.

use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// How long a reply may take before the test fails, on a loaded machine.
const REPLY_LIMIT: Duration = Duration::from_secs(30);

pub struct Reply {
    pub status: u16,
    pub body: String,
}

impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|e| panic!("{e}: {:?}", self.body))
    }
}

/// Posts `body` to `path` on `port`, with `headers` besides its own, and asks the server to close the
/// connection after replying. Returns the open connection: pass it to [`read_reply`], or drop it to
/// hang up.
pub async fn post_json(port: u16, path: &str, headers: &[(&str, &str)], body: &Value) -> TcpStream {
    let body = body.to_string();
    let headers: String = headers.iter().map(|(name, value)| format!("{name}: {value}\r\n")).collect();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
        body.len()
    );
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    stream
}

/// Reads the reply to a [`post_json`].
pub async fn read_reply(mut stream: TcpStream) -> Reply {
    let mut reply = String::new();
    tokio::time::timeout(REPLY_LIMIT, stream.read_to_string(&mut reply))
        .await
        .expect("the server never replied")
        .unwrap();

    let (head, body) = reply.split_once("\r\n\r\n").expect("an HTTP reply");
    let status = head.split(' ').nth(1).and_then(|code| code.parse().ok()).expect("a status code");
    Reply { status, body: body.to_string() }
}
