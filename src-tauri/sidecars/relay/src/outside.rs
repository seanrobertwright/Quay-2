use hyper::body::Bytes;
use serde_json::json;

use crate::rpc::{self, Id};

/// The protocol version the handshake answers with when the CLI names none, as Quay's does.
const DEFAULT_PROTOCOL_VERSION: &str = "2024-11-05";

pub fn answer(id: &Id, method: &str, line: &[u8]) -> Bytes {
    match method {
        "initialize" => rpc::result(
            id,
            json!({
                "protocolVersion": rpc::protocol_version(line).as_deref().unwrap_or(DEFAULT_PROTOCOL_VERSION),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": env!("CARGO_PKG_NAME"), "version": env!("CARGO_PKG_VERSION") },
            }),
        ),
        "ping" => rpc::result(id, json!({})),
        "tools/list" => rpc::result(id, json!({ "tools": [] })),
        "tools/call" => rpc::error(id, rpc::INVALID_PARAMS, "This session is not in Quay, so there are no tools."),
        _ => rpc::error(id, rpc::METHOD_NOT_FOUND, "Method not found"),
    }
}
