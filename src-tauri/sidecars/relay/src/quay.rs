//! Quay's MCP server, as the relay calls it.

use std::net::Ipv4Addr;
use std::pin::pin;
use std::time::Duration;

use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use hyper::body::Bytes;
use hyper::header::{AUTHORIZATION, CONTENT_TYPE, HOST, HeaderValue};
use hyper::{Request, Uri};
use hyper_util::rt::TokioIo;
use quay_bridge_post::parse_loopback_url;
use tokio::net::TcpStream;
use tokio::time::timeout;

/// How long one message may take, from the connection to the end of the reply: above the
/// 100 s a surface's call waits for its answer, and below the 150 s a CLI gives the call.
const REPLY_LIMIT: Duration = Duration::from_secs(120);

/// The most bytes a reply may have.
const MAX_REPLY: usize = 4 * 1024 * 1024;

const BAD_URL: &str = "QUAY_MCP_URL is not a loopback http:// URL with a port and a path, so the relay refuses it.";
const BAD_TOKEN: &str = "QUAY_A2A_TOKEN can't be sent in a header, so the relay refuses it.";
const UNREACHABLE: &str = "The relay can't reach Quay.";
const CLOSED: &str = "Quay closed the connection before it replied.";
const REPLY_TOO_LONG: &str = "Quay's reply is over 4 MB, so the relay dropped it.";

/// Where Quay's MCP server listens, and the token of the terminal the CLI runs in. Nothing
/// here prints either: the token is a secret, and a URL that is refused may hold one.
#[derive(Clone)]
pub struct Quay {
    port: u16,
    host: HeaderValue,
    path: Uri,
    authorization: HeaderValue,
}

impl Quay {
    /// The server at `url`, which must be on loopback, since each request carries `token`.
    pub fn new(url: &str, token: &str) -> Result<Quay, &'static str> {
        let url = parse_loopback_url("QUAY_MCP_URL", url).map_err(|_| BAD_URL)?;
        let mut authorization = HeaderValue::try_from(format!("Bearer {token}")).map_err(|_| BAD_TOKEN)?;
        authorization.set_sensitive(true);
        Ok(Quay {
            port: url.port,
            host: HeaderValue::try_from(format!("{}:{}", url.host, url.port)).map_err(|_| BAD_URL)?,
            path: Uri::try_from(url.path).map_err(|_| BAD_URL)?,
            authorization,
        })
    }

    /// Posts `body` on a connection of its own, and returns the body of a 2xx answer. Nothing
    /// follows a redirect and nothing is sent twice. Dropping the future closes the
    /// connection, and so does `REPLY_LIMIT`.
    pub async fn post(&self, body: Bytes) -> Result<Bytes, String> {
        timeout(REPLY_LIMIT, self.exchange(body))
            .await
            .unwrap_or_else(|_| Err(format!("Quay did not reply in {} s.", REPLY_LIMIT.as_secs())))
    }

    async fn exchange(&self, body: Bytes) -> Result<Bytes, String> {
        let closed = |_| CLOSED.to_string();
        let stream = TcpStream::connect((Ipv4Addr::LOCALHOST, self.port)).await.map_err(|_| UNREACHABLE.to_string())?;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(closed)?;
        let request = Request::post(self.path.clone())
            .header(HOST, self.host.clone())
            .header(AUTHORIZATION, self.authorization.clone())
            .header(CONTENT_TYPE, "application/json")
            .body(Full::new(body))
            .map_err(|_| UNREACHABLE.to_string())?;
        let mut answer = pin!(async {
            let response = sender.send_request(request).await.map_err(closed)?;
            if !response.status().is_success() {
                return Err(format!("Quay's MCP server answered HTTP {}.", response.status().as_u16()));
            }
            match Limited::new(response.into_body(), MAX_REPLY).collect().await {
                Ok(body) => Ok(body.to_bytes()),
                Err(e) if e.is::<LengthLimitError>() => Err(REPLY_TOO_LONG.to_string()),
                Err(_) => Err(CLOSED.to_string()),
            }
        });
        // The connection is part of this future, not a task of its own, so it goes with it
        tokio::select! {
            answer = &mut answer => answer,
            _ = connection => answer.await,
        }
    }
}
