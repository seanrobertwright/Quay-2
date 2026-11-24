use std::net::Ipv4Addr;
use std::pin::pin;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::header::{AUTHORIZATION, CONTENT_TYPE, HOST, HeaderValue};
use hyper::{Request, Uri};
use hyper_util::rt::TokioIo;
use quay_bridge_post::parse_loopback_url;
use tokio::net::TcpStream;

#[derive(Clone)]
pub struct Quay {
    port: u16,
    host: HeaderValue,
    path: Uri,
    authorization: HeaderValue,
}

impl Quay {
    pub fn new(url: &str, token: &str) -> Result<Quay, &'static str> {
        const BAD_URL: &str =
            "QUAY_MCP_URL is not a loopback http:// URL with a port and a path, so the relay refuses it.";
        const BAD_TOKEN: &str = "QUAY_A2A_TOKEN can't be sent in a header, so the relay refuses it.";

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

    pub async fn post(&self, body: Bytes) -> Result<Bytes, String> {
        let closed = |_| "Quay closed the connection before it replied.".to_string();
        let stream = TcpStream::connect((Ipv4Addr::LOCALHOST, self.port))
            .await
            .map_err(|_| "The relay can't reach Quay.".to_string())?;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(closed)?;
        let request = Request::post(self.path.clone())
            .header(HOST, self.host.clone())
            .header(AUTHORIZATION, self.authorization.clone())
            .header(CONTENT_TYPE, "application/json")
            .body(Full::new(body))
            .map_err(|_| "The relay can't make the request.".to_string())?;
        let mut answer = pin!(async {
            let response = sender.send_request(request).await.map_err(closed)?;
            if !response.status().is_success() {
                return Err(format!("Quay's MCP server answered HTTP {}.", response.status().as_u16()));
            }
            Ok(response.into_body().collect().await.map_err(closed)?.to_bytes())
        });
        // The connection lives in this future, so dropping the future closes it
        tokio::select! {
            answer = &mut answer => answer,
            _ = connection => answer.await,
        }
    }
}
