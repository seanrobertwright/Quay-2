//! The little of JSON-RPC and MCP the relay reads: a message's `id` and `method`, and the one
//! param each of `initialize` and `notifications/cancelled` has a use for. Everything else
//! passes through as it was written.

use std::io::Read;

use hyper::body::Bytes;
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;

/// The relay, or Quay behind it, could not serve the request.
pub const RELAY_FAILED: i32 = -32000;

/// A request's id. `1` and `"1"` are two ids.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    Number(serde_json::Number),
    Text(String),
}

/// A request, or a notification when it has no `id`.
#[derive(Deserialize)]
pub struct Message {
    pub id: Option<Id>,
    pub method: String,
}

impl Message {
    pub fn parse(line: &[u8]) -> Result<Message, Unreadable> {
        serde_json::from_slice(line).map_err(Unreadable::from)
    }

    /// As `parse`, without holding the whole message in memory.
    pub fn scan(line: impl Read) -> Result<Message, Unreadable> {
        serde_json::from_reader(line).map_err(Unreadable::from)
    }
}

/// Why a line is neither a request nor a notification.
pub enum Unreadable {
    NotJson,
    NotRequest,
}

impl From<serde_json::Error> for Unreadable {
    fn from(error: serde_json::Error) -> Self {
        if error.is_data() { Unreadable::NotRequest } else { Unreadable::NotJson }
    }
}

/// The protocol version an `initialize` request asks for.
pub fn protocol_version(line: &[u8]) -> Option<String> {
    #[derive(Deserialize)]
    struct Initialize {
        params: Params,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Params {
        protocol_version: String,
    }
    serde_json::from_slice(line).ok().map(|message: Initialize| message.params.protocol_version)
}

/// The id of the request a `notifications/cancelled` names.
pub fn cancelled_id(line: &[u8]) -> Option<Id> {
    #[derive(Deserialize)]
    struct Cancelled {
        params: Params,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Params {
        request_id: Id,
    }
    serde_json::from_slice(line).ok().map(|message: Cancelled| message.params.request_id)
}

/// The reply to request `id` that holds `result`.
pub fn result(id: &Id, result: Value) -> Bytes {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string().into()
}

/// The error reply to request `id`, or to a message whose id can't be read.
pub fn error(id: Option<&Id>, code: i32, message: &str) -> Bytes {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string().into()
}

/// `body` as one line, if it is a reply to request `id` and nothing else.
pub fn reply_line(id: &Id, body: &[u8]) -> Option<Bytes> {
    #[derive(Deserialize)]
    struct Reply {
        jsonrpc: String,
        id: Id,
        result: Option<IgnoredAny>,
        error: Option<IgnoredAny>,
    }
    let text = std::str::from_utf8(body).ok()?;
    let reply: Reply = serde_json::from_str(text).ok()?;
    let is_reply = reply.jsonrpc == "2.0" && reply.id == *id && reply.result.is_some() != reply.error.is_some();
    // In JSON, a line break between tokens is a space, and there is none within one
    is_reply.then(|| text.replace(['\r', '\n'], " ").into())
}
